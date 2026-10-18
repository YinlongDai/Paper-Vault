// Turn a pasted link / id / DOI / title into paper metadata (arXiv first, then OpenAlex).
import { openAccessPdf, openalexUrl } from "./openalex";

export type ResolvedPaper = {
  arxivId: string;
  title: string;
  authors: string;
  summary: string;
  published: string;
  absUrl: string;
  pdfUrl: string;
  source: "arxiv" | "openalex";
};

const UA = { "User-Agent": "paper-vault/0.1 (self-hosted)" };
const NEW_ID = /(\d{4}\.\d{4,5})(v\d+)?/;
const OLD_ID = /([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i;

/** arXiv id (with version if given) from an id or any URL that contains one (arxiv, alphaxiv, HF papers, DOI). */
export function extractArxivId(input: string): string {
  const s = String(input || "").trim();
  const doi = s.match(/10\.48550\/arxiv\.([^\s?#]+)/i);
  if (doi) return doi[1];
  if (/^(arxiv:)?\d{4}\.\d{4,5}(v\d+)?$/i.test(s)) return s.replace(/^arxiv:/i, "");
  if (/(arxiv\.org|alphaxiv\.org|huggingface\.co\/papers|arxiv-sanity|ar5iv)/i.test(s) || /^arxiv:/i.test(s)) {
    const m = s.match(NEW_ID) ?? s.match(OLD_ID);
    if (m) return m[1] + (m[2] ?? "");
  }
  return "";
}

export function extractDoi(input: string): string {
  const m = String(input || "").match(/\b(10\.\d{4,9}\/[^\s"<>]+)/);
  return m ? m[1].replace(/[.,;)\]]+$/, "") : "";
}

function textBetween(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function decode(s: string) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

export async function fromArxiv(id: string): Promise<ResolvedPaper | null> {
  const res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, { headers: UA, cache: "no-store" });
  if (!res.ok) return null;
  const xml = await res.text();
  const entry = xml.split("<entry>")[1];
  if (!entry) return null;
  const idUrl = textBetween(entry, "id");
  const title = decode(textBetween(entry, "title"));
  if (!idUrl || !title || /^Error$/i.test(title)) return null;
  const fullId = idUrl.split("/abs/")[1] ?? id;
  const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => decode(m[1].trim())).join(", ");
  return {
    arxivId: fullId,
    title,
    authors,
    summary: decode(textBetween(entry, "summary")),
    published: textBetween(entry, "published"),
    absUrl: idUrl,
    pdfUrl: idUrl.replace("/abs/", "/pdf/"),
    source: "arxiv",
  };
}

function abstractFrom(inv: Record<string, number[]> | null | undefined) {
  if (!inv) return "";
  const words: string[] = [];
  for (const [w, positions] of Object.entries(inv)) for (const i of positions) words[i] = w;
  return words.filter(Boolean).join(" ");
}

async function fromOpenAlexWork(work: any): Promise<ResolvedPaper | null> {
  if (!work?.id) return null;
  const oa = openAccessPdf(work);
  if (oa.arxivId) {
    const ax = await fromArxiv(oa.arxivId);
    if (ax) return ax;
  }
  const landing = String(work?.primary_location?.landing_page_url ?? work?.doi ?? work.id);
  return {
    arxivId: `openalex:${work.id}`,
    title: String(work.display_name ?? "(untitled)"),
    authors: (work.authorships ?? []).map((a: any) => String(a?.author?.display_name ?? "")).filter(Boolean).join(", "),
    summary: abstractFrom(work.abstract_inverted_index),
    published: String(work.publication_date ?? ""),
    absUrl: landing,
    pdfUrl: oa.pdfUrl || landing,
    source: "openalex",
  };
}

const OA_SELECT = "id,display_name,publication_date,authorships,primary_location,best_oa_location,locations,doi,abstract_inverted_index";

export async function fromDoi(doi: string): Promise<ResolvedPaper | null> {
  const ax = extractArxivId(doi);
  if (ax) return fromArxiv(ax);
  const res = await fetch(openalexUrl(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=${OA_SELECT}`), { cache: "no-store" });
  if (!res.ok) return null;
  return fromOpenAlexWork(await res.json());
}

function norm(s: string) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Best match for a title (used by .bib import); only accepts a near-exact title match. */
export async function fromTitle(title: string): Promise<ResolvedPaper | null> {
  const t = norm(title);
  if (t.length < 8) return null;
  const res = await fetch(
    openalexUrl(`https://api.openalex.org/works?filter=title.search:${encodeURIComponent(title.replace(/[,:|]/g, " "))}&per_page=5&select=${OA_SELECT}`),
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const j: any = await res.json();
  const hit = (j.results ?? []).find((w: any) => norm(w.display_name) === t);
  return hit ? fromOpenAlexWork(hit) : null;
}

/** Resolve free-form input: arXiv id/URL, DOI, or (if allowTitle) an exact title. */
export async function resolvePaper(input: string, allowTitle = false): Promise<ResolvedPaper | null> {
  const s = String(input || "").trim();
  if (!s) return null;
  const ax = extractArxivId(s);
  if (ax) return fromArxiv(ax);
  const doi = extractDoi(s);
  if (doi) return fromDoi(doi);
  const oaWork = s.match(/openalex\.org\/(W\d+)/i);
  if (oaWork) {
    const res = await fetch(openalexUrl(`https://api.openalex.org/works/${oaWork[1]}?select=${OA_SELECT}`), { cache: "no-store" });
    return res.ok ? fromOpenAlexWork(await res.json()) : null;
  }
  return allowTitle ? fromTitle(s) : null;
}
