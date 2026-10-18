"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJson, sendJson, shortAuthors, titleKey } from "@/lib/papers";
import { useToast } from "./providers";
import { Spinner, StarIcon } from "./ui";

type RelatedPaper = {
  openalexId: string;
  title: string;
  year: number | null;
  date: string;
  authors: string;
  citedBy: number;
  arxivId: string;
  url: string;
  abstract: string;
};

type Data = { references: RelatedPaper[]; citations: RelatedPaper[]; counts: { references: number; citations: number } };

/** "Cited by" and "References" for a paper, with one-click save for anything on arXiv. */
export function RelatedPapers({
  arxivId,
  canEdit,
  savedIds,
  onSaved,
}: {
  arxivId: string;
  canEdit: boolean;
  /** Lower-cased ids already in the library: bare arXiv ids and "openalex:…" ids. */
  savedIds: Set<string>;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"citations" | "references">("citations");
  const [onlyArxiv, setOnlyArxiv] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    fetchJson<Data>(`/api/related?arxivId=${encodeURIComponent(arxivId)}`)
      .then((j) => !cancelled && setData(j))
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [arxivId]);

  const list = useMemo(() => {
    const l = data ? data[view] : [];
    return onlyArxiv ? l.filter((p) => p.arxivId) : l;
  }, [data, view, onlyArxiv]);

  function isSaved(p: RelatedPaper) {
    if (p.arxivId && savedIds.has(p.arxivId.toLowerCase())) return true;
    return savedIds.has(`openalex:${p.openalexId}`.toLowerCase()) || savedIds.has(titleKey(p.title));
  }

  async function save(p: RelatedPaper) {
    setSaving(p.openalexId);
    try {
      const body = p.arxivId
        ? {
            arxivId: p.arxivId,
            absUrl: `https://arxiv.org/abs/${p.arxivId}`,
            pdfUrl: `https://arxiv.org/pdf/${p.arxivId}`,
          }
        : { arxivId: `openalex:${p.openalexId}`, absUrl: p.url, pdfUrl: p.url };
      await sendJson("/api/saved", "POST", {
        ...body,
        title: p.title,
        authors: p.authors,
        summary: p.abstract,
        published: p.date || (p.year ? String(p.year) : ""),
        labelNames: [],
      });
      toast(`Saved “${p.title.slice(0, 60)}${p.title.length > 60 ? "…" : ""}”`);
      await onSaved();
    } catch (e: any) {
      toast(`Save failed: ${e?.message ?? e}`, { kind: "error" });
    } finally {
      setSaving(null);
    }
  }

  if (error) return <div className="notice info">{error}</div>;
  if (!data) {
    return (
      <div className="card row">
        <Spinner /> <span className="muted">Loading citations and references from OpenAlex…</span>
      </div>
    );
  }

  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="segmented" role="tablist">
          <button type="button" role="tab" className="seg" aria-selected={view === "citations"} onClick={() => setView("citations")}>
            Cited by · {data.counts.citations.toLocaleString()}
          </button>
          <button type="button" role="tab" className="seg" aria-selected={view === "references"} onClick={() => setView("references")}>
            References · {data.counts.references}
          </button>
        </div>
        <span className="spacer" />
        <label className="field-label" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={onlyArxiv} onChange={(e) => setOnlyArxiv(e.target.checked)} /> arXiv only
        </label>
      </div>
      <div className="meta" style={{ marginBottom: 10 }}>
        {view === "citations"
          ? `The ${data.citations.length} most-cited papers that cite this one.`
          : "Papers this one cites, most-cited first."}{" "}
        Source: OpenAlex.
      </div>

      {list.length === 0 ? (
        <div className="meta">Nothing to show.</div>
      ) : (
        <div className="stack" style={{ gap: 0 }}>
          {list.map((p) => {
            const saved = isSaved(p);
            return (
              <div key={p.openalexId} className="related-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a className="paper-title" style={{ fontSize: 14 }} href={p.url} target="_blank" rel="noreferrer">
                    {p.title}
                  </a>
                  <div className="meta" style={{ fontSize: 12.5, marginTop: 2 }}>
                    {shortAuthors(p.authors, 3)}
                    {p.year ? ` · ${p.year}` : ""} · {p.citedBy.toLocaleString()} citations
                    {p.arxivId ? ` · arXiv ${p.arxivId}` : ""}
                    {p.abstract && (
                      <>
                        {" · "}
                        <button type="button" className="link-btn" style={{ fontSize: 12.5 }} onClick={() => setOpen(open === p.openalexId ? null : p.openalexId)}>
                          {open === p.openalexId ? "hide abstract" : "abstract"}
                        </button>
                      </>
                    )}
                  </div>
                  {open === p.openalexId && <div className="paper-abstract" style={{ fontSize: 13.5 }}>{p.abstract}</div>}
                </div>
                {saved ? (
                  <span className="btn btn-sm btn-saved" style={{ cursor: "default" }}>
                    <StarIcon filled size={13} /> Saved
                  </span>
                ) : (
                  canEdit && (
                    <button type="button" className="btn btn-sm" disabled={saving === p.openalexId} onClick={() => save(p)}>
                      {saving === p.openalexId ? <Spinner /> : <StarIcon size={13} />} Save
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
