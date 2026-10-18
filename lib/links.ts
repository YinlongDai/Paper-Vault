// Finds a paper's code repository and project page.
// Sources: links on the PDF's first page (annotations + plain-text URLs), the Hugging Face papers API,
// and the arXiv abstract/comment. Only the first page is scanned so references to other work don't leak in.

export type LinkKind = "code" | "project";
export type PaperLink = { kind: LinkKind; url: string; source: "pdf" | "huggingface" | "arxiv" | "manual"; stars?: number };
export type LinksState = { items: PaperLink[]; removed: string[] };

const UA = { "User-Agent": "paper-vault/0.1 (self-hosted)" };

const CODE_HOSTS = /^(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org|huggingface\.co)$/i;
// Hosts that are never a paper's own code/project page.
const NOISE_HOSTS =
  /(^|\.)(arxiv\.org|doi\.org|creativecommons\.org|orcid\.org|acm\.org|ieee\.org|springer\.com|neurips\.cc|openreview\.net|aclanthology\.org|cvf\.com|thecvf\.com|twitter\.com|x\.com|linkedin\.com|facebook\.com|wikipedia\.org|google\.com|youtube\.com|youtu\.be|semanticscholar\.org|paperswithcode\.com|w3\.org|ietf\.org|example\.com|medium\.com|substack\.com|reddit\.com|businessinsider\.com|nytimes\.com|theverge\.com|wired\.com|techcrunch\.com|forbes\.com|bloomberg\.com|reuters\.com|cnbc\.com|theguardian\.com|bbc\.co\.uk|wsj\.com|ft\.com|economist\.com|technologyreview\.com|venturebeat\.com|zdnet\.com|cnn\.com)$/i;

export function parseLinks(raw: string | null | undefined): LinksState {
  try {
    const j = raw ? JSON.parse(raw) : null;
    return { items: Array.isArray(j?.items) ? j.items : [], removed: Array.isArray(j?.removed) ? j.removed : [] };
  } catch {
    return { items: [], removed: [] };
  }
}

/** Trim punctuation from text-extracted URLs and reduce GitHub URLs to the repository root. */
export function normalizeUrl(input: string): string | null {
  let s = String(input || "").trim().replace(/[.,;:!?'")\]}>]+$/, "");
  if (!/^https?:\/\//i.test(s)) {
    if (/^(www\.|github\.com\/)/i.test(s)) s = "https://" + s;
    else return null;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  u.hash = "";
  // Drop tracking parameters (utm_*, ref, …).
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|ref_src$|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  if (host === "github.com" || host === "gitlab.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null; // a user/org page, not a repository
    return `https://${host}/${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
  }
  if (host === "huggingface.co") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length || parts[0] === "papers" || parts[0] === "docs") return null;
  }
  return u.toString().replace(/\/$/, "");
}

export function classify(url: string): LinkKind | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  if (CODE_HOSTS.test(host)) return "code";
  if (NOISE_HOSTS.test(host)) return null;
  // A bare organisation domain (e.g. "ommer-lab.com" next to an affiliation) is rarely the paper's page;
  // project pages live on a path, a dedicated subdomain, or github.io / sites.google.com.
  const bareRoot = host.split(".").length <= 2 && (u.pathname === "/" || u.pathname === "");
  if (bareRoot) return null;
  return "project";
}

function urlsInText(text: string) {
  return (String(text || "").match(/\bhttps?:\/\/[^\s<>"'{}|\\^`]+|\bgithub\.com\/[\w.-]+\/[\w.-]+/gi) ?? []) as string[];
}

/** URLs on the first page of the PDF (link annotations + URLs printed as text). */
async function firstPageUrls(pdfUrl: string): Promise<string[]> {
  const res = await fetch(pdfUrl, { headers: UA, redirect: "follow", cache: "no-store" });
  if (!res.ok) throw new Error(`PDF ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  // pdf.js references DOMMatrix at module load. Serverless runtimes lack it (and the optional @napi-rs/canvas
  // polyfill); we never render, so a no-op stand-in is enough to read annotations and text.
  const g = globalThis as any;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    };
  }
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  try {
    const page = await doc.getPage(1);
    const annots: any[] = await page.getAnnotations();
    const fromAnnots = annots.filter((a) => a?.subtype === "Link").map((a) => a.url || a.unsafeUrl).filter(Boolean);
    const text = (await page.getTextContent()).items.map((i: any) => i.str ?? "").join(" ");
    return [...fromAnnots, ...urlsInText(text)];
  } finally {
    await doc.destroy();
  }
}

async function huggingFace(arxivBare: string): Promise<{ url: string; stars?: number } | null> {
  const res = await fetch(`https://huggingface.co/api/papers/${arxivBare}`, { headers: UA, cache: "no-store" });
  if (!res.ok) return null;
  const j: any = await res.json().catch(() => null);
  const repo = typeof j?.githubRepo === "string" ? normalizeUrl(j.githubRepo) : null;
  return repo ? { url: repo, stars: typeof j?.githubStars === "number" ? j.githubStars : undefined } : null;
}

async function arxivMeta(arxivBare: string): Promise<{ comment: string; summary: string }> {
  const res = await fetch(`https://export.arxiv.org/api/query?id_list=${arxivBare}`, { headers: UA, cache: "no-store" });
  if (!res.ok) return { comment: "", summary: "" };
  const xml = await res.text();
  const pick = (tag: string) => (xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) ?? [])[1] ?? "";
  return { comment: pick("arxiv:comment"), summary: pick("summary") };
}

/**
 * Scan all sources. Never throws: a failing source just contributes nothing, and its error is reported
 * in `failed` so problems are visible without breaking the page.
 */
export async function findLinks(opts: { arxivId: string; pdfUrl: string; abstract: string }): Promise<{ links: PaperLink[]; failed: string[] }> {
  const bare = opts.arxivId.replace(/v\d+$/i, "");
  const isArxiv = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/i.test(bare);
  // Non-arXiv papers (e.g. OpenAlex with an open-access PDF) can still be scanned from their PDF.
  if (!isArxiv && !opts.pdfUrl) return { links: [], failed: [] };

  const failed: string[] = [];
  const settle = <T,>(name: string, p: Promise<T>, fallback: T) =>
    p.catch((e) => {
      const msg = `${name}: ${String(e?.message ?? e).slice(0, 200)}`;
      console.warn("[links]", msg);
      failed.push(msg);
      return fallback;
    });
  const [pdfUrls, hf, meta] = await Promise.all([
    settle("pdf", firstPageUrls(opts.pdfUrl || `https://arxiv.org/pdf/${opts.arxivId}`), [] as string[]),
    isArxiv ? settle("huggingface", huggingFace(bare), null) : Promise.resolve(null),
    isArxiv ? settle("arxiv", arxivMeta(bare), { comment: "", summary: "" }) : Promise.resolve({ comment: "", summary: "" }),
  ]);

  const found = new Map<string, PaperLink>();
  const add = (raw: string, source: PaperLink["source"], stars?: number, codeOnly = false) => {
    const url = normalizeUrl(raw);
    if (!url) return;
    const kind = classify(url);
    if (!kind || (codeOnly && kind !== "code")) return;
    const key = url.toLowerCase();
    const prev = found.get(key);
    if (prev) {
      if (stars !== undefined) prev.stars = stars;
      return;
    }
    found.set(key, { kind, url, source, ...(stars !== undefined ? { stars } : {}) });
  };

  if (hf) add(hf.url, "huggingface", hf.stars);
  for (const u of pdfUrls) add(u, "pdf");
  for (const u of urlsInText(meta.comment)) add(u, "arxiv");
  // Abstracts often mention related work's sites; only trust repository links from them.
  for (const u of urlsInText(meta.summary)) add(u, "arxiv", undefined, true);

  // Code first, then project pages; cap to keep the UI tidy.
  const items = [...found.values()];
  return {
    links: [...items.filter((l) => l.kind === "code").slice(0, 3), ...items.filter((l) => l.kind === "project").slice(0, 3)],
    failed,
  };
}
