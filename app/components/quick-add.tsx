"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fetchJson, formatDate, sendJson, shortAuthors } from "@/lib/papers";
import { useToast } from "./providers";
import { LabelPicker, Modal, Spinner } from "./ui";

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

export async function resolveInput(input: string, allowTitle = false) {
  const j = await fetchJson<{ paper: ResolvedPaper }>(`/api/resolve?input=${encodeURIComponent(input)}${allowTitle ? "&title=1" : ""}`);
  return j.paper;
}

/** True when the text looks like something /api/resolve can look up directly (arXiv id/link, DOI, OpenAlex link). */
export function looksResolvable(s: string) {
  const t = s.trim();
  return (
    /^(arxiv:)?\d{4}\.\d{4,5}(v\d+)?$/i.test(t) ||
    /(arxiv\.org|alphaxiv\.org|huggingface\.co\/papers|openalex\.org\/W)/i.test(t) ||
    /\b10\.\d{4,9}\/\S+/.test(t)
  );
}

function sameId(a: string, b: string) {
  return a.replace(/v\d+$/i, "").toLowerCase() === b.replace(/v\d+$/i, "").toLowerCase();
}

/** Preview of a resolved paper with labels and a Save button. */
export function ResolvedPreview({
  paper,
  labels,
  savedIds,
  onSaved,
  canEdit = true,
}: {
  paper: ResolvedPaper;
  labels: string[];
  savedIds: string[];
  onSaved?: () => void;
  canEdit?: boolean;
}) {
  const toast = useToast();
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const existing = savedIds.find((id) => sameId(id, paper.arxivId));
  const [done, setDone] = useState<string>("");

  async function save() {
    setSaving(true);
    try {
      await sendJson("/api/saved", "POST", { ...paper, labelNames: chosen });
      setDone(paper.arxivId);
      toast("Saved to your library");
      onSaved?.();
    } catch (e: any) {
      toast(`Save failed: ${e?.message ?? e}`, { kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  const openId = existing || done;

  return (
    <div className="card" style={{ boxShadow: "none" }}>
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <span className={`badge ${paper.source === "arxiv" ? "badge-arxiv" : ""}`}>{paper.source === "arxiv" ? `arXiv ${paper.arxivId}` : "OpenAlex"}</span>
        {paper.published && <span className="meta">{formatDate(paper.published)}</span>}
      </div>
      <div style={{ fontWeight: 650, lineHeight: 1.35 }}>{paper.title}</div>
      <div className="meta" style={{ marginTop: 3 }}>
        {shortAuthors(paper.authors, 5)}
      </div>
      {paper.summary && <div className="paper-abstract clamp-3" style={{ fontSize: 13.5 }}>{paper.summary}</div>}

      {!canEdit && !openId ? null : openId ? (
        <div className="row" style={{ marginTop: 14 }}>
          <span className="meta">{existing ? "Already in your library." : "Saved."}</span>
          <span className="spacer" />
          <Link className="btn btn-sm btn-primary" href={`/saved?paper=${encodeURIComponent(openId)}`}>
            Open in library →
          </Link>
        </div>
      ) : (
        <>
          <div className="section-title" style={{ marginTop: 16 }}>
            Labels (optional)
          </div>
          <LabelPicker all={labels} selected={chosen} onChange={setChosen} />
          <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner /> : null} Save to library
            </button>
          </div>
        </>
      )}
    </div>
  );
}

type BibEntry = { key: string; title: string; eprint: string; doi: string; url: string };

/** Minimal BibTeX reader: enough to pull out title / eprint / doi / url from each entry. */
export function parseBibtex(text: string): BibEntry[] {
  const out: BibEntry[] = [];
  const entryRe = /@\w+\s*\{\s*([^,\s]*)\s*,/g;
  const starts: { key: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(text))) starts.push({ key: m[1], index: m.index });
  starts.forEach((s, i) => {
    const body = text.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : text.length);
    const field = (name: string) => {
      const fm = body.match(new RegExp(`\\b${name}\\s*=\\s*(\\{((?:[^{}]|\\{[^{}]*\\})*)\\}|"([^"]*)"|([^,\\n]+))`, "i"));
      return (fm?.[2] ?? fm?.[3] ?? fm?.[4] ?? "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    };
    const journal = field("journal");
    const eprint = field("eprint") || (/arxiv/i.test(journal) ? (journal.match(/\d{4}\.\d{4,5}/)?.[0] ?? "") : "");
    out.push({ key: s.key, title: field("title"), eprint, doi: field("doi"), url: field("url") });
  });
  return out.filter((e) => e.title || e.eprint || e.doi || e.url);
}

type ImportRow = BibEntry & { state: "waiting" | "working" | "saved" | "exists" | "notfound" | "error"; info?: string };

function BibImport({ labels, savedIds, onDone }: { labels: string[]; savedIds: string[]; onDone: () => void }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [label, setLabel] = useState("");
  const [running, setRunning] = useState(false);

  async function run(entries: BibEntry[]) {
    setRunning(true);
    const list: ImportRow[] = entries.map((e) => ({ ...e, state: "waiting" }));
    setRows(list);
    const update = (i: number, patch: Partial<ImportRow>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const known = [...savedIds];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      update(i, { state: "working" });
      try {
        const query = e.eprint || (e.url && /arxiv|openalex|doi\.org/i.test(e.url) ? e.url : "") || e.doi || e.title;
        const paper = await resolveInput(query, !e.eprint && !e.doi);
        if (known.some((id) => sameId(id, paper.arxivId))) {
          update(i, { state: "exists", info: paper.title });
          continue;
        }
        await sendJson("/api/saved", "POST", { ...paper, labelNames: label ? [label] : [] });
        known.push(paper.arxivId);
        update(i, { state: "saved", info: paper.title });
      } catch (err: any) {
        update(i, { state: /404|find/i.test(String(err?.message)) ? "notfound" : "error", info: String(err?.message ?? err) });
      }
    }
    setRunning(false);
    onDone();
  }

  const counts = rows.reduce<Record<string, number>>((c, r) => ((c[r.state] = (c[r.state] ?? 0) + 1), c), {});
  const ICON: Record<ImportRow["state"], string> = { waiting: "·", working: "…", saved: "✓", exists: "=", notfound: "?", error: "✕" };

  return (
    <div>
      <div className="meta" style={{ marginBottom: 10 }}>
        Each entry is matched by its arXiv id, then DOI, then exact title. Existing papers are skipped.
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          type="file"
          accept=".bib,.bibtex,text/plain"
          disabled={running}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const entries = parseBibtex(await f.text());
            if (!entries.length) {
              setRows([]);
              return;
            }
            run(entries);
          }}
        />
        <label className="field-label">
          Add label
          <select className="select" style={{ height: 30 }} value={label} onChange={(e) => setLabel(e.target.value)} disabled={running}>
            <option value="">(none)</option>
            {labels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows.length > 0 && (
        <>
          <div className="meta" style={{ marginBottom: 6 }}>
            {counts.saved ?? 0} saved · {counts.exists ?? 0} already in library · {(counts.notfound ?? 0) + (counts.error ?? 0)} not found
            {running && " · working…"}
          </div>
          <div className="stack" style={{ gap: 4, maxHeight: 260, overflow: "auto" }}>
            {rows.map((r, i) => (
              <div key={i} className="row" style={{ flexWrap: "nowrap", gap: 8, fontSize: 13 }} title={r.info}>
                <span style={{ width: 14, textAlign: "center", flex: "none" }}>{r.state === "working" ? <Spinner /> : ICON[r.state]}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.info && r.state !== "error" && r.state !== "notfound" ? r.info : r.title || r.eprint || r.doi || r.key}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Bookmarklet() {
  const ref = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    // React refuses javascript: URLs in JSX, so set it on the element directly.
    const code = `javascript:(()=>{location.href='${window.location.origin}/add?url='+encodeURIComponent(location.href)})()`;
    ref.current?.setAttribute("href", code);
  }, []);
  return (
    <div>
      <div className="meta" style={{ marginBottom: 12 }}>
        Drag this button to your bookmarks bar. On any arXiv, alphaXiv, Hugging Face Papers or DOI page, click it to add that paper.
      </div>
      <a ref={ref} className="btn btn-primary" onClick={(e) => e.preventDefault()} title="Drag me to your bookmarks bar">
        + Paper Vault
      </a>
    </div>
  );
}

/** "+ Add paper": paste a link/id/DOI, import a .bib file, or install the bookmarklet. */
export function AddPaperModal({
  labels,
  savedIds,
  onClose,
  onChanged,
}: {
  labels: string[];
  savedIds: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<"link" | "bib" | "bookmarklet">("link");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paper, setPaper] = useState<ResolvedPaper | null>(null);

  async function lookup() {
    if (!input.trim()) return;
    setBusy(true);
    setError("");
    setPaper(null);
    try {
      setPaper(await resolveInput(input.trim()));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add papers" onClose={onClose}>
      <div className="segmented" role="tablist" style={{ marginBottom: 14 }}>
        <button type="button" role="tab" className="seg" aria-selected={tab === "link"} onClick={() => setTab("link")}>
          Link / ID / DOI
        </button>
        <button type="button" role="tab" className="seg" aria-selected={tab === "bib"} onClick={() => setTab("bib")}>
          Import .bib
        </button>
        <button type="button" role="tab" className="seg" aria-selected={tab === "bookmarklet"} onClick={() => setTab("bookmarklet")}>
          Bookmarklet
        </button>
      </div>

      {tab === "link" && (
        <div>
          <form
            className="row"
            style={{ flexWrap: "nowrap" }}
            onSubmit={(e) => {
              e.preventDefault();
              lookup();
            }}
          >
            <input
              className="input"
              style={{ flex: 1 }}
              autoFocus
              placeholder="2006.11239, arxiv.org/abs/…, alphaxiv / HF papers link, or a DOI"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className="btn" disabled={busy || !input.trim()}>
              {busy ? <Spinner /> : "Look up"}
            </button>
          </form>
          {error && (
            <div className="notice" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
          {paper && (
            <div style={{ marginTop: 14 }}>
              <ResolvedPreview paper={paper} labels={labels} savedIds={savedIds} onSaved={onChanged} />
            </div>
          )}
        </div>
      )}
      {tab === "bib" && <BibImport labels={labels} savedIds={savedIds} onDone={onChanged} />}
      {tab === "bookmarklet" && <Bookmarklet />}
    </Modal>
  );
}
