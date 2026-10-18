"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type Label,
  type Paper,
  fetchJson,
  formatDate,
  isOpenAlex,
  restoreAnnotations,
  sendJson,
  shortAuthors,
  snapshotAnnotations,
} from "@/lib/papers";
import { useCanEdit, useToast } from "./components/providers";
import { LabelChip, LabelPicker, Modal, ReadOnlyNotice, SearchIcon, Spinner, StarIcon } from "./components/ui";
import { HomeExtras } from "./components/home-extras";
import { looksResolvable, resolveInput } from "./components/quick-add";
import { FollowSearchButton } from "./components/followed-searches";

type Field = "smart" | "title" | "author" | "abstract" | "all";
type Sort = "relevance" | "submittedDate" | "lastUpdatedDate" | "citations";
type Order = "descending" | "ascending";

const PAGE_SIZE = 10;

const SUGGESTIONS = [
  "diffusion models",
  "graph neural networks",
  "retrieval augmented generation",
  "foundation models",
  "protein folding",
  "LLM agents",
];

const FIELDS: Field[] = ["smart", "title", "author", "abstract", "all"];
const SORTS: Sort[] = ["relevance", "citations", "submittedDate", "lastUpdatedDate"];

function pick<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function ResultCard({
  p,
  saved,
  labelNames,
  canEdit,
  onSave,
  onUnsave,
}: {
  p: Paper;
  saved: boolean;
  labelNames: string[];
  canEdit: boolean;
  onSave: () => void;
  onUnsave: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const openAlex = isOpenAlex(p);
  const long = (p.summary ?? "").length > 360;

  return (
    <article className="card paper-card">
      <div className="card-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <a className="paper-title" href={p.absUrl} target="_blank" rel="noreferrer">
            {p.title}
          </a>
          <div className="paper-authors" title={p.authors}>
            {shortAuthors(p.authors)}
          </div>
          <div className="meta row" style={{ gap: 0, marginTop: 6 }}>
            <span className={`badge ${openAlex ? "" : "badge-arxiv"}`}>{openAlex ? "OpenAlex" : "arXiv"}</span>
            {p.published && <span className="dot-sep">{formatDate(p.published)}</span>}
            {typeof p.citationCount === "number" && (
              <span className="dot-sep" title="Citations">
                {p.citationCount.toLocaleString()} citations
              </span>
            )}
            {typeof p.influentialCitationCount === "number" && p.influentialCitationCount > 0 && (
              <span className="dot-sep" title="Influential citations">
                {p.influentialCitationCount.toLocaleString()} influential
              </span>
            )}
          </div>
        </div>

        <div className="row card-actions" style={{ flexWrap: "nowrap", gap: 6 }}>
          {!openAlex && (
            <a className="btn btn-sm btn-ghost" href={p.pdfUrl} target="_blank" rel="noreferrer">
              PDF
            </a>
          )}
          {canEdit &&
            (saved ? (
              <button type="button" className="btn btn-sm btn-saved" onClick={onUnsave} title="Remove from library">
                <StarIcon filled size={14} />
                Saved
              </button>
            ) : (
              <button type="button" className="btn btn-sm" onClick={onSave} title="Save to library">
                <StarIcon size={14} />
                Save
              </button>
            ))}
        </div>
      </div>

      {saved && labelNames.length > 0 && (
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          {labelNames.map((n) => (
            <LabelChip key={n} name={n} />
          ))}
        </div>
      )}

      {p.summary ? (
        <>
          <div className={`paper-abstract ${expanded ? "" : "clamp-3"}`}>{p.summary}</div>
          {long && (
            <button type="button" className="link-btn" style={{ marginTop: 4 }} onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      ) : (
        <div className="paper-abstract meta">No abstract available.</div>
      )}
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="card" aria-hidden="true">
      <div className="skeleton" style={{ height: 18, width: "70%" }} />
      <div className="skeleton" style={{ height: 13, width: "45%", marginTop: 10 }} />
      <div className="skeleton" style={{ height: 12, width: "100%", marginTop: 16 }} />
      <div className="skeleton" style={{ height: 12, width: "96%", marginTop: 7 }} />
      <div className="skeleton" style={{ height: 12, width: "60%", marginTop: 7 }} />
    </div>
  );
}

function HomeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const canEdit = useCanEdit();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Committed search state lives in the URL so it survives navigation / refresh and can be shared.
  const urlQ = (params.get("q") ?? "").trim();
  const field = pick<Field>(params.get("field"), FIELDS, "title");
  const sort = pick<Sort>(params.get("sort"), SORTS, "relevance");
  const order = pick<Order>(params.get("order"), ["descending", "ascending"], "descending");
  const page = Math.max(0, (parseInt(params.get("page") ?? "1", 10) || 1) - 1);

  const [draft, setDraft] = useState(urlQ);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [direct, setDirect] = useState<Paper | null>(null);

  const [saved, setSaved] = useState<Record<string, Paper>>({});
  const [labels, setLabels] = useState<Label[]>([]);
  const [pending, setPending] = useState<Paper | null>(null);
  const [pendingLabels, setPendingLabels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(urlQ), [urlQ]);

  // Latest committed state, updated synchronously so quick successive changes don't overwrite each other
  // before the router has applied the previous URL.
  const latest = useRef({ q: urlQ, field, sort, order });
  useEffect(() => {
    latest.current = { q: urlQ, field, sort, order };
  }, [urlQ, field, sort, order]);

  const setUrl = useCallback(
    (next: Partial<{ q: string; field: Field; sort: Sort; order: Order; page: number }>) => {
      const { page: pg = 0, ...rest } = next;
      const cur = { ...latest.current, ...rest };
      latest.current = cur;

      // Options are written to the URL even before a query exists, otherwise the dropdowns would snap back.
      const sp = new URLSearchParams();
      if (cur.q) sp.set("q", cur.q);
      if (cur.field !== "title") sp.set("field", cur.field);
      if (cur.sort !== "relevance") sp.set("sort", cur.sort);
      if (cur.order !== "descending") sp.set("order", cur.order);
      if (pg > 0) sp.set("page", String(pg + 1));
      const qs = sp.toString();
      router.push(qs ? `/?${qs}` : "/", { scroll: false });
    },
    [router]
  );

  const loadSaved = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        fetchJson<{ items: Paper[] }>("/api/saved"),
        fetchJson<{ labels: Label[] }>("/api/saved?type=labels"),
      ]);
      const map: Record<string, Paper> = {};
      for (const it of s.items ?? []) map[it.arxivId] = it;
      setSaved(map);
      setLabels(l.labels ?? []);
    } catch (e) {
      console.error("Failed to load library", e);
    }
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  // A pasted arXiv id/link or DOI also resolves to that exact paper, shown above the results.
  useEffect(() => {
    setDirect(null);
    if (!urlQ || !looksResolvable(urlQ)) return;
    let cancelled = false;
    resolveInput(urlQ)
      .then((p) => !cancelled && setDirect({ ...p, source: p.source }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [urlQ]);

  // Run the search whenever the committed (URL) state changes.
  useEffect(() => {
    if (!urlQ) {
      setPapers([]);
      setSearched(false);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const url =
      `/api/arxiv?q=${encodeURIComponent(urlQ)}&max=${PAGE_SIZE}&start=${page * PAGE_SIZE}` +
      `&field=${field}&sort=${sort}&order=${order}`;
    fetchJson<{ papers: Paper[] }>(url)
      .then((j) => {
        if (cancelled) return;
        setPapers(j.papers ?? []);
        setSearched(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setPapers([]);
        setSearched(true);
        setError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [urlQ, field, sort, order, page]);

  // "/" focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit(q = draft) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setUrl({ q: trimmed, page: 0 });
  }

  function openSave(p: Paper) {
    setPending(p);
    setPendingLabels([]);
  }

  async function confirmSave() {
    if (!pending) return;
    const p = pending;
    setSaving(true);
    try {
      const res = await sendJson<{ shouldSummarize?: boolean }>("/api/saved", "POST", { ...p, labelNames: pendingLabels });
      setPending(null);
      await loadSaved();
      toast("Saved to your library", {
        action: { label: "Open", run: () => router.push(`/saved?paper=${encodeURIComponent(p.arxivId)}`) },
      });

      if (res?.shouldSummarize) {
        // Fire-and-forget; the summary is cached in the DB.
        void fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ arxivId: p.arxivId }),
        }).catch((e) => console.error("Auto summarize failed", e));
      }
    } catch (e: any) {
      toast(`Save failed: ${e?.message ?? e}`, { kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function unsave(p: Paper) {
    const prev = saved[p.arxivId];
    try {
      const highlights = prev?.annotationCount ? await snapshotAnnotations(p.arxivId) : [];
      await fetchJson(`/api/saved/${encodeURIComponent(p.arxivId)}`, { method: "DELETE" });
      await loadSaved();
      toast("Removed from your library", {
        action: prev
          ? {
              label: "Undo",
              run: async () => {
                await sendJson("/api/saved", "POST", { ...prev, labelNames: prev.labelNames ?? [] });
                await restoreAnnotations(prev.arxivId, highlights);
                await loadSaved();
              },
            }
          : undefined,
      });
    } catch (e: any) {
      toast(`Remove failed: ${e?.message ?? e}`, { kind: "error" });
    }
  }

  const savedList = useMemo(() => Object.values(saved), [saved]);
  const savedCount = savedList.length;
  const labelNames = useMemo(() => labels.map((l) => l.name), [labels]);
  const hasNext = papers.length >= PAGE_SIZE;

  return (
    <main className="container page">
      <div className="row" style={{ alignItems: "baseline" }}>
        <h1 className="page-title">Find papers</h1>
        <span className="meta">
          arXiv + OpenAlex
          {savedCount > 0 && (
            <>
              {" · "}
              <Link href="/saved" style={{ textDecoration: "underline" }}>
                {savedCount} saved
              </Link>
            </>
          )}
        </span>
      </div>

      <form
        className="row"
        style={{ marginTop: 16, gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="searchbox">
          <span className="searchbox-icon">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search by title, author, or topic…"
            aria-label="Search query"
            autoFocus
          />
          {!draft && <span className="kbd hide-sm">/</span>}
        </div>
        <button type="submit" className="btn btn-primary" style={{ height: 44, padding: "0 18px" }} disabled={!draft.trim() || loading}>
          {loading ? <Spinner /> : "Search"}
        </button>
      </form>

      <div className="row" style={{ marginTop: 12, gap: 14 }}>
        <label className="field-label">
          Search in
          <select className="select" value={field} onChange={(e) => setUrl({ field: e.target.value as Field })}>
            <option value="title">Title</option>
            <option value="smart">Title + abstract</option>
            <option value="author">Author</option>
            <option value="abstract">Abstract</option>
            <option value="all">All fields</option>
          </select>
        </label>
        <label className="field-label">
          Sort by
          <select className="select" value={sort} onChange={(e) => setUrl({ sort: e.target.value as Sort })}>
            <option value="relevance">Relevance</option>
            <option value="citations">Citations</option>
            <option value="submittedDate">Submitted date</option>
            <option value="lastUpdatedDate">Updated date</option>
          </select>
        </label>
        {sort !== "relevance" && (
          <label className="field-label">
            Order
            <select className="select" value={order} onChange={(e) => setUrl({ order: e.target.value as Order })}>
              <option value="descending">{sort === "citations" ? "Most cited first" : "Newest first"}</option>
              <option value="ascending">{sort === "citations" ? "Least cited first" : "Oldest first"}</option>
            </select>
          </label>
        )}
      </div>

      <ReadOnlyNotice what="save papers and add labels" />

      <section style={{ marginTop: 26 }}>
        {!urlQ ? (
          <>
          <div className="empty reveal">
            <div className="empty-title">Start with a topic</div>
            <div>Try one of these, or press <span className="kbd">/</span> to type your own.</div>
            <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  className="chip chip-plain reveal"
                  style={{ animationDelay: `${150 + i * 50}ms` }}
                  onClick={() => submit(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <HomeExtras papers={savedList} labels={labels} />
          </>
        ) : (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <h2 className="section-title" style={{ margin: 0 }}>
                Results{page > 0 ? ` · page ${page + 1}` : ""}
              </h2>
              <span className="spacer" />
              {!loading && papers.length > 0 && (
                <span className="meta">
                  {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + papers.length}
                </span>
              )}
              {!looksResolvable(urlQ) && <FollowSearchButton query={urlQ} field={field} />}
            </div>

            {error && (
              <div className="notice" style={{ marginBottom: 12 }}>
                Search failed: {error}
              </div>
            )}

            {direct && (
              <div style={{ marginBottom: 18 }}>
                <div className="section-title">Exact match</div>
                <ResultCard
                  p={direct}
                  saved={!!saved[direct.arxivId]}
                  labelNames={saved[direct.arxivId]?.labelNames ?? []}
                  canEdit={canEdit}
                  onSave={() => openSave(direct)}
                  onUnsave={() => unsave(direct)}
                />
              </div>
            )}

            {loading ? (
              <div className="stack">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : papers.length === 0 ? (
              searched &&
              !error && (
                <div className="empty">
                  <div className="empty-title">No results</div>
                  <div>Try a different query, or search in “Title + abstract” or “All fields”.</div>
                </div>
              )
            ) : (
              <div className="stack">
                {papers.map((p, i) => (
                  <div key={p.arxivId} className="reveal" style={{ animationDelay: `${i * 40}ms` }}>
                  <ResultCard
                    key={p.arxivId}
                    p={p}
                    saved={!!saved[p.arxivId]}
                    labelNames={saved[p.arxivId]?.labelNames ?? []}
                    canEdit={canEdit}
                    onSave={() => openSave(p)}
                    onUnsave={() => unsave(p)}
                  />
                  </div>
                ))}
              </div>
            )}

            {!loading && (page > 0 || hasNext) && (
              <div className="row" style={{ justifyContent: "center", marginTop: 22, gap: 12 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={page === 0}
                  onClick={() => {
                    setUrl({ page: page - 1 });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  ← Previous
                </button>
                <span className="meta">Page {page + 1}</span>
                <button
                  type="button"
                  className="btn"
                  disabled={!hasNext}
                  onClick={() => {
                    setUrl({ page: page + 1 });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {pending && (
        <Modal
          title="Save to library"
          onClose={() => setPending(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmSave} disabled={saving}>
                {saving ? <Spinner /> : null}
                {pendingLabels.length ? `Save with ${pendingLabels.length} label${pendingLabels.length > 1 ? "s" : ""}` : "Save"}
              </button>
            </>
          }
        >
          <div style={{ fontWeight: 650, lineHeight: 1.35 }}>{pending.title}</div>
          <div className="meta" style={{ marginTop: 4 }}>
            {shortAuthors(pending.authors, 4)}
          </div>
          <div className="section-title" style={{ marginTop: 18 }}>
            Labels (optional)
          </div>
          <LabelPicker all={labelNames} selected={pendingLabels} onChange={setPendingLabels} />
        </Modal>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}
