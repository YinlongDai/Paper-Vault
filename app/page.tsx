"use client";

import { useEffect, useState } from "react";

type Paper = {
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
};

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

function colorForLabel(name: string) {
  const idx = hashString(name.toLowerCase()) % LABEL_PALETTE.length;
  return LABEL_PALETTE[idx];
}


export default function Home() {
  const [q, setQ] = useState("");
  const [field, setField] = useState<"smart" | "title" | "author" | "abstract" | "all">("title");
  const [sort, setSort] = useState<"relevance" | "submittedDate" | "lastUpdatedDate" | "citations">("relevance");
  const [order, setOrder] = useState<"descending" | "ascending">("descending");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0); // 0-based
  const [savedMap, setSavedMap] = useState<Record<string, boolean>>({});
  const [savedList, setSavedList] = useState<Paper[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [showLabelPrompt, setShowLabelPrompt] = useState(false);
  const [pendingPaper, setPendingPaper] = useState<Paper | null>(null);
  const [pendingSelected, setPendingSelected] = useState<Record<string, boolean>>({});
  const pageSize = 10;

  async function loadLabels() {
    try {
      const r = await fetch("/api/saved?type=labels");

      if (!r.ok) {
        const t = await r.text();
        console.error("/api/saved?type=labels failed:", r.status, t);
        setLabels([]);
        return;
      }

      const text = await r.text();
      if (!text.trim()) {
        console.error("/api/saved?type=labels returned empty body");
        setLabels([]);
        return;
      }

      const j = JSON.parse(text);
      setLabels((j.labels ?? []).map((x: any) => x.name));
    } catch (e) {
      console.error("loadLabels error:", e);
      setLabels([]);
    }
  }

  function openSaveWithLabels(p: Paper) {
    setPendingPaper(p);
    const init: Record<string, boolean> = {};
    for (const name of labels) init[name] = false;
    setPendingSelected(init);
    setShowLabelPrompt(true);
  }

  async function confirmSaveWithLabels() {
    if (!pendingPaper) return;
    const chosen = Object.entries(pendingSelected)
      .filter(([, v]) => v)
      .map(([k]) => k);

    const saveRes = await fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pendingPaper, labelNames: chosen }),
    });

    const saveJson: any = await saveRes.json().catch(() => ({}));
    setShowLabelPrompt(false);
    setPendingPaper(null);
    setPendingSelected({});
    await loadSaved();

    if (saveJson?.shouldSummarize) {
      // Fire-and-forget; summary is cached in DB
      void fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arxivId: pendingPaper.arxivId }),
      }).catch((e) => {
        console.error("Auto summarize failed", e);
      });
    }
  }

  function cancelSaveWithLabels() {
    setShowLabelPrompt(false);
    setPendingPaper(null);
    setPendingSelected({});
  }

  async function loadSaved() {
    const r = await fetch("/api/saved");
    const j = await r.json();
    const items: Paper[] = j.items ?? [];
    setSavedList(items);

    const map: Record<string, boolean> = {};
    for (const it of items) map[it.arxivId] = true;
    setSavedMap(map);
  }

  async function removePaper(arxivId: string) {
    await fetch(`/api/saved/${encodeURIComponent(arxivId)}`, { method: "DELETE" });
    await loadSaved();
  }

  async function search(pageOverride?: number, qOverride?: string) {
    setLoading(true);
    try {
      const effectiveQ = (qOverride ?? q).trim();
      if (!effectiveQ) {
        setPapers([]);
        return;
      }
      const effectivePage = pageOverride ?? page;
      const r = await fetch(
        `/api/arxiv?q=${encodeURIComponent(effectiveQ)}&max=${pageSize}&start=${effectivePage * pageSize}` +
          `&field=${encodeURIComponent(field)}&sort=${encodeURIComponent(sort)}&order=${encodeURIComponent(order)}`
      );
      const j = await r.json();
      setPapers(j.papers ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSaved();
    loadLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui", position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>📚 My Paper Vault</h1>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <a href="/saved" style={{ fontSize: 14 }}>
            Saved{savedList.length ? ` (${savedList.length})` : ""}
          </a>
        </div>
      </div>

      <p style={{ opacity: 0.75, marginTop: 8 }}>Search arXiv and save papers later.</p>

      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder="Search on arXiv..."
          style={{ flex: 1, padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
        />
        <select
          value={field}
          onChange={(e) => {
            setField(e.target.value as any);
            setPage(0);
          }}
          style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
        >
          <option value="smart">Smart (Title + Abstract)</option>
          <option value="title">Title</option>
          <option value="author">Author</option>
          <option value="abstract">Abstract</option>
          <option value="all">All fields</option>
        </select>

        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as any);
            setPage(0);
          }}
          style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
        >
          <option value="relevance">Relevance</option>
          <option value="citations">Citations</option>
          <option value="submittedDate">Date (submitted)</option>
          <option value="lastUpdatedDate">Date (updated)</option>
        </select>

        <select
          value={order}
          onChange={(e) => {
            setOrder(e.target.value as any);
            setPage(0);
          }}
          style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
        >
          <option value="descending">↓ Desc</option>
          <option value="ascending">↑ Asc</option>
        </select>

        <button onClick={() => search()} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd" }}>
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Floating Prev/Next (only visible when clickable) */}
      {page > 0 && !loading && (
        <button
          onClick={() => {
            const newPage = Math.max(0, page - 1);
            setPage(newPage);
            search(newPage);
          }}
          aria-label="Previous page"
          title="Previous"
          style={{
            position: "fixed",
            left: "max(12px, calc(50% - 490px - 56px))",
            top: "50%",
            transform: "translateY(-50%)",
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "1px solid #ddd",
            background: "Canvas",
            color: "CanvasText",
            boxShadow: "0 6px 16px rgba(0,0,0,0.18)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            zIndex: 40,
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          ←
        </button>
      )}

      {!loading && papers.length >= pageSize && (
        <button
          onClick={() => {
            const newPage = page + 1;
            setPage(newPage);
            search(newPage);
          }}
          aria-label="Next page"
          title="Next"
          style={{
            position: "fixed",
            right: "max(12px, calc(50% - 490px - 56px))",
            top: "50%",
            transform: "translateY(-50%)",
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "1px solid #ddd",
            background: "Canvas",
            color: "CanvasText",
            boxShadow: "0 6px 16px rgba(0,0,0,0.18)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            zIndex: 40,
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          →
        </button>
      )}

      {/* Keep the page indicator where it is */}
      <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
        <div style={{ fontSize: 13, opacity: 0.75 }}>
          Page {page + 1} (showing {pageSize} results)
        </div>
      </div>

      <h2 style={{ marginTop: 24, fontSize: 20, fontWeight: 700 }}>Results</h2>

      {papers.length === 0 ? (
        !q.trim() ? (
          <div style={{ opacity: 0.9, border: "1px solid #eee", borderRadius: 10, padding: 14 }}>
            <div style={{ fontWeight: 700 }}>Try a search</div>
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>
              Pick one to get started:
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              {[
                "diffusion models",
                "graph neural networks",
                "retrieval augmented generation",
                "foundation models",
                "protein folding",
                "LLM agents",
              ].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setQ(s);
                    setPage(0);
                    search(0, s);
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid #ddd",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
              Tip: switch the dropdowns to search by Title/Author/Abstract and sort by Date.
            </div>
          </div>
        ) : (
          <p style={{ opacity: 0.7 }}>No results. Try a different query or field.</p>
        )
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {papers.map((p) => (
            <div key={p.arxivId} style={{ border: "1px solid #eee", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700 }}>{p.title}</div>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: "1px solid #ddd",
                      opacity: 0.85,
                    }}
                    title={p.source === "openalex" ? "OpenAlex" : "arXiv"}
                  >
                    {p.source === "openalex" ? "OpenAlex" : "arXiv"}
                  </span>
                </div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>{p.authors}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Published: {p.published}
                    {typeof p.citationCount === "number" ? ` · Citations: ${p.citationCount}` : ""}
                    {typeof p.influentialCitationCount === "number" ? ` · Influential: ${p.influentialCitationCount}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "start" }}>
                  <a href={p.absUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                    abs
                  </a>
                  <a href={p.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                    pdf
                  </a>

                  {!savedMap[p.arxivId] ? (
                    <button
                      onClick={() => openSaveWithLabels(p)}
                      aria-label="Save"
                      title="Save"
                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd" }}
                    >
                      ⭐
                    </button>
                  ) : (
                    <button
                      onClick={() => removePaper(p.arxivId)}
                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd" }}
                    >
                      Unsave
                    </button>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.35, opacity: 0.9 }}>{p.summary}</div>
            </div>
          ))}
        </div>
      )}

      {showLabelPrompt && pendingPaper && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 50,
          }}
          onClick={cancelSaveWithLabels}
        >
          <div
            style={{
              width: "min(720px, 100%)",
              background: "Canvas",
              color: "CanvasText",
              borderRadius: 12,
              border: "1px solid color-mix(in srgb, CanvasText 18%, transparent)",
              padding: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontWeight: 700 }}>Assign labels</div>
              <button
                onClick={cancelSaveWithLabels}
                style={{
                  background: "transparent",
                  color: "CanvasText",
                  border: "1px solid color-mix(in srgb, CanvasText 22%, transparent)",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>

            <div style={{ marginTop: 10, fontSize: 14, opacity: 0.9 }}>
              <div style={{ fontWeight: 700 }}>{pendingPaper.title}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{pendingPaper.authors}</div>
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}>
                Click to toggle labels:
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {labels.map((name) => {
                  const active = !!pendingSelected[name];
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() =>
                        setPendingSelected((prev) => ({
                          ...prev,
                          [name]: !prev[name],
                        }))
                      }
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: `1px solid ${colorForLabel(name)}`,
                        background: active
                          ? `color-mix(in srgb, ${colorForLabel(name)} 18%, transparent)`
                          : "transparent",
                        color: colorForLabel(name),
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                      aria-pressed={active}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button
                onClick={cancelSaveWithLabels}
                style={{
                  background: "transparent",
                  color: "CanvasText",
                  border: "1px solid color-mix(in srgb, CanvasText 22%, transparent)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmSaveWithLabels}
                style={{
                  background: "color-mix(in srgb, CanvasText 10%, transparent)",
                  color: "CanvasText",
                  border: "1px solid color-mix(in srgb, CanvasText 22%, transparent)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}