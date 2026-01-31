import { NextResponse } from "next/server";

type MixedPaper = {
  arxivId: string;
  title: string;
  authors: string;
  summary: string;
  published: string;
  absUrl: string;
  pdfUrl: string;
  source?: "arxiv" | "openalex";
  citationCount?: number;
  influentialCitationCount?: number;
  doi?: string;
};

function dateMs(s: string) {
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : 0;
}

function interleave<T>(a: T[], b: T[]) {
  const out: T[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

function normUrl(u: string) {
  return String(u || "")
    .trim()
    .replace(/^http:\/\//i, "https://")
    .replace(/#.*$/, "")
    .replace(/\?.*$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function normTitle(t: string) {
  return String(t || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function extractArxivIdFromUrl(u: string) {
  const s = normUrl(u);
  // https://arxiv.org/abs/XXXX.YYYYY or https://arxiv.org/pdf/XXXX.YYYYY(.pdf)
  const m = s.match(/arxiv\.org\/(abs|pdf)\/([^\/]+?)(?:\.pdf)?$/);
  return m ? m[2] : "";
}

function reconstructAbstract(inv: any): string {
  // OpenAlex provides an inverted index: { word: [pos1, pos2, ...], ... }
  // Reconstruct by placing each token at its positions.
  if (!inv || typeof inv !== "object") return "";
  const positions: Array<[number, string]> = [];
  for (const [word, idxs] of Object.entries(inv)) {
    if (!Array.isArray(idxs)) continue;
    for (const i of idxs) {
      if (typeof i === "number") positions.push([i, String(word)]);
    }
  }
  if (positions.length === 0) return "";
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, w]) => w).join(" ");
}

function authorMatchesQuery(authors: string, q: string) {
  const raw = String(q || "").trim().toLowerCase();
  if (!raw) return true;

  const toks = raw
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9\-]/g, ""))
    .filter(Boolean);

  if (toks.length === 0) return true;

  const surname = toks[toks.length - 1];
  const givens = toks.slice(0, -1);
  if (!surname) return true;

  // Split into individual author names; arXiv returns "A. B., C. D." and OpenAlex returns "A B, C D".
  // We just split on commas and test each candidate author segment.
  const parts = String(authors || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length === 0) return false;

  const surnameRe = new RegExp(`\\b${surname}\\b`, "i");

  function givenTokenMatches(author: string, t: string) {
    if (!t) return true;
    // Full token match as whole word
    if (t.length >= 2) {
      const re = new RegExp(`\\b${t}\\b`, "i");
      return re.test(author);
    }
    // Initial match ("j" matches "j." or "j")
    const re = new RegExp(`\\b${t}\\.?\\b`, "i");
    return re.test(author);
  }

  // Match if ANY single author satisfies surname + all given tokens.
  for (const a of parts) {
    if (!surnameRe.test(a)) continue;
    if (givens.length === 0) return true;

    let ok = true;
    for (const g of givens) {
      if (!givenTokenMatches(a, g)) {
        ok = false;
        break;
      }
    }

    if (ok) return true;
  }

  return false;
}

function stripArxivVersion(id: string) {
  // 1234.56789v2 -> 1234.56789
  return String(id || "").trim().replace(/v\d+$/i, "");
}

function extractDoiFromUrl(u: string) {
  const s = String(u || "").trim();
  // handles https://doi.org/10....
  const m = s.match(/doi\.org\/(10\.[^\s?#]+)/i);
  return m ? m[1] : "";
}

async function fetchArxivByIds(ids: string[]): Promise<MixedPaper[]> {
  const uniq = Array.from(new Set(ids.map((x) => stripArxivVersion(String(x || "").trim())).filter(Boolean)));
  if (uniq.length === 0) return [];

  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(uniq.join(","))}`;

  const xml = await fetch(url, {
    headers: { "User-Agent": "paper-vault/0.1 (self-hosted)" },
    cache: "no-store",
  }).then((r) => r.text());

  const entries = xml.split("<entry>").slice(1).map((e) => "<entry>" + e);

  return entries.map((e) => {
    const idUrl = textBetween(e, "id");
    const title = textBetween(e, "title").replace(/\s+/g, " ");
    const summary = textBetween(e, "summary").replace(/\s+/g, " ");
    const published = textBetween(e, "published");
    const authors = allBetween(e, "name").join(", ");
    const doi = textBetween(e, "arxiv:doi") || "";

    const arxivId = idUrl.split("/abs/")[1] ?? idUrl;
    const absUrl = idUrl;
    const pdfUrl = idUrl.replace("/abs/", "/pdf/");

    return { arxivId, title, summary, published, authors, absUrl, pdfUrl, doi, source: "arxiv" } as MixedPaper;
  });
}

function toS2Id(p: MixedPaper): string {
  // Prefer DOI whenever available (best match to canonical published record).
  const doi = String(p.doi || "").trim();
  if (doi) return `DOI:${doi}`;

  // Fall back to arXiv id for arXiv-native entries.
  if (p.source === "arxiv") {
    const base = stripArxivVersion(p.arxivId);
    return base ? `ARXIV:${base}` : "";
  }

  // Fallback: try DOI in URLs (OpenAlex landing_page_url may be a DOI URL)
  const doiFromUrl = extractDoiFromUrl(p.absUrl) || extractDoiFromUrl(p.pdfUrl);
  if (doiFromUrl) return `DOI:${doiFromUrl}`;

  // Last resort: URL matching
  const u = p.absUrl || p.pdfUrl;
  return u ? `URL:${u}` : "";
}

type S2BatchItem = {
  paperId?: string;
  citationCount?: number;
  influentialCitationCount?: number;
};

async function fetchS2Batch(ids: string[]): Promise<Map<string, S2BatchItem>> {
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  const out = new Map<string, S2BatchItem>();
  if (uniq.length === 0) return out;

  // Batch endpoint: POST /graph/v1/paper/batch
  // Docs: https://www.semanticscholar.org/product/api
  const url =
    "https://api.semanticscholar.org/graph/v1/paper/batch?fields=paperId,citationCount,influentialCitationCount";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ids: uniq }),
    cache: "no-store" as any,
  });

  if (!r.ok) return out;
  const arr: any[] = await r.json();

  // Response is an array aligned with ids (may contain nulls)
  for (let i = 0; i < uniq.length; i++) {
    const id = uniq[i];
    const it: any = arr?.[i];
    if (!it) continue;
    out.set(id, {
      paperId: it.paperId,
      citationCount: typeof it.citationCount === "number" ? it.citationCount : undefined,
      influentialCitationCount:
        typeof it.influentialCitationCount === "number" ? it.influentialCitationCount : undefined,
    });
  }

  return out;
}

function log1p(x: number) {
  return Math.log(1 + Math.max(0, x || 0));
}

function rerankWithCitations(list: MixedPaper[], sortBy: string, sortOrder: string) {
  if (list.length === 0) return list;
  // Citations-only ordering.
  if (sortBy === "citations") {
    return [...list].sort((a, b) => {
      const ca = a.citationCount ?? 0;
      const cb = b.citationCount ?? 0;
      if (ca !== cb) return sortOrder === "ascending" ? ca - cb : cb - ca;

      const ia = a.influentialCitationCount ?? 0;
      const ib = b.influentialCitationCount ?? 0;
      if (ia !== ib) return sortOrder === "ascending" ? ia - ib : ib - ia;

      const da = dateMs(a.published);
      const db = dateMs(b.published);
      if (da !== db) return sortOrder === "ascending" ? da - db : db - da;

      const ka = String(a.doi || a.arxivId || a.absUrl || a.title || "").toLowerCase();
      const kb = String(b.doi || b.arxivId || b.absUrl || b.title || "").toLowerCase();
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  // For date sorts: keep date ordering, but break ties by citations, then by a deterministic key.
  if (sortBy !== "relevance") {
    return [...list].sort((a, b) => {
      const ta = dateMs(a.published);
      const tb = dateMs(b.published);
      if (ta !== tb) return sortOrder === "ascending" ? ta - tb : tb - ta;

      const ca = a.citationCount ?? 0;
      const cb = b.citationCount ?? 0;
      if (ca !== cb) return cb - ca;

      const ia = a.influentialCitationCount ?? 0;
      const ib = b.influentialCitationCount ?? 0;
      if (ia !== ib) return ib - ia;

      // Final deterministic tie-breaker to prevent cross-page overlap when many items tie.
      const ka = String(a.doi || a.arxivId || a.absUrl || a.title || "").toLowerCase();
      const kb = String(b.doi || b.arxivId || b.absUrl || b.title || "").toLowerCase();
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  // For relevance: use original rank + a small citation boost.
  // (We cannot compare cross-source relevance scores directly, so we boost within the combined list.)
  const maxC = Math.max(1, ...list.map((p) => p.citationCount ?? 0));
  const denom = log1p(maxC);

  return [...list]
    .map((p, idx) => {
      const base = (list.length - idx) / list.length; // higher for earlier items
      const cite = denom > 0 ? log1p(p.citationCount ?? 0) / denom : 0;
      const score = base + 0.15 * cite; // small boost
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}

async function fetchOpenAlex(
  q: string,
  max: number,
  start: number,
  field: string,
  sortBy: string,
  sortOrder: string
): Promise<MixedPaper[]> {
  const perPage = 25;
  const maxN = Math.max(1, max);
  const startN = Math.max(0, start);
  const firstPage = Math.floor(startN / perPage) + 1;
  const offsetInFirst = startN % perPage;

  const oaOrder = sortOrder === "ascending" ? "asc" : "desc";

  // For date sorts, use publication_date. For relevance, use relevance_score (when search is active).
  const oaSort =
    sortBy === "relevance" || sortBy === "citations"
      ? `&sort=relevance_score:${oaOrder}`
      : `&sort=publication_date:${oaOrder}`;

  const safeField =
    field === "smart" || field === "title" || field === "author" || field === "abstract" || field === "all"
      ? field
      : "smart";

  async function fetchAuthorIds(name: string): Promise<string[]> {
    const url = `https://api.openalex.org/authors?search=${encodeURIComponent(name)}&per-page=5`;
    const r = await fetch(url, { cache: "no-store" as any });
    if (!r.ok) return [];
    const j: any = await r.json();
    const rows: any[] = Array.isArray(j?.results) ? j.results : [];
    return rows
      .map((it: any) => String(it?.id ?? "").trim()) // usually https://openalex.org/A...
      .filter(Boolean)
      .map((id) => id.split("/").pop() || id) // use Axxxx form
      .filter(Boolean);
  }

  // Build the works URL based on your field dropdown
  let worksUrl = "";
  if (safeField === "all") {
    // search = title + abstract + fulltext  [oai_citation:5‡OpenAlex](https://docs.openalex.org/api-entities/works/search-works)
  worksUrl =
    `https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
    `&per-page=${encodeURIComponent(String(perPage))}` +
    `&page=__PAGE__` +
    oaSort;
  } else if (safeField === "title") {
    // title.search  [oai_citation:6‡OpenAlex](https://docs.openalex.org/api-entities/works/filter-works)
    const filter = `title.search:${q}`;
    worksUrl =
      `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
      `&per-page=${encodeURIComponent(String(perPage))}` +
      `&page=__PAGE__` +
      oaSort;
  } else if (safeField === "abstract") {
    // abstract.search  [oai_citation:7‡OpenAlex](https://docs.openalex.org/api-entities/works/filter-works)
    const filter = `abstract.search:${q}`;
    worksUrl =
      `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
      `&per-page=${encodeURIComponent(String(perPage))}` +
      `&page=__PAGE__` +
      oaSort;
  } else if (safeField === "smart") {
    // title_and_abstract.search  [oai_citation:8‡OpenAlex](https://docs.openalex.org/api-entities/works/filter-works)
    const filter = `title_and_abstract.search:${q}`;
    worksUrl =
      `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
      `&per-page=${encodeURIComponent(String(perPage))}` +
      `&page=__PAGE__` +
      oaSort;
  } else {
    // author: 2-step: search authors -> filter works by authorships.author.id  [oai_citation:9‡OpenAlex](https://docs.openalex.org/api-guide-for-llms?utm_source=chatgpt.com)
    const ids = await fetchAuthorIds(q);
    if (ids.length === 0) return [];
    const filter = `authorships.author.id:${ids.join("|")}`;
    worksUrl =
      `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
      `&per-page=${encodeURIComponent(String(perPage))}` +
      `&page=__PAGE__` +
      oaSort;
  }

  const collected: any[] = [];
  let pageNum = firstPage;

  while (collected.length < offsetInFirst + maxN) {
    const pageUrl = worksUrl.replace("__PAGE__", encodeURIComponent(String(pageNum)));
    const r = await fetch(pageUrl, { cache: "no-store" as any });
    if (!r.ok) break;

    const j: any = await r.json();
    const rows: any[] = Array.isArray(j?.results) ? j.results : [];
    if (rows.length === 0) break;

    collected.push(...rows);

    if (rows.length < perPage) break;

    pageNum += 1;

    // safety cap: avoid runaway
    if (pageNum - firstPage > 20) break;
  }

  const sliced = collected.slice(offsetInFirst, offsetInFirst + maxN);

  return sliced
    .map((it: any) => {
      // KEEP YOUR EXISTING MAPPING LOGIC HERE (copy/paste it from the current return rows.map)
      const id = String(it?.id ?? "").trim();
      const title = String(it?.display_name ?? "").trim();

      const authorships: any[] = Array.isArray(it?.authorships) ? it.authorships : [];
      const authors = authorships
        .map((a: any) => String(a?.author?.display_name ?? "").trim())
        .filter(Boolean)
        .join(", ");

      const published = String(it?.publication_date ?? "").trim();
      const abstract = reconstructAbstract(it?.abstract_inverted_index);

      const landing =
        String(it?.primary_location?.landing_page_url ?? "").trim() ||
        String(it?.doi ?? "").trim() ||
        String(it?.id ?? "").trim();
      const doi = extractDoiFromUrl(String(it?.doi ?? "")) || extractDoiFromUrl(landing);

      const stableId = id ? `openalex:${id}` : `openalex:${title}`;

      return {
        arxivId: stableId,
        title: title || "(untitled)",
        authors: authors || "OpenAlex",
        summary: abstract || "",
        published: published || "",
        doi: doi || "",
        absUrl: landing || "",
        pdfUrl: landing || "",
        source: "openalex" as const,
      } as MixedPaper;
    })
    .filter((x) => x.absUrl);
}

function textBetween(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : "";
}

function allBetween(xml: string, tag: string) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const max = searchParams.get("max") ?? "10";
  const start = searchParams.get("start") ?? "0";
  const field = searchParams.get("field") ?? "smart";

  const sort = searchParams.get("sort") ?? "relevance";
  const order = searchParams.get("order") ?? "descending";

  const sortBy =
  sort === "submittedDate" || sort === "lastUpdatedDate" || sort === "relevance" || sort === "citations"
    ? sort
    : "relevance";
  const sortOrder = order === "ascending" || order === "descending" ? order : "descending";

  if (!q.trim()) {
    return NextResponse.json({ papers: [] });
  }

  const maxN = Math.max(1, parseInt(max, 10) || 10);
  const startN = Math.max(0, parseInt(start, 10) || 0);
  // Any non-relevance ordering must be globally consistent across pages.
  const globalMode = sortBy !== "relevance";
  const wantEnd = startN + maxN;
  // Fetch a bigger pool from offset 0 so cross-source merge/dedup won't cause page overlaps.
  // Cap at 300 to limit API cost.
  const candidateMax = globalMode ? Math.min(300, Math.max(50, wantEnd * 5)) : maxN;

  const qq = q.trim();
  const quoted = `"${qq.replace(/"/g, "\\\"")}"`;

  let searchQuery = "";
  if (field === "title") {
    const words = qq
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z0-9_\-\.]/g, ""))
      .filter(Boolean);

    const allWords = words.length ? `(${words.map((w) => `ti:${w}`).join(" AND ")})` : "";
    searchQuery = allWords ? `(ti:${quoted} OR ${allWords})` : `ti:${quoted}`;
  } else if (field === "author") {
    const words = qq
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z0-9_\-\.]/g, ""))
      .filter(Boolean);

    // arXiv author search can be sensitive to quoting; use both exact phrase and AND over tokens.
    const allWords = words.length ? `(${words.map((w) => `au:${w}`).join(" AND ")})` : "";
    searchQuery = allWords ? `(au:${quoted} OR ${allWords})` : `au:${quoted}`;
  }
  else if (field === "abstract") searchQuery = `abs:${qq}`;
  else if (field === "all") searchQuery = `all:${qq}`;
  else {
    searchQuery = `(ti:${qq} OR abs:${qq})`;
  }

  const arxivApiSortBy = sortBy === "citations" ? "relevance" : sortBy;

  const arxivStart = globalMode ? 0 : startN;
  const arxivMax = globalMode ? candidateMax : maxN;

  const url =
    `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}` +
    `&start=${encodeURIComponent(String(arxivStart))}` +
    `&max_results=${encodeURIComponent(String(arxivMax))}` +
    `&sortBy=${encodeURIComponent(arxivApiSortBy)}` +
    `&sortOrder=${encodeURIComponent(sortOrder)}`;

  const xml = await fetch(url, {
    headers: { "User-Agent": "paper-vault/0.1 (self-hosted)" },
    cache: "no-store",
  }).then((r) => r.text());

  const entries = xml.split("<entry>").slice(1).map((e) => "<entry>" + e);

const arxivSortTs = new Map<string, number>();

const papers: MixedPaper[] = entries.map((e) => {
  const idUrl = textBetween(e, "id");
  const title = textBetween(e, "title").replace(/\s+/g, " ");
  const summary = textBetween(e, "summary").replace(/\s+/g, " ");
  const published = textBetween(e, "published");
  const updated = textBetween(e, "updated");
  const authors = allBetween(e, "name").join(", ");
  const doi = textBetween(e, "arxiv:doi") || "";

  const arxivId = idUrl.split("/abs/")[1] ?? idUrl;
  const absUrl = idUrl;
  const pdfUrl = idUrl.replace("/abs/", "/pdf/");

  // choose the timestamp that matches the arXiv sort mode
  const tsStr = sortBy === "lastUpdatedDate" ? (updated || published) : (published || updated);
  arxivSortTs.set(arxivId, dateMs(tsStr));

  return { arxivId, title, summary, published, authors, absUrl, pdfUrl, doi, source: "arxiv" };
});
const papersFiltered = field === "author" ? papers.filter((p) => authorMatchesQuery(p.authors, qq)) : papers;

// Build dedup set from arXiv results
const seen = new Set<string>();
for (const p of papersFiltered) {
  if (p.arxivId) {
    const v = p.arxivId.toLowerCase();
    const nv = stripArxivVersion(p.arxivId).toLowerCase();
    seen.add(`id:${v}`);
    if (nv && nv !== v) seen.add(`id:${nv}`);
  }
  if (p.absUrl) seen.add(`url:${normUrl(p.absUrl)}`);
  if (p.pdfUrl) seen.add(`url:${normUrl(p.pdfUrl)}`);
  const t = normTitle(p.title);
  if (t) seen.add(`title:${t}`);
}

const openalexRaw = await fetchOpenAlex(
  qq,
  globalMode ? candidateMax : maxN,
  globalMode ? 0 : startN,
  field,
  sortBy,
  sortOrder
);

// Collect arXiv IDs that OpenAlex links to
const oaArxivIds: string[] = [];
for (const p of openalexRaw) {
  const maybe = extractArxivIdFromUrl(p.absUrl) || extractArxivIdFromUrl(p.pdfUrl);
  if (maybe) oaArxivIds.push(maybe);
}

// Fetch arXiv-native records for those IDs
const oaArxivPapers = await fetchArxivByIds(oaArxivIds);
const oaArxivMap = new Map<string, MixedPaper>();
for (const ap of oaArxivPapers) {
  const k = stripArxivVersion(ap.arxivId).toLowerCase();
  if (k) oaArxivMap.set(k, ap);
}

const openalex: MixedPaper[] = [];

for (const p of openalexRaw) {
  const maybeRaw = extractArxivIdFromUrl(p.absUrl) || extractArxivIdFromUrl(p.pdfUrl);
  const maybe = maybeRaw ? stripArxivVersion(maybeRaw).toLowerCase() : "";

  // If OpenAlex points to arXiv: replace with arXiv-native record
  if (maybe) {
    const repl = oaArxivMap.get(maybe);
    if (repl) openalex.push(repl);
    // If lookup failed, drop wrapper (or keep `p` if you want fallback)
    continue;
  }

  // Non-arXiv OpenAlex items: apply your normal duplicate checks
  const absN = normUrl(p.absUrl);
  const pdfN = normUrl(p.pdfUrl);
  if (absN && seen.has(`url:${absN}`)) continue;
  if (pdfN && seen.has(`url:${pdfN}`)) continue;

  const t = normTitle(p.title);
  if (t && seen.has(`title:${t}`)) continue;

  if (absN) seen.add(`url:${absN}`);
  if (pdfN) seen.add(`url:${pdfN}`);
  if (t) seen.add(`title:${t}`);

  openalex.push(p);
}
const openalexFiltered = field === "author" ? openalex.filter((p) => authorMatchesQuery(p.authors, qq)) : openalex;

let mixed: MixedPaper[];

if (sortBy === "relevance") {
  // keep interleave (or swap to RRF below)
  mixed = interleave(papersFiltered, openalexFiltered);
} else {
  // global date ordering
  mixed = [...papersFiltered, ...openalexFiltered].sort((a, b) => {
    const ta = a.source === "arxiv" ? (arxivSortTs.get(a.arxivId) ?? dateMs(a.published)) : dateMs(a.published);
    const tb = b.source === "arxiv" ? (arxivSortTs.get(b.arxivId) ?? dateMs(b.published)) : dateMs(b.published);

    return sortOrder === "ascending" ? ta - tb : tb - ta;
  });
}

// Final pass: remove any remaining duplicates.
// IMPORTANT: Prefer keeping arXiv when OpenAlex and arXiv collide by URL/title.
const out: MixedPaper[] = [];

// Map each dedup key -> index in `out`
const keyToIdx = new Map<string, number>();

function considerKey(key: string, idx: number) {
  if (!key) return;
  keyToIdx.set(key, idx);
}

for (const p of mixed) {
  const keyId = p.arxivId ? `id:${p.arxivId.toLowerCase()}` : "";
  const keyUrl = p.absUrl ? `url:${normUrl(p.absUrl)}` : "";
  const keyTitle = p.title ? `title:${normTitle(p.title)}` : "";

  // Find an existing item that matches any key.
  const hitIdx =
    (keyId && keyToIdx.get(keyId)) ??
    (keyUrl && keyToIdx.get(keyUrl)) ??
    (keyTitle && keyToIdx.get(keyTitle)) ??
    undefined;

  if (hitIdx === undefined) {
    const idx = out.length;
    out.push(p);
    considerKey(keyId, idx);
    considerKey(keyUrl, idx);
    considerKey(keyTitle, idx);
    continue;
  }

  // Collision: keep arXiv over OpenAlex.
  const existing = out[hitIdx];
  if (existing?.source !== "arxiv" && p.source === "arxiv") {
    out[hitIdx] = p;
    // ensure all keys point to this retained item
    considerKey(keyId, hitIdx);
    considerKey(keyUrl, hitIdx);
    considerKey(keyTitle, hitIdx);
  }
  // else: keep existing (do nothing)
}

const pool = globalMode ? out.slice(0, candidateMax) : out.slice(0, maxN);

// Enrich citations for the pool
const s2Ids = pool.map((p) => toS2Id(p));
const s2Map = await fetchS2Batch(s2Ids);

for (let i = 0; i < pool.length; i++) {
  const key = s2Ids[i];
  const meta = key ? s2Map.get(key) : undefined;
  if (!meta) continue;
  pool[i] = {
    ...pool[i],
    citationCount: meta.citationCount,
    influentialCitationCount: meta.influentialCitationCount,
  };
}

const rerankedPool = rerankWithCitations(pool, sortBy, sortOrder);

// Slice AFTER global sort for ANY non-relevance sort
const paged = globalMode ? rerankedPool.slice(startN, startN + maxN) : rerankedPool;

return NextResponse.json({ papers: paged });
}