"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type Label,
  type Paper,
  colorForLabel,
  fetchJson,
  formatDate,
  isOpenAlex,
  renderMarkdown,
  sendJson,
  shortAuthors,
  toBibtex,
} from "@/lib/papers";
import { bareArxivId, versionOf } from "@/lib/papers";
import { useCanEdit, useToast } from "../components/providers";
import { PdfReader } from "../components/pdf-reader";
import { CodeIcon, GlobeIcon, PaperLinks } from "../components/paper-links";
import { VersionsPanel, useVersions } from "../components/versions";
import {
  ConfirmModal,
  LabelChip,
  LabelPicker,
  Menu,
  Modal,
  PrivateNote,
  PromptModal,
  ReadOnlyNotice,
  SearchIcon,
  Spinner,
  copyText,
} from "../components/ui";

const ALL = "__all__";
const UNLABELED = "__unlabeled__";

type SortKey = "saved-desc" | "saved-asc" | "published-desc" | "published-asc" | "title";
type Tab = "overview" | "pdf" | "versions" | "summary";

function parseMs(s?: string | null) {
  const ms = Date.parse(String(s || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function asEmbedPdfUrl(u: string) {
  let s = String(u || "").trim();
  if (!s) return "";

  // If URL has no scheme (e.g., "arxiv.org/pdf/..."), treat it as https.
  if (!/^https?:\/\//i.test(s)) {
    if (s.startsWith("//")) s = "https:" + s;
    else s = "https://" + s.replace(/^\/+/, "");
  }

  // Avoid mixed-content issues.
  s = s.replace(/^http:\/\//i, "https://");

  // Prefer direct arXiv PDF links.
  if (/arxiv\.org\/abs\//i.test(s)) {
    s = s.replace(/arxiv\.org\/abs\//i, "arxiv.org/pdf/");
    if (!/\.pdf(\?.*)?$/i.test(s)) s = s + ".pdf";
    return s;
  }

  if (/\.pdf(\?.*)?$/i.test(s)) return s;

  // arXiv pdf links sometimes omit .pdf
  if (/arxiv\.org\/pdf\//i.test(s)) return s + ".pdf";

  return s;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hasText(s?: string | null) {
  return !!String(s ?? "").trim();
}

/* ------------------------------------------------------------------ */
/* Detail view                                                         */
/* ------------------------------------------------------------------ */

function PaperDetail({
  paper,
  labels,
  canEdit,
  prevId,
  nextId,
  onBack,
  onOpen,
  onFilterLabel,
  onChanged,
  onRemove,
}: {
  paper: Paper;
  labels: Label[];
  canEdit: boolean;
  prevId: string | null;
  nextId: string | null;
  onBack: () => void;
  onOpen: (id: string) => void;
  onFilterLabel: (name: string) => void;
  onChanged: () => Promise<void>;
  onRemove: (p: Paper) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const savedVersion = versionOf(paper.arxivId);
  const [readingVersion, setReadingVersion] = useState(savedVersion);
  const [annotationCounts, setAnnotationCounts] = useState<Record<string, number>>({});
  const [versionsWanted, setVersionsWanted] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState(String(paper.note ?? ""));
  const [noteSaving, setNoteSaving] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState<string[]>([]);
  const [summarizing, setSummarizing] = useState(false);

  const openAlex = isOpenAlex(paper);
  const { versions, error: versionsError } = useVersions(paper.arxivId, !openAlex && versionsWanted);
  const readingPdfUrl = readingVersion ? `https://arxiv.org/pdf/${bareArxivId(paper.arxivId)}${readingVersion}` : "";
  const pdfUrl = openAlex ? "" : asEmbedPdfUrl(paper.pdfUrl) || asEmbedPdfUrl(paper.absUrl);
  const proxiedPdf = pdfUrl ? `/api/pdf?url=${encodeURIComponent(pdfUrl)}` : "";
  const paperLabels = paper.labelNames ?? [];

  // Reset per-paper UI state when switching papers.
  useEffect(() => {
    setNoteEditing(false);
    setNoteDraft(String(paper.note ?? ""));
    setLabelsOpen(false);
    setReadingVersion(versionOf(paper.arxivId));
    setVersionsWanted(false);
    setAnnotationCounts({});
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper.arxivId]);

  useEffect(() => {
    if (tab === "pdf" || tab === "versions") setVersionsWanted(true);
  }, [tab]);

  // Highlight counts per version (the reader keeps them current once it's open).
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ annotations: { version: string }[] }>(`/api/annotations?arxivId=${encodeURIComponent(paper.arxivId)}`)
      .then((j) => {
        if (cancelled) return;
        const counts: Record<string, number> = {};
        for (const a of j.annotations ?? []) counts[a.version || ""] = (counts[a.version || ""] ?? 0) + 1;
        setAnnotationCounts(counts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [paper.arxivId]);

  // ←/→ move between papers in the current list (when not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" && prevId) onOpen(prevId);
      if (e.key === "ArrowRight" && nextId) onOpen(nextId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevId, nextId, onOpen]);

  async function saveLabels(next: string[]) {
    try {
      await sendJson("/api/saved", "PATCH", { arxivId: paper.arxivId, labelNames: next });
      await onChanged();
    } catch (e: any) {
      toast(`Couldn't update labels: ${e?.message ?? e}`, { kind: "error" });
    }
  }

  async function saveNote() {
    setNoteSaving(true);
    try {
      await sendJson("/api/saved", "PATCH", { arxivId: paper.arxivId, note: noteDraft });
      await onChanged();
      setNoteEditing(false);
      toast("Note saved");
    } catch (e: any) {
      toast(`Couldn't save note: ${e?.message ?? e}`, { kind: "error" });
    } finally {
      setNoteSaving(false);
    }
  }

  async function generateSummary(force: boolean) {
    setSummarizing(true);
    try {
      await sendJson("/api/summarize", "POST", { arxivId: paper.arxivId, force });
      await onChanged();
    } catch (e: any) {
      toast(`Summary failed: ${e?.message ?? e}`, { kind: "error" });
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <div>
      <div className="row">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>
          ← Library
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={!prevId}
          onClick={() => prevId && onOpen(prevId)}
          title="Previous paper (←)"
        >
          ‹ Prev
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={!nextId}
          onClick={() => nextId && onOpen(nextId)}
          title="Next paper (→)"
        >
          Next ›
        </button>
      </div>

      <div style={{ marginTop: 14 }}>
        <h1 className="page-title" style={{ fontSize: 24, lineHeight: 1.25 }}>
          {paper.title}
        </h1>
        <div className="paper-authors" style={{ fontSize: 14.5, marginTop: 8 }}>
          {paper.authors}
        </div>
        <div className="meta row" style={{ gap: 0, marginTop: 8 }}>
          <span className={`badge ${openAlex ? "" : "badge-arxiv"}`}>{openAlex ? "OpenAlex" : `arXiv ${paper.arxivId}`}</span>
          {paper.published && <span className="dot-sep">Published {formatDate(paper.published)}</span>}
          {paper.createdAt && <span className="dot-sep">Saved {formatDate(paper.createdAt)}</span>}
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <a className="btn btn-sm" href={paper.absUrl} target="_blank" rel="noreferrer">
            {openAlex ? "Open source page ↗" : "arXiv page ↗"}
          </a>
          {!openAlex && (
            <a className="btn btn-sm" href={pdfUrl || paper.pdfUrl} target="_blank" rel="noreferrer">
              PDF ↗
            </a>
          )}
          {!openAlex && <PaperLinks arxivId={paper.arxivId} canEdit={canEdit} />}
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              if (await copyText(toBibtex(paper))) toast("BibTeX copied");
            }}
          >
            Copy BibTeX
          </button>
          {canEdit && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => onRemove(paper)}>
              Remove
            </button>
          )}
        </div>

        <div className="row" style={{ marginTop: 14, gap: 6 }}>
          {paperLabels.map((n) => (
            <LabelChip
              key={n}
              name={n}
              onClick={() => onFilterLabel(n)}
              onRemove={canEdit ? () => saveLabels(paperLabels.filter((x) => x !== n)) : undefined}
            />
          ))}
          {canEdit && (
            <button
              type="button"
              className="chip chip-plain"
              onClick={() => {
                setLabelDraft(paperLabels);
                setLabelsOpen(true);
              }}
            >
              + Add label
            </button>
          )}
          {!canEdit && paperLabels.length === 0 && <span className="meta">No labels</span>}
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button type="button" role="tab" className="tab" aria-selected={tab === "pdf"} onClick={() => setTab("pdf")}>
          Read{Object.values(annotationCounts).reduce((n, c) => n + c, 0) ? ` · ${Object.values(annotationCounts).reduce((n, c) => n + c, 0)}` : ""}
        </button>
        {!openAlex && (
          <button type="button" role="tab" className="tab" aria-selected={tab === "versions"} onClick={() => setTab("versions")}>
            Versions{versions && versions.length > 1 ? ` · ${versions.length}` : ""}
          </button>
        )}
        <button type="button" role="tab" className="tab" aria-selected={tab === "summary"} onClick={() => setTab("summary")}>
          AI summary{hasText(paper.aiSummary) ? " ✓" : ""}
        </button>
      </div>

      <div style={{ marginTop: 18 }}>
        {tab === "overview" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
            <section className="card">
              <h2 className="section-title">Abstract</h2>
              <div className="paper-abstract" style={{ marginTop: 0 }}>
                {paper.summary || <span className="meta">No abstract available.</span>}
              </div>
            </section>

            <section className="card">
              <div className="row" style={{ marginBottom: 10 }}>
                <h2 className="section-title" style={{ margin: 0 }}>
                  Notes
                </h2>
                <span className="spacer" />
                {canEdit &&
                  (noteEditing ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                          setNoteDraft(String(paper.note ?? ""));
                          setNoteEditing(false);
                        }}
                        disabled={noteSaving}
                      >
                        Cancel
                      </button>
                      <button type="button" className="btn btn-sm btn-primary" onClick={saveNote} disabled={noteSaving}>
                        {noteSaving ? <Spinner /> : "Save"}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-sm" onClick={() => setNoteEditing(true)}>
                      {hasText(paper.note) ? "Edit" : "Add note"}
                    </button>
                  ))}
              </div>

              {noteEditing ? (
                <>
                  <textarea
                    className="textarea"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        saveNote();
                      }
                      if (e.key === "Escape") {
                        setNoteDraft(String(paper.note ?? ""));
                        setNoteEditing(false);
                      }
                    }}
                    placeholder={"Write notes in Markdown…\n\n## Key idea\n- …"}
                    style={{ minHeight: 260 }}
                    autoFocus
                  />
                  <div className="meta" style={{ marginTop: 6, fontSize: 12 }}>
                    Markdown supported · <span className="kbd">⌘/Ctrl</span> + <span className="kbd">Enter</span> to save ·{" "}
                    <span className="kbd">Esc</span> to cancel
                  </div>
                </>
              ) : paper.noteHidden ? (
                <PrivateNote text={String(paper.note ?? "")} />
              ) : hasText(paper.note) ? (
                <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(String(paper.note)) }} />
              ) : (
                <div className="meta">No notes yet.</div>
              )}
            </section>
          </div>
        )}

        {tab === "pdf" &&
          (proxiedPdf ? (
            <div>
              {versions && versions.length > 1 && (
                <div className="row" style={{ marginBottom: 10 }}>
                  <span className="meta">Version</span>
                  {versions.map((v) => (
                    <button
                      key={v.version}
                      type="button"
                      className={`chip chip-plain`}
                      aria-pressed={(readingVersion || versions[versions.length - 1].version) === v.version}
                      onClick={() => setReadingVersion(v.version)}
                      title={`${v.version} · ${formatDate(v.date)}`}
                    >
                      {v.version}
                      {annotationCounts[v.version] ? <span className="chip-count">✎{annotationCounts[v.version]}</span> : null}
                    </button>
                  ))}
                  <span className="spacer" />
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTab("versions")}>
                    Compare versions →
                  </button>
                </div>
              )}
              <PdfReader
                key={readingVersion}
                arxivId={paper.arxivId}
                version={readingVersion}
                pdfUrl={readingPdfUrl || pdfUrl}
                canEdit={canEdit}
                onCountsChange={setAnnotationCounts}
              />
            </div>
          ) : (
            <div className="empty">
              <div className="empty-title">No embeddable PDF</div>
              <div>
                This paper comes from OpenAlex.{" "}
                <a href={paper.absUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                  Open the source page
                </a>{" "}
                to find the full text.
              </div>
            </div>
          ))}

        {tab === "versions" && (
          <VersionsPanel
            versions={versions}
            error={versionsError}
            savedVersion={savedVersion}
            readingVersion={readingVersion}
            annotationCounts={annotationCounts}
            onRead={(v) => {
              setReadingVersion(v);
              setTab("pdf");
            }}
          />
        )}

        {tab === "summary" && (
          <section className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <h2 className="section-title" style={{ margin: 0 }}>
                AI summary
              </h2>
              <span className="spacer" />
              {canEdit && !openAlex && (
                <button
                  type="button"
                  className={`btn btn-sm ${hasText(paper.aiSummary) ? "" : "btn-primary"}`}
                  onClick={() => generateSummary(hasText(paper.aiSummary))}
                  disabled={summarizing}
                >
                  {summarizing ? (
                    <>
                      <Spinner /> Generating…
                    </>
                  ) : hasText(paper.aiSummary) ? (
                    "Regenerate"
                  ) : (
                    "Generate"
                  )}
                </button>
              )}
            </div>
            {summarizing && !hasText(paper.aiSummary) ? (
              <div className="stack" style={{ gap: 8 }}>
                {[90, 100, 75, 95, 60].map((w, i) => (
                  <div key={i} className="skeleton" style={{ height: 12, width: `${w}%` }} />
                ))}
                <div className="meta" style={{ marginTop: 6 }}>
                  Reading the PDF — this can take up to a minute.
                </div>
              </div>
            ) : hasText(paper.aiSummary) ? (
              <div className="prose" style={{ opacity: summarizing ? 0.5 : 1 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(String(paper.aiSummary)) }} />
            ) : (
              <div className="meta">
                {openAlex
                  ? "AI summaries need an arXiv PDF."
                  : canEdit
                    ? "No summary yet. Generate one from the paper's PDF with Gemini."
                    : "No summary yet."}
              </div>
            )}
          </section>
        )}
      </div>

      {labelsOpen && (
        <Modal
          title="Edit labels"
          onClose={() => setLabelsOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setLabelsOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  setLabelsOpen(false);
                  await saveLabels(labelDraft);
                }}
              >
                Save labels
              </button>
            </>
          }
        >
          <LabelPicker all={labels.map((l) => l.name)} selected={labelDraft} onChange={setLabelDraft} />
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Library list                                                        */
/* ------------------------------------------------------------------ */

function LibraryCard({
  p,
  activeLabel,
  canEdit,
  onOpen,
  onFilterLabel,
  onRemove,
}: {
  p: Paper;
  activeLabel: string;
  canEdit: boolean;
  onOpen: () => void;
  onFilterLabel: (name: string) => void;
  onRemove: () => void;
}) {
  const toast = useToast();
  const openAlex = isOpenAlex(p);

  return (
    <article className="card paper-card">
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button type="button" className="paper-title" onClick={onOpen}>
            {p.title}
          </button>
          <div className="paper-authors" title={p.authors}>
            {shortAuthors(p.authors)}
          </div>
          <div className="meta row" style={{ gap: 0, marginTop: 6 }}>
            <span className={`badge ${openAlex ? "" : "badge-arxiv"}`}>{openAlex ? "OpenAlex" : "arXiv"}</span>
            {p.published && <span className="dot-sep">{formatDate(p.published)}</span>}
            {hasText(p.note) && (
              <span className="dot-sep" title="Has notes">
                📝 notes
              </span>
            )}
            {hasText(p.aiSummary) && (
              <span className="dot-sep" title="Has AI summary">
                ✨ summary
              </span>
            )}
            {!!p.annotationCount && (
              <span className="dot-sep" title="Highlights in the PDF">
                🖍 {p.annotationCount}
              </span>
            )}
            {(p.links ?? []).map((l) => (
              <a
                key={l.url}
                className="dot-sep card-link"
                href={l.url}
                target="_blank"
                rel="noreferrer"
                title={l.url}
                onClick={(e) => e.stopPropagation()}
              >
                {l.kind === "code" ? <CodeIcon size={12} /> : <GlobeIcon size={12} />}
                {l.kind === "code" ? "code" : "project"}
              </a>
            ))}
          </div>
        </div>
        <Menu>
          {(close) => (
            <>
              <button type="button" className="menu-item" onClick={() => { close(); onOpen(); }}>
                Open
              </button>
              <a className="menu-item" href={p.absUrl} target="_blank" rel="noreferrer" onClick={close}>
                {openAlex ? "Source page ↗" : "arXiv page ↗"}
              </a>
              {!openAlex && (
                <a className="menu-item" href={p.pdfUrl} target="_blank" rel="noreferrer" onClick={close}>
                  PDF ↗
                </a>
              )}
              <button
                type="button"
                className="menu-item"
                onClick={async () => {
                  close();
                  if (await copyText(toBibtex(p))) toast("BibTeX copied");
                }}
              >
                Copy BibTeX
              </button>
              {canEdit && (
                <button type="button" className="menu-item danger" onClick={() => { close(); onRemove(); }}>
                  Remove from library
                </button>
              )}
            </>
          )}
        </Menu>
      </div>

      {(p.labelNames ?? []).length > 0 && (
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          {(p.labelNames ?? []).map((n) => (
            <LabelChip key={n} name={n} pressed={activeLabel === n} onClick={() => onFilterLabel(n)} />
          ))}
        </div>
      )}

      {p.summary && <div className="paper-abstract clamp-2">{p.summary}</div>}
    </article>
  );
}

function SavedPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = (searchParams.get("paper") ?? "").trim();
  const canEdit = useCanEdit();
  const toast = useToast();

  const [items, setItems] = useState<Paper[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [activeLabel, setActiveLabel] = useState<string>(ALL);
  const [searchText, setSearchText] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("saved-desc");
  const [labelDialog, setLabelDialog] = useState<
    { kind: "create" } | { kind: "rename"; name: string } | { kind: "delete"; name: string } | null
  >(null);

  const reload = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        fetchJson<{ items: Paper[] }>("/api/saved"),
        fetchJson<{ labels: Label[] }>("/api/saved?type=labels"),
      ]);
      setItems(s.items ?? []);
      setLabels(l.labels ?? []);
      setLoadError("");
    } catch (e: any) {
      setLoadError(String(e?.message ?? e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const unlabeledCount = useMemo(() => items.filter((p) => (p.labelNames ?? []).length === 0).length, [items]);

  const filtered = useMemo(() => {
    let out = items;
    if (activeLabel === UNLABELED) out = out.filter((p) => (p.labelNames ?? []).length === 0);
    else if (activeLabel !== ALL) out = out.filter((p) => (p.labelNames ?? []).includes(activeLabel));

    const terms = searchText.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) {
      out = out.filter((p) => {
        const hay = [p.title, p.authors, p.summary, p.noteHidden ? "" : p.note ?? "", (p.labelNames ?? []).join(" ")].join(" \n ").toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }

    const sorted = [...out];
    const byTitle = (a: Paper, b: Paper) => a.title.localeCompare(b.title);
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "saved-asc":
          return parseMs(a.createdAt) - parseMs(b.createdAt) || byTitle(a, b);
        case "published-desc":
          return parseMs(b.published) - parseMs(a.published) || byTitle(a, b);
        case "published-asc":
          return parseMs(a.published) - parseMs(b.published) || byTitle(a, b);
        case "title":
          return byTitle(a, b);
        default:
          return parseMs(b.createdAt) - parseMs(a.createdAt) || byTitle(a, b);
      }
    });
    return sorted;
  }, [items, activeLabel, searchText, sortKey]);

  const selectedPaper = useMemo(() => items.find((p) => p.arxivId === selectedId) ?? null, [items, selectedId]);

  // Prev/next follow the current filtered list; fall back to the full list if the paper isn't in it.
  const nav = useMemo(() => {
    const list = filtered.some((p) => p.arxivId === selectedId) ? filtered : items;
    const i = list.findIndex((p) => p.arxivId === selectedId);
    return {
      prevId: i > 0 ? list[i - 1].arxivId : null,
      nextId: i >= 0 && i < list.length - 1 ? list[i + 1].arxivId : null,
    };
  }, [filtered, items, selectedId]);

  const openPaper = useCallback(
    (id: string) => router.push(`/saved?paper=${encodeURIComponent(id)}`),
    [router]
  );

  function closePaper() {
    router.push("/saved");
  }

  function filterByLabel(name: string) {
    setActiveLabel(name);
    if (selectedId) closePaper();
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removePaper(p: Paper) {
    try {
      await fetchJson(`/api/saved/${encodeURIComponent(p.arxivId)}`, { method: "DELETE" });
      if (selectedId === p.arxivId) closePaper();
      await reload();
      toast("Removed from your library", {
        action: {
          label: "Undo",
          run: async () => {
            await sendJson("/api/saved", "POST", { ...p, labelNames: p.labelNames ?? [] });
            await reload();
          },
        },
      });
    } catch (e: any) {
      toast(`Remove failed: ${e?.message ?? e}`, { kind: "error" });
    }
  }

  async function createLabel(name: string) {
    if (labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      toast(`Label "${name}" already exists`, { kind: "error" });
      return;
    }
    try {
      await sendJson("/api/saved", "POST", { kind: "label", name });
      setLabelDialog(null);
      await reload();
      toast(`Label "${name}" created`);
    } catch (e: any) {
      toast(`Couldn't create label: ${e?.message ?? e}`, { kind: "error" });
    }
  }

  async function renameLabel(from: string, to: string) {
    if (to === from) {
      setLabelDialog(null);
      return;
    }
    try {
      await sendJson("/api/saved", "PATCH", { kind: "label", from, to });
      setLabelDialog(null);
      if (activeLabel === from) setActiveLabel(to);
      await reload();
    } catch (e: any) {
      toast(`Couldn't rename label: ${e?.message ?? e}`, { kind: "error" });
    }
  }

  async function deleteLabel(name: string) {
    try {
      await fetchJson(`/api/saved?type=label&name=${encodeURIComponent(name)}`, { method: "DELETE" });
      setLabelDialog(null);
      if (activeLabel === name) setActiveLabel(ALL);
      await reload();
    } catch (e: any) {
      toast(`Couldn't delete label: ${e?.message ?? e}`, { kind: "error" });
    }
  }

  function exportBibtex() {
    if (filtered.length === 0) return;
    const bib = filtered.map(toBibtex).join("\n\n") + "\n";
    const suffix = activeLabel === ALL ? "library" : activeLabel === UNLABELED ? "unlabeled" : activeLabel;
    downloadText(`paper-vault-${suffix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.bib`, bib);
    toast(`Exported ${filtered.length} entr${filtered.length === 1 ? "y" : "ies"}`);
  }

  if (selectedId) {
    return (
      <main className="container page">
        <ReadOnlyNotice what="assign labels, write notes and generate summaries" />
        <div style={{ height: 16 }} />
        {!loaded ? (
          <div className="stack">
            <div className="skeleton" style={{ height: 28, width: "60%" }} />
            <div className="skeleton" style={{ height: 14, width: "40%" }} />
          </div>
        ) : selectedPaper ? (
          <PaperDetail
            paper={selectedPaper}
            labels={labels}
            canEdit={canEdit}
            prevId={nav.prevId}
            nextId={nav.nextId}
            onBack={closePaper}
            onOpen={openPaper}
            onFilterLabel={filterByLabel}
            onChanged={reload}
            onRemove={removePaper}
          />
        ) : (
          <div className="empty">
            <div className="empty-title">Paper not found</div>
            <div>It may have been removed from your library.</div>
            <button type="button" className="btn" style={{ marginTop: 14 }} onClick={closePaper}>
              ← Back to library
            </button>
          </div>
        )}
      </main>
    );
  }

  const activeTitle = activeLabel === ALL ? "All papers" : activeLabel === UNLABELED ? "Unlabeled" : activeLabel;

  return (
    <main className="container page">
      <div className="library">
        <aside className="sidebar" aria-label="Filter by label">
          <button type="button" className="side-item" aria-current={activeLabel === ALL} onClick={() => setActiveLabel(ALL)}>
            All papers
            <span className="count">{items.length}</span>
          </button>
          <button
            type="button"
            className="side-item"
            aria-current={activeLabel === UNLABELED}
            onClick={() => setActiveLabel(UNLABELED)}
          >
            Unlabeled
            <span className="count">{unlabeledCount}</span>
          </button>

          <div className="section-title" style={{ margin: "18px 10px 6px" }}>
            Labels
          </div>
          {labels.map((l) => (
            <div
              key={l.id}
              role="button"
              tabIndex={0}
              className="side-item"
              aria-current={activeLabel === l.name}
              onClick={() => setActiveLabel(l.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveLabel(l.name);
                }
              }}
            >
              <span className="swatch" style={{ background: colorForLabel(l.name) }} />
              <span className="side-name">{l.name}</span>
              <span className="side-trail">
              <span className="count">{l.count}</span>
              {canEdit && (
                <span className="actions">
                  <button
                    type="button"
                    className="mini-btn"
                    title="Rename label"
                    aria-label={`Rename ${l.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setLabelDialog({ kind: "rename", name: l.name });
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="mini-btn"
                    title="Delete label"
                    aria-label={`Delete ${l.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setLabelDialog({ kind: "delete", name: l.name });
                    }}
                  >
                    ✕
                  </button>
                </span>
              )}
              </span>
            </div>
          ))}
          {canEdit && (
            <button type="button" className="side-item muted" onClick={() => setLabelDialog({ kind: "create" })}>
              + New label
            </button>
          )}
        </aside>

        <section style={{ minWidth: 0 }}>
          <div className="row" style={{ alignItems: "baseline" }}>
            <h1 className="page-title">{activeTitle}</h1>
            <span className="meta">
              {loaded
                ? filtered.length === items.length
                  ? `${items.length} paper${items.length === 1 ? "" : "s"}`
                  : `${filtered.length} of ${items.length}`
                : ""}
            </span>
          </div>

          <ReadOnlyNotice what="create labels, edit notes and manage papers" />

          <div className="row" style={{ marginTop: 14, gap: 10 }}>
            <div className="searchbox" style={{ flex: "1 1 260px" }}>
              <span className="searchbox-icon">
                <SearchIcon />
              </span>
              <input
                className="input"
                style={{ height: 38, fontSize: 14 }}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Filter by title, author, abstract, notes…"
                aria-label="Filter library"
              />
            </div>
            <select className="select" style={{ height: 38 }} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort">
              <option value="saved-desc">Recently saved</option>
              <option value="saved-asc">Oldest saved</option>
              <option value="published-desc">Newest published</option>
              <option value="published-asc">Oldest published</option>
              <option value="title">Title A–Z</option>
            </select>
            <button type="button" className="btn" style={{ height: 38 }} onClick={exportBibtex} disabled={filtered.length === 0} title="Download the papers shown as a .bib file">
              Export .bib
            </button>
          </div>

          {(searchText.trim() || activeLabel !== ALL) && (
            <div className="row" style={{ marginTop: 10 }}>
              <span className="meta">Filters:</span>
              {activeLabel !== ALL && (
                <span className="chip chip-plain" style={{ cursor: "default" }}>
                  {activeTitle}
                  <button type="button" className="chip-x" aria-label="Clear label filter" onClick={() => setActiveLabel(ALL)}>
                    ×
                  </button>
                </span>
              )}
              {searchText.trim() && (
                <span className="chip chip-plain" style={{ cursor: "default" }}>
                  “{searchText.trim()}”
                  <button type="button" className="chip-x" aria-label="Clear text filter" onClick={() => setSearchText("")}>
                    ×
                  </button>
                </span>
              )}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            {loadError ? (
              <div className="notice">Couldn&apos;t load your library: {loadError}</div>
            ) : !loaded ? (
              <div className="stack">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="card">
                    <div className="skeleton" style={{ height: 18, width: "65%" }} />
                    <div className="skeleton" style={{ height: 13, width: "40%", marginTop: 10 }} />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="empty">
                <div className="empty-title">Your library is empty</div>
                <div>Search for papers and press Save to collect them here.</div>
                <Link href="/" className="btn btn-primary" style={{ marginTop: 16 }}>
                  Find papers
                </Link>
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty">
                <div className="empty-title">Nothing matches</div>
                <div>Try another label or clear the filters.</div>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 14 }}
                  onClick={() => {
                    setSearchText("");
                    setActiveLabel(ALL);
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="stack">
                {filtered.map((p) => (
                  <LibraryCard
                    key={p.arxivId}
                    p={p}
                    activeLabel={activeLabel}
                    canEdit={canEdit}
                    onOpen={() => openPaper(p.arxivId)}
                    onFilterLabel={filterByLabel}
                    onRemove={() => removePaper(p)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {labelDialog?.kind === "create" && (
        <PromptModal
          title="New label"
          label="Label name"
          confirmText="Create label"
          onSubmit={createLabel}
          onClose={() => setLabelDialog(null)}
        />
      )}
      {labelDialog?.kind === "rename" && (
        <PromptModal
          title="Rename label"
          label="New name"
          initial={labelDialog.name}
          confirmText="Rename"
          onSubmit={(to) => renameLabel(labelDialog.name, to)}
          onClose={() => setLabelDialog(null)}
        />
      )}
      {labelDialog?.kind === "delete" && (
        <ConfirmModal
          title={`Delete label "${labelDialog.name}"?`}
          confirmText="Delete label"
          onConfirm={() => deleteLabel(labelDialog.name)}
          onClose={() => setLabelDialog(null)}
        >
          It will be removed from every paper that has it. The papers themselves stay in your library.
        </ConfirmModal>
      )}
    </main>
  );
}

export default function SavedPage() {
  return (
    <Suspense fallback={null}>
      <SavedPageInner />
    </Suspense>
  );
}
