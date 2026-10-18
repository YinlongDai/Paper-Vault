import { NextResponse } from "next/server";
import { openalexUrl } from "@/lib/openalex";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Related papers from OpenAlex (free, no key): what a paper cites and what cites it.
// Responses are cached for a day by the fetch cache.

type RelatedPaper = {
  openalexId: string;
  title: string;
  year: number | null;
  date: string;
  authors: string;
  citedBy: number;
  arxivId: string; // bare arXiv id when the work is on arXiv, else ""
  url: string;
  abstract: string;
};

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
