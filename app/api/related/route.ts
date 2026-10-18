import { NextResponse } from "next/server";
import { openalexUrl } from "@/lib/openalex";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Related papers: what a paper cites and what cites it.
// Semantic Scholar first (much better coverage for recent arXiv preprints; set SEMANTIC_SCHOLAR_API_KEY to
// avoid its shared rate limit), OpenAlex as the fallback. Responses are cached for a day by the fetch cache.

type RelatedPaper = {
  openalexId: string;
  title: string;
  year: number | null;
  date: string;
  authors: string;
  citedBy: number;
  arxivId: string; // bare arXiv id when the work is on arXiv, else ""
  doi: string;
  url: string;
  abstract: string;
};

const S2 = "https://api.semanticscholar.org/graph/v1";
const S2_FIELDS = "title,year,publicationDate,authors,citationCount,externalIds,abstract,url";

async function s2(path: string, tries = 3): Promise<any> {
  const headers: Record<string, string> = {};
  const key = String(process.env.SEMANTIC_SCHOLAR_API_KEY ?? "").trim();
  if (key) headers["x-api-key"] = key;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${S2}${path}`, { headers, next: { revalidate: 86400 } });
    if (res.ok) return res.json();
    if (res.status !== 429 || i === tries - 1) throw new Error(`Semantic Scholar ${res.status}`);
    await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
  }
}

function fromS2(p: any): RelatedPaper {
  const ext = p?.externalIds ?? {};
  const arxivId = String(ext.ArXiv ?? "").replace(/v\d+$/i, "");
  const doi = String(ext.DOI ?? "");
  return {
    openalexId: `s2:${p?.paperId ?? ""}`,
    title: String(p?.title ?? "(untitled)"),
    year: typeof p?.year === "number" ? p.year : null,
    date: String(p?.publicationDate ?? ""),
    authors: (p?.authors ?? []).map((a: any) => String(a?.name ?? "")).filter(Boolean).join(", "),
    citedBy: Number(p?.citationCount ?? 0),
    arxivId,
    doi,
    url: arxivId ? `https://arxiv.org/abs/${arxivId}` : doi ? `https://doi.org/${doi}` : String(p?.url ?? ""),
    abstract: String(p?.abstract ?? ""),
  };
}

async function viaSemanticScholar(bare: string) {
  const id = `arXiv:${bare}`;
  const [meta, refs, cites] = await Promise.all([
    s2(`/paper/${id}?fields=referenceCount,citationCount`),
    s2(`/paper/${id}/references?fields=${S2_FIELDS}&limit=300`),
    s2(`/paper/${id}/citations?fields=${S2_FIELDS}&limit=500`),
  ]);
  const clean = (rows: any[], key: "citedPaper" | "citingPaper") =>
    (rows ?? []).map((r) => r?.[key]).filter((p) => p?.title).map(fromS2);
  return {
    source: "Semantic Scholar",
    references: clean(refs?.data, "citedPaper").sort((a, b) => b.citedBy - a.citedBy),
    citations: clean(cites?.data, "citingPaper").sort((a, b) => b.citedBy - a.citedBy).slice(0, 30),
    counts: { references: Number(meta?.referenceCount ?? 0), citations: Number(meta?.citationCount ?? 0) },
  };
}

const OA = "https://api.openalex.org";
const SELECT = "id,display_name,publication_year,publication_date,cited_by_count,authorships,locations,doi,abstract_inverted_index";

async function oa(path: string) {
  const res = await fetch(openalexUrl(`${OA}${path}`), { next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
  return res.json();
}

function abstractFrom(inv: Record<string, number[]> | null | undefined) {
  if (!inv) return "";
  const words: string[] = [];
  for (const [w, positions] of Object.entries(inv)) for (const i of positions) words[i] = w;
  return words.filter(Boolean).join(" ");
}

function toRelated(w: any): RelatedPaper {
  const arxivUrl: string =
    (w.locations ?? []).map((l: any) => String(l?.landing_page_url ?? "")).find((u: string) => /arxiv\.org\/abs\//i.test(u)) ?? "";
  const arxivId = (arxivUrl.match(/arxiv\.org\/abs\/([^?#\s]+)/i)?.[1] ?? "").replace(/v\d+$/i, "");
  const names = (w.authorships ?? []).map((a: any) => String(a?.author?.display_name ?? "")).filter(Boolean);
  return {
    openalexId: String(w.id ?? ""),
    title: String(w.display_name ?? "(untitled)"),
    year: typeof w.publication_year === "number" ? w.publication_year : null,
    date: String(w.publication_date ?? ""),
    authors: names.join(", "),
    citedBy: Number(w.cited_by_count ?? 0),
    arxivId,
    doi: String(w.doi ?? "").replace(/^https?:\/\/doi\.org\//i, ""),
    url: arxivId ? `https://arxiv.org/abs/${arxivId}` : String(w.doi || w.id || ""),
    abstract: abstractFrom(w.abstract_inverted_index),
  };
}

/** GET ?arxivId=2006.11239v2 → { references, citations, counts } */
export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get("arxivId") ?? "").trim();
  const bare = raw.replace(/v\d+$/i, "");
  const openalex = raw.startsWith("openalex:") ? raw.slice("openalex:".length).split("/").pop() : "";
  if (!bare && !openalex) return NextResponse.json({ error: "arxivId is required" }, { status: 400 });

  // Semantic Scholar knows arXiv ids directly; fall back to OpenAlex when it fails or has nothing.
  if (bare && !openalex) {
    try {
      const r = await viaSemanticScholar(bare);
      if (r.references.length || r.citations.length) return NextResponse.json(r);
    } catch (e) {
      console.warn("[related] Semantic Scholar:", String((e as Error)?.message ?? e));
    }
  }

  try {
    const work: any = openalex
      ? await oa(`/works/${openalex}?select=id,referenced_works,cited_by_count`)
      : await oa(`/works/doi:10.48550/arXiv.${bare}?select=id,referenced_works,cited_by_count`);
    const id = String(work.id).split("/").pop();

    const refIds: string[] = (work.referenced_works ?? []).map((u: string) => u.split("/").pop()).filter(Boolean);
    const refBatches: Promise<any>[] = [];
    for (let i = 0; i < refIds.length && i < 150; i += 50) {
      refBatches.push(oa(`/works?filter=ids.openalex:${refIds.slice(i, i + 50).join("|")}&per_page=50&select=${SELECT}`));
    }
    const [citing, ...refPages] = await Promise.all([
      oa(`/works?filter=cites:${id}&sort=cited_by_count:desc&per_page=30&select=${SELECT}`),
      ...refBatches,
    ]);

    const references = refPages
      .flatMap((p: any) => p.results ?? [])
      .map(toRelated)
      .sort((a: RelatedPaper, b: RelatedPaper) => b.citedBy - a.citedBy);
    const citations = (citing.results ?? []).map(toRelated);

    return NextResponse.json({
      source: "OpenAlex",
      references,
      citations,
      counts: { references: refIds.length, citations: Number(citing.meta?.count ?? work.cited_by_count ?? 0) },
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const notFound = /404/.test(msg);
    return NextResponse.json(
      { error: notFound ? "This paper isn't in OpenAlex yet" : "Couldn't load related papers", detail: msg },
      { status: notFound ? 404 : 502 }
    );
  }
}
