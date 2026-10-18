// Client-safe helpers shared by the search and library pages.

export type Paper = {
  arxivId: string;
  title: string;
  authors: string;
  summary: string;
  published: string;
  absUrl: string;
  pdfUrl: string;
  labelNames?: string[];
  source?: "arxiv" | "openalex";
  citationCount?: number;
  influentialCitationCount?: number;
  doi?: string;
  note?: string | null;
  aiSummary?: string | null;
  createdAt?: string;
  annotationCount?: number;
  /** Set by the server when the note was replaced with filler for a visitor. */
  noteHidden?: boolean;
};

export type Label = { id: number; name: string; count: number };

export type Viewer = { authEnabled: boolean; signedIn: boolean; canEdit: boolean; name: string };

const LABEL_PALETTE = [
  "#6366F1", // indigo
  "#22C55E", // green
  "#06B6D4", // cyan
  "#F59E0B", // amber
  "#EF4444", // red
  "#A855F7", // purple
  "#EC4899", // pink
  "#14B8A6", // teal
  "#84CC16", // lime
  "#3B82F6", // blue
];

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function colorForLabel(name: string) {
  const idx = hashString(name.toLowerCase()) % LABEL_PALETTE.length;
  return LABEL_PALETTE[idx];
}

export function isOpenAlex(p: Pick<Paper, "arxivId" | "source">) {
  return p.source === "openalex" || p.arxivId.startsWith("openalex:");
}

/** "2022-09-12T19:16:48Z" → "Sep 12, 2022"; passes through anything unparseable. */
export function formatDate(s?: string | null) {
  const raw = String(s ?? "").trim();
  if (!raw) return "";
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return raw;
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function yearOf(s?: string | null) {
  const m = String(s ?? "").match(/\d{4}/);
  return m ? m[0] : "";
}

export function splitAuthors(authors: string) {
  return String(authors || "")
    .split(/\s*,\s*/)
    .map((a) => a.trim())
    .filter(Boolean);
}

/** Show the first few authors and summarise the rest. */
export function shortAuthors(authors: string, max = 6) {
  const list = splitAuthors(authors);
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} +${list.length - max} more`;
}

/** Strip the version suffix from an arXiv id (2209.05557v3 → 2209.05557). */
export function bareArxivId(id: string) {
  return String(id || "").replace(/v\d+$/i, "");
}

function bibEscape(s: string) {
  return String(s || "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export function toBibtex(p: Paper) {
  const authors = splitAuthors(p.authors);
  const year = yearOf(p.published);
  const firstLast = (authors[0] ?? "anon").split(/\s+/).pop() ?? "anon";
  const firstWord = (p.title.match(/[A-Za-z]{4,}/)?.[0] ?? "paper").toLowerCase();
  const key = `${firstLast.toLowerCase().replace(/[^a-z]/g, "")}${year}${firstWord}`;

  const lines = [
    `  title = {${bibEscape(p.title)}}`,
    `  author = {${authors.map(bibEscape).join(" and ")}}`,
  ];
  if (year) lines.push(`  year = {${year}}`);

  if (isOpenAlex(p)) {
    if (p.doi) lines.push(`  doi = {${p.doi}}`);
    if (p.absUrl) lines.push(`  url = {${p.absUrl}}`);
  } else {
    const id = bareArxivId(p.arxivId);
    lines.push(`  eprint = {${id}}`, `  archivePrefix = {arXiv}`, `  url = {https://arxiv.org/abs/${id}}`);
  }

  return `@misc{${key},\n${lines.join(",\n")}\n}`;
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Small, safe Markdown renderer (input is HTML-escaped first). Style comes from `.prose` in globals.css. */
export function renderMarkdown(md: string) {
  let s = escapeHtml(md || "");

  // code blocks ```...``` — stash them so later rules don't touch their contents
  const blocks: string[] = [];
  s = s.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code) => {
    blocks.push(`<pre><code>${code}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });

  // inline code
  s = s.replace(/`([^`\n]+?)`/g, "<code>$1</code>");

  // headings
  s = s.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  s = s.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  s = s.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // bullet / numbered lists (consecutive lines)
  s = s.replace(/(?:^[ \t]*[-*]\s+.+(?:\n|$))+/gm, (block) => {
    const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^[ \t]*[-*]\s+/, "")}</li>`);
    return `<ul>${items.join("")}</ul>\n`;
  });
  s = s.replace(/(?:^[ \t]*\d+[.)]\s+.+(?:\n|$))+/gm, (block) => {
    const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^[ \t]*\d+[.)]\s+/, "")}</li>`);
    return `<ol>${items.join("")}</ol>\n`;
  });

  // bold / italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<a href='$2' target='_blank' rel='noreferrer'>$1</a>");

  // paragraphs / line breaks
  s = s
    .split(/\n{2,}/)
    .map((para) => {
      const t = para.trim();
      if (!t) return "";
      if (/^(<h\d|<ul|<ol|\u0000)/.test(t)) return t.replace(/\n/g, "");
      return `<p>${t.replace(/\n/g, "<br />")}</p>`;
    })
    .join("");

  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)] ?? "");
}

export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const text = await r.text();
  let j: any = {};
  try {
    j = text.trim() ? JSON.parse(text) : {};
  } catch {
    j = { error: text.slice(0, 300) };
  }
  if (!r.ok) {
    const msg = j?.detail || j?.error || `Request failed (${r.status})`;
    const err = new Error(String(msg)) as Error & { status?: number };
    err.status = r.status;
    throw err;
  }
  return j as T;
}

export function sendJson<T = any>(url: string, method: string, body: unknown) {
  return fetchJson<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type DiffPart = { kind: "same" | "add" | "del"; text: string };

/** Word-level diff (LCS). Fine for abstracts of a few hundred words. */
export function diffWords(a: string, b: string): DiffPart[] {
  const A = a.split(/(\s+)/).filter(Boolean);
  const B = b.split(/(\s+)/).filter(Boolean);
  const n = A.length;
  const m = B.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push("same", A[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", A[i++]);
    } else {
      push("add", B[j++]);
    }
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return out;
}

/** "2209.05557v3" → "v3"; "" when the id has no version suffix or isn't from arXiv. */
export function versionOf(id: string) {
  return (String(id || "").match(/(v\d+)$/i)?.[1] ?? "").toLowerCase();
}
