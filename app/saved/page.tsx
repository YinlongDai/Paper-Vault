"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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

function asEmbedPdfUrl(u: string) {
  const s = String(u || "").trim();
  if (!s) return "";

  // Prefer direct PDF links.
  if (/arxiv\.org\/abs\//i.test(s)) {
    return s.replace(/arxiv\.org\/abs\//i, "arxiv.org/pdf/") + ".pdf";
  }

  // If it already looks like a PDF, keep it.
  if (/\.pdf(\?.*)?$/i.test(s)) return s;

  // arXiv pdf links sometimes omit .pdf
  if (/arxiv\.org\/pdf\//i.test(s) && !/\.pdf(\?.*)?$/i.test(s)) {
    return s + ".pdf";
  }

  return s;
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdown(md: string) {
  let s = escapeHtml(md || "");

  // code blocks ```...```
  s = s.replace(/```([\s\S]*?)```/g, (_m, code) => {
    return `<pre style="white-space:pre-wrap;overflow:auto;padding:10px;border:1px solid #eee;border-radius:10px;background:color-mix(in srgb, CanvasText 4%, transparent);"><code>${code}</code></pre>`;
  });

  // inline code
  s = s.replace(/`([^`]+?)`/g, (_m, code) => {
    return `<code style="padding:1px 6px;border:1px solid #eee;border-radius:8px;background:color-mix(in srgb, CanvasText 4%, transparent);">${code}</code>`;
  });

  // headings
  s = s.replace(/^###\s+(.+)$/gm, "<h3 style='margin:10px 0 6px;font-size:14px;'>$1</h3>");
  s = s.replace(/^##\s+(.+)$/gm, "<h2 style='margin:12px 0 8px;font-size:16px;'>$1</h2>");
  s = s.replace(/^#\s+(.+)$/gm, "<h1 style='margin:14px 0 10px;font-size:18px;'>$1</h1>");

  // bold / italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // links [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "<a href='$2' target='_blank' rel='noreferrer'>$1</a>");

  // paragraphs / line breaks
  s = s.replace(/\n\n+/g, "</p><p style='margin:8px 0;'>");
  s = s.replace(/\n/g, "<br />");

  return `<p style='margin:8px 0;'>${s}</p>`;
}

type Paper = {
  arxivId: string;
  title: string;
  authors: string;
  summary: string;
  note?: string;
  aiSummary?: string;
  published: string;
  absUrl: string;
  pdfUrl: string;
  labelNames?: string[];
};

type Label = {
  id: number;
  name: string;
};

export default function SavedPage() {
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [items, setItems] = useState<Paper[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [activeLabel, setActiveLabel] = useState<string>("All");
  const [loading, setLoading] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [addLabelOpen, setAddLabelOpen] = useState(false);
  const [addLabelChoice, setAddLabelChoice] = useState<string>("");
  const [addLabelNewName, setAddLabelNewName] = useState("");
  const [labelPickerMode, setLabelPickerMode] = useState<"add" | "remove">("add");
  

  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = (searchParams.get("paper") ?? "").trim();

  async function loadItems() {
    setLoading(true);
    try {
      const r = await fetch("/api/saved");
      const j = await r.json();
      setItems(j.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function loadLabels() {
    const r = await fetch("/api/saved?type=labels");
    const j = await r.json();
    setLabels(j.labels ?? []);
  }

  async function addLabel() {
    const name = window.prompt("New label name:");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const r = await fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "label", name: trimmed }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("Create label failed:", r.status, t);
      alert("Failed to create label. Check console for details.");
      return;
    }

    await loadLabels();
  }

  async function addLabelToSelectedPaper() {
    if (!selectedPaper) return;

    const picked = (addLabelChoice || "").trim();
    const isNew = picked === "__new__";
    const name = (isNew ? addLabelNewName : picked).trim();
    if (!name) return;

    // 1) Ensure the label exists globally (idempotent)
    const r1 = await fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "label", name }),
    });

    if (!r1.ok) {
      const t = await r1.text();
      console.error("Create label failed:", r1.status, t);
      alert("Failed to create label. Check console for details.");
      return;
    }

    // 2) Attach label to this paper (idempotent)
    const current = Array.isArray(selectedPaper.labelNames) ? selectedPaper.labelNames : [];
    const next = Array.from(new Set([...current, name]));

    const r2 = await fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        arxivId: selectedPaper.arxivId,
        title: selectedPaper.title,
        authors: selectedPaper.authors,
        summary: selectedPaper.summary,
        pdfUrl: selectedPaper.pdfUrl,
        absUrl: selectedPaper.absUrl,
        published: selectedPaper.published,
        labelNames: next,
      }),
    });

    if (!r2.ok) {
      const t = await r2.text();
      console.error("Attach label failed:", r2.status, t);
      alert("Failed to attach label. Check console for details.");
      return;
    }

    await loadLabels();
    await loadItems();

    // close picker + reset
    setAddLabelOpen(false);
    setAddLabelChoice("");
    setAddLabelNewName("");
  }

  async function removeLabelFromSelectedPaper(labelName: string) {
    if (!selectedPaper) return;
    const name = String(labelName || "").trim();
    if (!name) return;

    const current = Array.isArray(selectedPaper.labelNames) ? selectedPaper.labelNames : [];
    const next = current.filter((n) => n !== name);

    const r = await fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        arxivId: selectedPaper.arxivId,
        title: selectedPaper.title,
        authors: selectedPaper.authors,
        summary: selectedPaper.summary,
        pdfUrl: selectedPaper.pdfUrl,
        absUrl: selectedPaper.absUrl,
        published: selectedPaper.published,
        labelNames: next,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("Detach label failed:", r.status, t);
      alert("Failed to remove label. Check console for details.");
      return;
    }

    await loadItems(); // refresh so chips update
  }

  async function removePaper(arxivId: string) {
    const r = await fetch(`/api/saved?arxivId=${encodeURIComponent(arxivId)}`, {
      method: "DELETE",
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("Remove failed:", r.status, t);
      alert("Remove failed. Check console for details.");
      return;
    }

    await loadItems();
  }

  async function saveNote() {
    if (!selectedPaper) return;
    setNoteSaving(true);
    try {
      const r = await fetch("/api/saved", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arxivId: selectedPaper.arxivId, note: noteDraft }),
      });

      if (!r.ok) {
        const t = await r.text();
        console.error("Save note failed:", r.status, t);
        alert("Failed to save note. Check console for details.");
        return;
      }

      await loadItems(); // refresh items so selectedPaper.note updates
      setNoteEditing(false);
    } finally {
      setNoteSaving(false);
    }
  }

  async function generateSummary() {
    if (!selectedPaper) return;
    setSummaryGenerating(true);
    try {
      const r = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arxivId: selectedPaper.arxivId }),
      });

      if (!r.ok) {
        const j = await r.json().catch(() => null);
        const msg = j?.detail || j?.error || (await r.text());
        console.error("Summarize failed:", r.status, msg);
        alert("Failed to generate summary. Check console for details.");
        return;
      }

      await loadItems(); // ✅ refresh so selectedPaper.aiSummary updates
    } finally {
      setSummaryGenerating(false);
    }
  }

  useEffect(() => {
    loadLabels();
    loadItems();
  }, []);

  const filtered = useMemo(() => {
    if (activeLabel === "All") return items;
    return items.filter((p) => (p.labelNames ?? []).includes(activeLabel));
  }, [items, activeLabel]);

  const selectedPaper = useMemo(() => {
    if (!selectedId) return null;
    return items.find((p) => p.arxivId === selectedId) ?? null;
  }, [items, selectedId]);

  useEffect(() => {
    if (selectedPaper) {
      setNoteEditing(false);
      setNoteDraft(String(selectedPaper.note ?? ""));
      setAddLabelOpen(false);
      setAddLabelChoice("");
      setAddLabelNewName("");
      setLabelPickerMode("add");
    }
  }, [selectedPaper]);

  function openPaper(p: Paper) {
    router.push(`/saved?paper=${encodeURIComponent(p.arxivId)}`);
  }

  function closePaper() {
    router.push(`/saved`);
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>⭐ Saved Papers</h1>
        <a href="/" style={{ fontSize: 14 }}>
          ← Back to Search
        </a>
      </div>

      {!selectedId && (
        <>
          {/* Labels bar */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
            <button
              onClick={() => setActiveLabel("All")}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #ddd",
                background: activeLabel === "All" ? "#f2f2f2" : "transparent",
                cursor: "pointer",
              }}
            >
              All
            </button>

            {labels.map((l) => (
              <button
                key={l.id}
                onClick={() => setActiveLabel(l.name)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: `1px solid ${colorForLabel(l.name)}`,
                  background:
                    activeLabel === l.name
                      ? `color-mix(in srgb, ${colorForLabel(l.name)} 18%, transparent)`
                      : "transparent",
                  color: colorForLabel(l.name),
                  cursor: "pointer",
                }}
              >
                {l.name}
              </button>
            ))}

            <button
              onClick={addLabel}
              title="Add label"
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #ddd",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              +
            </button>
          </div>
        </>
      )}

      <p style={{ opacity: 0.75, marginTop: 10 }}>
        {loading ? "Loading..." : `Showing ${filtered.length} / ${items.length}`}
      </p>

      {selectedId ? (
        selectedPaper ? (
          <div style={{ marginTop: 14 }}>
            <button
              onClick={closePaper}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "transparent",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              ← Back to Saved
            </button>

            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16, marginTop: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 20, lineHeight: 1.2 }}>{selectedPaper.title}</div>
              <div style={{ fontSize: 14, opacity: 0.85, marginTop: 6 }}>{selectedPaper.authors}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Published: {selectedPaper.published}</div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
                {(selectedPaper.labelNames ?? []).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setActiveLabel(name);
                      closePaper(); // pushes /saved
                    }}
                    style={{
                      fontSize: 12,
                      padding: "3px 8px",
                      borderRadius: 999,
                      border: `1px solid ${colorForLabel(name)}`,
                      color: colorForLabel(name),
                      background: `color-mix(in srgb, ${colorForLabel(name)} 12%, transparent)`,
                      opacity: 0.95,
                      cursor: "pointer",
                    }}
                    title={`Filter by ${name}`}
                  >
                    {name}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    setLabelPickerMode("add");
                    setAddLabelOpen((v) => !v);

                    const existing = new Set(selectedPaper.labelNames ?? []);
                    const first = labels.map((l) => l.name).find((n) => !existing.has(n)) || "__new__";
                    setAddLabelChoice(first);
                    setAddLabelNewName("");
                  }}
                  title="Add label"
                  style={{
                    fontSize: 13,
                    padding: "3px 10px",
                    borderRadius: 999,
                    border: "1px solid #ddd",
                    cursor: "pointer",
                    fontWeight: 800,
                    background: "transparent",
                  }}
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLabelPickerMode("remove");
                    setAddLabelOpen(true);

                    const current = selectedPaper.labelNames ?? [];
                    setAddLabelChoice(current[0] || "");
                    setAddLabelNewName("");
                  }}
                  title="Remove label"
                  style={{
                    fontSize: 13,
                    padding: "3px 10px",
                    borderRadius: 999,
                    border: "1px solid #ddd",
                    cursor: "pointer",
                    fontWeight: 800,
                    background: "transparent",
                  }}
                  disabled={(selectedPaper.labelNames ?? []).length === 0}
                >
                  −
                </button>

                {addLabelOpen && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid #eee",
                      background: "color-mix(in srgb, CanvasText 3%, transparent)",
                    }}
                  >
                    <select
                      value={addLabelChoice}
                      onChange={(e) => setAddLabelChoice(e.target.value)}
                      style={{
                        fontSize: 13,
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid #ddd",
                        background: "transparent",
                      }}
                      disabled={labelPickerMode === "remove" && (selectedPaper.labelNames ?? []).length === 0}
                    >
                      {labelPickerMode === "add" ? (
                        (() => {
                          const existing = new Set(selectedPaper.labelNames ?? []);
                          const options = labels.map((l) => l.name).filter((n) => !existing.has(n));
                          return options.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ));
                        })()
                      ) : (
                        (selectedPaper.labelNames ?? []).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))
                      )}

                      {labelPickerMode === "add" && <option value="__new__">+ New label…</option>}
                    </select>

                    {addLabelChoice === "__new__" && addLabelChoice === "__new__" && (
                      <input
                        value={addLabelNewName}
                        onChange={(e) => setAddLabelNewName(e.target.value)}
                        placeholder="Label name"
                        style={{
                          fontSize: 13,
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: "1px solid #ddd",
                          minWidth: 140,
                          background: "transparent",
                        }}
                      />
                    )}

                    {labelPickerMode === "add" && (
                      <button
                        type="button"
                        onClick={addLabelToSelectedPaper}
                        style={{
                          fontSize: 13,
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: "1px solid #ddd",
                          fontWeight: 800,
                          cursor: "pointer",
                          background: "transparent",
                        }}
                      >
                        Add
                      </button>
                    )}

                    {labelPickerMode === "remove" && (
                      <button
                        type="button"
                        onClick={() => {
                          const name = (addLabelChoice || "").trim();
                          if (!name) return;

                          removeLabelFromSelectedPaper(name);

                          setAddLabelOpen(false);
                          setAddLabelChoice("");
                          setAddLabelNewName("");
                        }}
                        style={{
                          fontSize: 13,
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: "1px solid #ddd",
                          fontWeight: 800,
                          cursor: "pointer",
                          background: "transparent",
                        }}
                        disabled={(selectedPaper.labelNames ?? []).length === 0}
                      >
                        Remove
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setAddLabelOpen(false);
                        setAddLabelChoice("");
                        setAddLabelNewName("");
                      }}
                      style={{
                        fontSize: 13,
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: "1px solid #ddd",
                        cursor: "pointer",
                        background: "transparent",
                        opacity: 0.85,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
                <a href={selectedPaper.absUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                  abs
                </a>
                <a href={selectedPaper.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                  pdf
                </a>
                <button
                  onClick={() => removePaper(selectedPaper.arxivId)}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd" }}
                >
                  Remove
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: 14,
                  marginTop: 16,
                  alignItems: "start",
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Abstract</h2>
                  <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, opacity: 0.92 }}>
                    {selectedPaper.summary}
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Notes</h2>

                    {!noteEditing ? (
                      <button
                        onClick={() => setNoteEditing(true)}
                        style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd" }}
                      >
                        Edit note
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => {
                            setNoteDraft(String(selectedPaper.note ?? ""));
                            setNoteEditing(false);
                          }}
                          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd" }}
                          disabled={noteSaving}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveNote}
                          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", fontWeight: 700 }}
                          disabled={noteSaving}
                        >
                          {noteSaving ? "Saving..." : "Save"}
                        </button>
                      </div>
                    )}
                  </div>

                  {!noteEditing ? (
                    <div
                      style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, opacity: 0.92 }}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(String(selectedPaper.note ?? "")) }}
                    />
                  ) : (
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Write notes in Markdown..."
                      style={{
                        marginTop: 8,
                        width: "100%",
                        minHeight: 220,
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid #ddd",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                        fontSize: 13,
                        lineHeight: 1.45,
                      }}
                    />
                  )}
                </div>


              </div>

              <h2 style={{ marginTop: 18, fontSize: 16, fontWeight: 800 }}>PDF</h2>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
                If the PDF does not load here, use the PDF link above (some hosts block embedding).
              </div>

              <div
                style={{
                  marginTop: 10,
                  border: "1px solid #eee",
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <iframe
                  title="Paper PDF"
                  src={asEmbedPdfUrl(selectedPaper.pdfUrl)}
                  style={{ width: "100%", height: "75vh", border: "none" }}
                />
              </div>
              <h2 style={{ marginTop: 18, fontSize: 16, fontWeight: 800 }}>AI Summary</h2>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 8,
                }}
              >
                <div style={{ fontSize: 13, opacity: 0.75 }}>Generated summary (Markdown).</div>

                <button
                  onClick={generateSummary}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", fontWeight: 700 }}
                  disabled={summaryGenerating}
                  title={
                    selectedPaper.aiSummary && String(selectedPaper.aiSummary).trim()
                      ? "Regenerate summary"
                      : "Generate summary"
                  }
                >
                  {summaryGenerating
                    ? "Generating..."
                    : selectedPaper.aiSummary && String(selectedPaper.aiSummary).trim()
                      ? "Regenerate"
                      : "Generate"}
                </button>
              </div>

              <div
                style={{
                  marginTop: 10,
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                {selectedPaper.aiSummary && String(selectedPaper.aiSummary).trim() ? (
                  <div
                    style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.92 }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(String(selectedPaper.aiSummary)) }}
                  />
                ) : (
                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    No AI summary yet. Click <b>Generate</b> to create one.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <button
              onClick={closePaper}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "transparent",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              ← Back to Saved
            </button>
            <p style={{ opacity: 0.75, marginTop: 12 }}>Paper not found in your saved list.</p>
          </div>
        )
      ) : filtered.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No saved papers for this filter.</p>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {filtered.map((p) => (
            <div key={p.arxivId} style={{ border: "1px solid #eee", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <button
                    type="button"
                    onClick={() => openPaper(p)}
                    style={{
                      fontWeight: 700,
                      fontSize: 16,
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                    title="Open paper"
                  >
                    {p.title}
                  </button>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>{p.authors}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Published: {p.published}</div>

                  {(p.labelNames ?? []).length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      {(p.labelNames ?? []).map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => {
                            setActiveLabel(name);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                          style={{
                            fontSize: 12,
                            padding: "3px 8px",
                            borderRadius: 999,
                            border: `1px solid ${colorForLabel(name)}`,
                            color: colorForLabel(name),
                            background:
                              activeLabel === name
                                ? `color-mix(in srgb, ${colorForLabel(name)} 18%, transparent)`
                                : `color-mix(in srgb, ${colorForLabel(name)} 12%, transparent)`,
                            opacity: 0.95,
                            cursor: "pointer",
                          }}
                          aria-pressed={activeLabel === name}
                          title={`Filter by ${name}`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "start" }}>
                  <a href={p.absUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                    abs
                  </a>
                  <a href={p.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                    pdf
                  </a>
                  <button
                    onClick={() => removePaper(p.arxivId)}
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd" }}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {/* Abstract hidden in list view by default */}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}