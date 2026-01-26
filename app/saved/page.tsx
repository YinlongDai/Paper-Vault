"use client";

import { useEffect, useMemo, useState } from "react";

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

type Paper = {
  arxivId: string;
  title: string;
  authors: string;
  summary: string;
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
  const [items, setItems] = useState<Paper[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [activeLabel, setActiveLabel] = useState<string>("All");
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    loadLabels();
    loadItems();
  }, []);

  const filtered = useMemo(() => {
    if (activeLabel === "All") return items;
    return items.filter((p) => (p.labelNames ?? []).includes(activeLabel));
  }, [items, activeLabel]);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>⭐ Saved Papers</h1>
        <a href="/" style={{ fontSize: 14 }}>
          ← Back to Search
        </a>
      </div>

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

      <p style={{ opacity: 0.75, marginTop: 10 }}>
        {loading ? "Loading..." : `Showing ${filtered.length} / ${items.length}`}
      </p>

      {filtered.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No saved papers for this filter.</p>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {filtered.map((p) => (
            <div key={p.arxivId} style={{ border: "1px solid #eee", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{p.title}</div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>{p.authors}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Published: {p.published}</div>

                  {(p.labelNames ?? []).length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      {(p.labelNames ?? []).map((name) => (
                        <span
                          key={name}
                          style={{
                            fontSize: 12,
                            padding: "3px 8px",
                            borderRadius: 999,
                            border: `1px solid ${colorForLabel(name)}`,
                            color: colorForLabel(name),
                            background: `color-mix(in srgb, ${colorForLabel(name)} 12%, transparent)`,
                            opacity: 0.95,
                          }}
                        >
                          {name}
                        </span>
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

              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.35, opacity: 0.9 }}>
                {p.summary}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}