"use client";

// PDF reader built on pdf.js: renders pages lazily, keeps a selectable text layer, and lets the owner
// highlight passages and attach notes. Notes sit in a margin column aligned with their highlight, so they
// scroll together with the PDF.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchJson, renderMarkdown, sendJson } from "@/lib/papers";
import { useToast } from "./providers";
import { Spinner } from "./ui";

type Rect = [number, number, number, number]; // x, y, w, h as fractions of the page

export type Annotation = {
  id: number;
  version: string;
  page: number;
  rects: Rect[];
  quote: string;
  note: string;
  color: string;
  createdAt: string;
};

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
  purple: "#a78bfa",
};

type PageSize = { w: number; h: number };
type PendingSelection = { page: number; rects: Rect[]; quote: string; x: number; y: number };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
// Canvas size cap so deep zoom doesn't allocate huge bitmaps (pixels per page).
const MAX_CANVAS_PIXELS = 16_000_000;
const MARGIN_W = 280;

let pdfjsPromise: Promise<any> | null = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((mod: any) => {
      const pdfjs = mod?.default ?? mod;
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/** Merge per-span client rects into one rect per line so highlights look continuous. */
function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last) {
      const sameLine = Math.abs(last[1] - r[1]) < Math.min(last[3], r[3]) * 0.5;
      const close = r[0] <= last[0] + last[2] + 0.02;
      if (sameLine && close) {
        const x0 = Math.min(last[0], r[0]);
        const y0 = Math.min(last[1], r[1]);
        const x1 = Math.max(last[0] + last[2], r[0] + r[2]);
        const y1 = Math.max(last[1] + last[3], r[1] + r[3]);
        out[out.length - 1] = [x0, y0, x1 - x0, y1 - y0];
        continue;
      }
    }
    out.push(r);
  }
  return out;
}

function PdfPage({
  pdf,
  pageNumber,
  size,
  scale,
  annotations,
  activeId,
  onMarkerClick,
  registerRef,
}: {
  pdf: any;
  pageNumber: number;
  size: PageSize;
  scale: number;
  annotations: Annotation[];
  activeId: number | null;
  onMarkerClick: (id: number) => void;
  registerRef: (page: number, el: HTMLDivElement | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), {
      rootMargin: "800px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !pdf) return;
    let cancelled = false;
    let renderTask: any = null;
    let textLayer: any = null;

    (async () => {
      const pdfjs = await loadPdfjs();
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const textDiv = textRef.current;
      if (!canvas || !textDiv) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      renderTask = page.render({
        canvasContext: ctx,
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      await renderTask.promise;
      if (cancelled) return;

      textDiv.replaceChildren();
      textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      await textLayer.render();
      if (!cancelled) setRendered(true);
    })().catch((e) => {
      if (!cancelled && e?.name !== "RenderingCancelledException") console.error("Page render failed", e);
    });

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
        textLayer?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, [visible, pdf, pageNumber, scale]);

  const w = size.w * scale;
  const h = size.h * scale;

  return (
    <div
      ref={(el) => {
        wrapRef.current = el;
        registerRef(pageNumber, el);
      }}
      className="pdf-page"
      data-page={pageNumber}
      style={
        {
          width: w,
          height: h,
          "--total-scale-factor": scale,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as React.CSSProperties
      }
    >
      <canvas ref={canvasRef} />
      {!rendered && <div className="pdf-page-loading">Page {pageNumber}</div>}
      <div className="hl-layer" aria-hidden="true">
        {annotations.map((a) =>
          a.rects.map((r, i) => (
            <div
              key={`${a.id}-${i}`}
              className={`hl ${activeId === a.id ? "active" : ""}`}
              style={{
                left: `${r[0] * 100}%`,
                top: `${r[1] * 100}%`,
                width: `${r[2] * 100}%`,
                height: `${r[3] * 100}%`,
                background: HIGHLIGHT_COLORS[a.color] ?? HIGHLIGHT_COLORS.yellow,
              }}
            />
          ))
        )}
      </div>
      <div ref={textRef} className="textLayer" />
      {annotations.map((a) => (
        <button
          key={`m-${a.id}`}
          type="button"
          className="hl-marker"
          title={a.note ? "Show note" : "Highlight"}
          style={{ top: `${(a.rects[0]?.[1] ?? 0) * 100}%`, background: HIGHLIGHT_COLORS[a.color] ?? HIGHLIGHT_COLORS.yellow }}
          onClick={() => onMarkerClick(a.id)}
        />
      ))}
      <div className="pdf-page-num">{pageNumber}</div>
    </div>
  );
}

function NoteCard({
  a,
  canEdit,
  active,
  editing,
  style,
  cardRef,
  onActivate,
  onEdit,
  onSave,
  onDelete,
  onColor,
  onCancel,
}: {
  a: Annotation;
  canEdit: boolean;
  active: boolean;
  editing: boolean;
  style?: React.CSSProperties;
  cardRef?: (el: HTMLDivElement | null) => void;
  onActivate: () => void;
  onEdit: () => void;
  onSave: (note: string) => Promise<void>;
  onDelete: () => void;
  onColor: (c: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(a.note);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(a.note), [a.note, editing]);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={cardRef}
      className={`note-card ${active ? "active" : ""}`}
      style={{ ...style, borderLeftColor: HIGHLIGHT_COLORS[a.color] ?? HIGHLIGHT_COLORS.yellow }}
      onMouseEnter={onActivate}
      onClick={onActivate}
    >
      <div className="note-quote" title={a.quote}>
        “{a.quote}”
      </div>
      {editing ? (
        <>
          <textarea
            className="textarea"
            style={{ marginTop: 8, minHeight: 90, fontSize: 12.5 }}
            value={draft}
            autoFocus
            placeholder="Write a note… (Markdown)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") onCancel();
            }}
          />
          <div className="row" style={{ marginTop: 6, gap: 6 }}>
            {Object.keys(HIGHLIGHT_COLORS).map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch-btn ${a.color === c ? "on" : ""}`}
                style={{ background: HIGHLIGHT_COLORS[c] }}
                aria-label={`Colour ${c}`}
                onClick={() => onColor(c)}
              />
            ))}
            <span className="spacer" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
              {saving ? <Spinner /> : "Save"}
            </button>
          </div>
        </>
      ) : (
        <>
          {a.note.trim() ? (
            <div className="prose note-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.note) }} />
          ) : (
            canEdit && <div className="meta" style={{ fontSize: 12, marginTop: 6 }}>No note yet.</div>
          )}
          {canEdit && (
            <div className="note-actions">
              <button type="button" className="mini-btn" onClick={onEdit}>
                {a.note.trim() ? "Edit" : "Add note"}
              </button>
              <button type="button" className="mini-btn" onClick={onDelete}>
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function PdfReader({
  arxivId,
  version,
  pdfUrl,
  canEdit,
  onCountsChange,
}: {
  arxivId: string;
  version: string;
  pdfUrl: string;
  canEdit: boolean;
  onCountsChange?: (byVersion: Record<string, number>) => void;
}) {
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pagesColRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const cardEls = useRef(new Map<number, HTMLDivElement>());

  const [pdf, setPdf] = useState<any>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const hoverRef = useRef(false);
  // In-progress gesture: previewed with a CSS transform, committed (re-rendered) when the gesture pauses.
  const gestureRef = useRef<{ start: number; zoom: number; cx: number; cy: number; vx: number; vy: number } | null>(null);
  const restoreRef = useRef<{ ratio: number; cx: number; cy: number; vx: number; vy: number } | null>(null);
  const commitTimer = useRef<number | undefined>(undefined);
  const [colWidth, setColWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  const [all, setAll] = useState<Annotation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [newColor, setNewColor] = useState("yellow");
  const [tops, setTops] = useState<Record<number, number>>({});
  const [wide, setWide] = useState(true);

  const proxied = `/api/pdf?url=${encodeURIComponent(pdfUrl)}`;
  const annotations = useMemo(() => all.filter((a) => (a.version || "") === version), [all, version]);

  // Load annotations for this paper (all versions; filtered above).
  const loadAnnotations = useCallback(async () => {
    try {
      const j = await fetchJson<{ annotations: Annotation[] }>(`/api/annotations?arxivId=${encodeURIComponent(arxivId)}`);
      setAll(j.annotations ?? []);
    } catch (e) {
      console.error("Failed to load annotations", e);
    }
  }, [arxivId]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  useEffect(() => {
    if (!onCountsChange) return;
    const counts: Record<string, number> = {};
    for (const a of all) counts[a.version || ""] = (counts[a.version || ""] ?? 0) + 1;
    onCountsChange(counts);
  }, [all, onCountsChange]);

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    let task: any = null;
    setStatus("loading");
    setPdf(null);
    setSizes([]);
    (async () => {
      const pdfjs = await loadPdfjs();
      task = pdfjs.getDocument({ url: proxied, withCredentials: false });
      const doc = await task.promise;
      if (cancelled) return;
      const s: PageSize[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const v = p.getViewport({ scale: 1 });
        s.push({ w: v.width, h: v.height });
      }
      if (cancelled) return;
      setSizes(s);
      setPdf(doc);
      setStatus("ready");
    })().catch((e) => {
      if (cancelled) return;
      setStatus("error");
      setError(String(e?.message ?? e));
    });
    return () => {
      cancelled = true;
      try {
        task?.destroy();
      } catch {
        /* ignore */
      }
    };
  }, [proxied]);

  // Track available width for fit-to-width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const total = el.clientWidth;
      const isWide = total >= 900;
      setWide(isWide);
      setColWidth(Math.max(280, total - (isWide ? MARGIN_W + 40 : 24)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseW = sizes[0]?.w ?? 612;
  const scale = colWidth ? Math.min(5, (colWidth / baseW) * zoom) : 1;

  /** Zoom by `factor` around a point given in client coordinates, keeping that point under the cursor/fingers. */
  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const root = scrollRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return;
    const box = root.getBoundingClientRect();
    const vx = (clientX ?? box.left + box.width / 2) - box.left;
    const vy = (clientY ?? box.top + box.height / 2) - box.top;

    let g = gestureRef.current;
    if (!g) {
      g = {
        start: zoomRef.current,
        zoom: zoomRef.current,
        cx: root.scrollLeft + vx - inner.offsetLeft,
        cy: root.scrollTop + vy - inner.offsetTop,
        vx,
        vy,
      };
      gestureRef.current = g;
    }
    g.zoom = clampZoom(g.zoom * factor);
    const ratio = g.zoom / g.start;
    inner.style.transformOrigin = `${g.cx}px ${g.cy}px`;
    inner.style.transform = ratio === 1 ? "" : `scale(${ratio})`;

    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      const done = gestureRef.current;
      gestureRef.current = null;
      if (!done) return;
      if (done.zoom === done.start) {
        inner.style.transform = "";
        return;
      }
      restoreRef.current = { ratio: done.zoom / done.start, cx: done.cx, cy: done.cy, vx: done.vx, vy: done.vy };
      zoomRef.current = done.zoom;
      setZoom(done.zoom);
    }, 160);
  }, []);

  // After a committed zoom re-lays out the pages, drop the preview transform and restore the anchor point.
  useLayoutEffect(() => {
    const r = restoreRef.current;
    const root = scrollRef.current;
    const inner = innerRef.current;
    if (!r || !root || !inner) return;
    restoreRef.current = null;
    inner.style.transform = "";
    root.scrollLeft = r.cx * r.ratio + inner.offsetLeft - r.vx;
    root.scrollTop = r.cy * r.ratio + inner.offsetTop - r.vy;
  }, [zoom]);

  // Pinch (trackpad / touch / Safari gestures), Ctrl/⌘ + scroll, and Ctrl/⌘ + = − 0.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // trackpad pinch arrives as ctrl+wheel in Chrome/Firefox
      e.preventDefault();
      const dy = Math.max(-50, Math.min(50, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
      zoomAt(Math.exp(-dy * 0.008), e.clientX, e.clientY);
    };

    let lastGestureScale = 1;
    const onGestureStart = (e: any) => {
      e.preventDefault();
      lastGestureScale = 1;
    };
    const onGestureChange = (e: any) => {
      e.preventDefault();
      zoomAt(e.scale / lastGestureScale, e.clientX, e.clientY);
      lastGestureScale = e.scale;
    };

    let lastDist = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) lastDist = dist(e.touches);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !lastDist) return;
      e.preventDefault();
      const d = dist(e.touches);
      zoomAt(d / lastDist, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
      lastDist = d;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) lastDist = 0;
    };

    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !hoverRef.current) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomAt(1.2);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomAt(1 / 1.2);
      } else if (e.key === "0") {
        e.preventDefault();
        zoomAt(1 / (gestureRef.current?.zoom ?? zoomRef.current));
      }
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false } as AddEventListenerOptions);
    root.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false } as AddEventListenerOptions);
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    window.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("gesturestart", onGestureStart as EventListener);
      root.removeEventListener("gesturechange", onGestureChange as EventListener);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(commitTimer.current);
    };
  }, [zoomAt]);

  // Current page indicator.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !sizes.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const best = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (best) setCurrentPage(Number((best.target as HTMLElement).dataset.page) || 1);
      },
      { root, threshold: [0.25, 0.5, 0.75] }
    );
    pageEls.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sizes.length, scale]);

  const registerRef = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(page, el);
    else pageEls.current.delete(page);
  }, []);

  // Position margin cards next to their highlight, pushing overlapping cards down.
  const sortedAnns = useMemo(
    () => [...annotations].sort((a, b) => a.page - b.page || (a.rects[0]?.[1] ?? 0) - (b.rects[0]?.[1] ?? 0)),
    [annotations]
  );

  useLayoutEffect(() => {
    if (!wide) return;
    const inner = innerRef.current;
    if (!inner) return;
    const next: Record<number, number> = {};
    let floor = 0;
    for (const a of sortedAnns) {
      const pageEl = pageEls.current.get(a.page);
      if (!pageEl) continue;
      const want = pageEl.offsetTop + (a.rects[0]?.[1] ?? 0) * pageEl.offsetHeight - 6;
      const top = Math.max(want, floor);
      next[a.id] = top;
      const hgt = cardEls.current.get(a.id)?.offsetHeight ?? 70;
      floor = top + hgt + 8;
    }
    const same = Object.keys(next).length === Object.keys(tops).length && Object.entries(next).every(([k, v]) => Math.abs((tops[Number(k)] ?? -1) - v) < 1);
    if (!same) setTops(next);
  });

  // Turn a text selection inside a page into a pending highlight.
  function onMouseUp() {
    if (!canEdit) return;
    window.setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const startEl = (range.startContainer as HTMLElement).parentElement?.closest?.(".pdf-page") as HTMLElement | null;
      if (!startEl || !innerRef.current?.contains(startEl)) return;
      const page = Number(startEl.dataset.page);
      const pr = startEl.getBoundingClientRect();
      const rects: Rect[] = [];
      for (const r of Array.from(range.getClientRects())) {
        if (r.width < 1 || r.height < 1) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) continue; // keep the start page only
        rects.push([(r.left - pr.left) / pr.width, (r.top - pr.top) / pr.height, r.width / pr.width, r.height / pr.height]);
      }
      const quote = sel.toString().replace(/\s+/g, " ").trim();
      if (!rects.length || !quote) return;
      const last = range.getBoundingClientRect();
      const host = scrollRef.current!.getBoundingClientRect();
      setPending({
        page,
        rects: mergeLineRects(rects),
        quote,
        x: Math.min(Math.max(last.left + last.width / 2 - host.left, 90), host.width - 90),
        y: last.bottom - host.top + scrollRef.current!.scrollTop + 8,
      });
    }, 0);
  }

  async function createHighlight(withNote: boolean) {
    if (!pending) return;
    const p = pending;
    setPending(null);
    window.getSelection()?.removeAllRanges();
    try {
      const j = await sendJson<{ annotation: Annotation }>("/api/annotations", "POST", {
        arxivId,
        version,
        page: p.page,
        rects: p.rects,
        quote: p.quote,
        color: newColor,
      });
      setAll((cur) => [...cur, j.annotation]);
      setActiveId(j.annotation.id);
      if (withNote) setEditingId(j.annotation.id);
    } catch (e: any) {
      toast(`Couldn't save highlight: ${e?.message ?? e}`, { kind: "error" });
    }
  }

  async function updateAnnotation(id: number, patch: { note?: string; color?: string }) {
    try {
      const j = await sendJson<{ annotation: Annotation }>("/api/annotations", "PATCH", { id, ...patch });
      setAll((cur) => cur.map((a) => (a.id === id ? j.annotation : a)));
    } catch (e: any) {
      toast(`Couldn't update: ${e?.message ?? e}`, { kind: "error" });
    }
  }

  async function deleteAnnotation(a: Annotation) {
    setAll((cur) => cur.filter((x) => x.id !== a.id));
    try {
      await fetchJson(`/api/annotations?id=${a.id}`, { method: "DELETE" });
      toast("Highlight deleted", {
        action: {
          label: "Undo",
          run: async () => {
            const j = await sendJson<{ annotation: Annotation }>("/api/annotations", "POST", { arxivId, ...a });
            setAll((cur) => [...cur, j.annotation]);
          },
        },
      });
    } catch (e: any) {
      setAll((cur) => [...cur, a]);
      toast(`Couldn't delete: ${e?.message ?? e}`, { kind: "error" });
    }
  }

  function scrollToAnnotation(id: number) {
    const a = annotations.find((x) => x.id === id);
    const pageEl = a && pageEls.current.get(a.page);
    const root = scrollRef.current;
    if (!a || !pageEl || !root) return;
    setActiveId(id);
    root.scrollTo({ top: pageEl.offsetTop + (a.rects[0]?.[1] ?? 0) * pageEl.offsetHeight - 120, behavior: "smooth" });
  }

  function jumpHighlight(dir: 1 | -1) {
    if (!sortedAnns.length) return;
    const i = sortedAnns.findIndex((a) => a.id === activeId);
    const next = sortedAnns[(i + dir + sortedAnns.length) % sortedAnns.length] ?? sortedAnns[0];
    scrollToAnnotation(next.id);
  }

  function goToPage(n: number) {
    const el = pageEls.current.get(n);
    if (el && scrollRef.current) scrollRef.current.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
  }


  return (
    <div className="reader" onMouseEnter={() => (hoverRef.current = true)} onMouseLeave={() => (hoverRef.current = false)}>
      <div className="reader-toolbar">
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-sm btn-ghost btn-icon" disabled={zoom <= MIN_ZOOM} onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out" title="Zoom out (⌘/Ctrl −)">
            −
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => zoomAt(1 / zoom)} title="Fit width (⌘/Ctrl 0) · pinch or ⌘/Ctrl + scroll to zoom">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="btn btn-sm btn-ghost btn-icon" disabled={zoom >= MAX_ZOOM} onClick={() => zoomAt(1.2)} aria-label="Zoom in" title="Zoom in (⌘/Ctrl +)">
            +
          </button>
        </div>
        {sizes.length > 0 && (
          <label className="field-label">
            Page
            <select className="select" style={{ height: 28 }} value={currentPage} onChange={(e) => goToPage(Number(e.target.value))}>
              {sizes.map((_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
            <span className="hide-sm">of {sizes.length}</span>
          </label>
        )}
        <span className="spacer" />
        {annotations.length > 0 && (
          <div className="row" style={{ gap: 2 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => jumpHighlight(-1)} title="Previous highlight">
              ‹
            </button>
            <span className="meta">
              {annotations.length} highlight{annotations.length === 1 ? "" : "s"}
            </span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => jumpHighlight(1)} title="Next highlight">
              ›
            </button>
          </div>
        )}
        {canEdit && (
          <div className="row hide-sm" style={{ gap: 4 }} title="Colour for new highlights">
            {Object.keys(HIGHLIGHT_COLORS).map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch-btn ${newColor === c ? "on" : ""}`}
                style={{ background: HIGHLIGHT_COLORS[c] }}
                aria-label={`Highlight colour ${c}`}
                onClick={() => setNewColor(c)}
              />
            ))}
          </div>
        )}
        <a className="btn btn-sm" href={proxied} target="_blank" rel="noreferrer">
          Open ↗
        </a>
      </div>

      {canEdit && annotations.length === 0 && status === "ready" && (
        <div className="reader-hint">Tip: select any text in the PDF to highlight it and attach a note.</div>
      )}

      <div className="reader-scroll" ref={scrollRef} onMouseUp={onMouseUp} onMouseDown={(e) => !(e.target as HTMLElement).closest(".sel-pop") && setPending(null)}>
        {status === "loading" && (
          <div className="reader-status">
            <Spinner /> Loading PDF…
          </div>
        )}
        {status === "error" && (
          <div className="reader-status">
            <div className="notice" style={{ maxWidth: 520 }}>
              Couldn&apos;t load this PDF here: {error}.{" "}
              <a href={proxied} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                Open it in a new tab
              </a>
              .
            </div>
          </div>
        )}

        {status === "ready" && (
          <div ref={innerRef} className={`reader-inner ${wide ? "wide" : ""}`}>
            <div className="reader-pages" ref={pagesColRef}>
              {sizes.map((s, i) => (
                <PdfPage
                  key={i}
                  pdf={pdf}
                  pageNumber={i + 1}
                  size={s}
                  scale={scale}
                  annotations={annotations.filter((a) => a.page === i + 1)}
                  activeId={activeId}
                  onMarkerClick={(id) => {
                    setActiveId(id);
                    if (!wide) document.getElementById(`note-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  registerRef={registerRef}
                />
              ))}
            </div>

            {wide ? (
              <div className="reader-margin" style={{ width: MARGIN_W }}>
                {sortedAnns.map((a) => (
                  <NoteCard
                    key={a.id}
                    a={a}
                    canEdit={canEdit}
                    active={activeId === a.id}
                    editing={editingId === a.id}
                    style={{ position: "absolute", top: tops[a.id] ?? 0, left: 0, right: 0, opacity: tops[a.id] === undefined ? 0 : 1 }}
                    cardRef={(el) => {
                      if (el) cardEls.current.set(a.id, el);
                      else cardEls.current.delete(a.id);
                    }}
                    onActivate={() => setActiveId(a.id)}
                    onEdit={() => setEditingId(a.id)}
                    onCancel={() => setEditingId(null)}
                    onSave={async (note) => {
                      await updateAnnotation(a.id, { note });
                      setEditingId(null);
                    }}
                    onColor={(color) => updateAnnotation(a.id, { color })}
                    onDelete={() => deleteAnnotation(a)}
                  />
                ))}
              </div>
            ) : (
              sortedAnns.length > 0 && (
                <div className="stack" style={{ padding: "16px 4px 4px", width: "100%" }}>
                  <div className="section-title">Highlights &amp; notes</div>
                  {sortedAnns.map((a) => (
                    <div id={`note-${a.id}`} key={a.id}>
                      <div className="meta" style={{ fontSize: 11.5, marginBottom: 4 }}>
                        Page {a.page} ·{" "}
                        <button type="button" className="link-btn" style={{ fontSize: 11.5 }} onClick={() => scrollToAnnotation(a.id)}>
                          show in PDF
                        </button>
                      </div>
                      <NoteCard
                        a={a}
                        canEdit={canEdit}
                        active={activeId === a.id}
                        editing={editingId === a.id}
                        onActivate={() => setActiveId(a.id)}
                        onEdit={() => setEditingId(a.id)}
                        onCancel={() => setEditingId(null)}
                        onSave={async (note) => {
                          await updateAnnotation(a.id, { note });
                          setEditingId(null);
                        }}
                        onColor={(color) => updateAnnotation(a.id, { color })}
                        onDelete={() => deleteAnnotation(a)}
                      />
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {pending && (
          <div className="sel-pop" style={{ left: pending.x, top: pending.y }}>
            <button type="button" className="btn btn-sm" onClick={() => createHighlight(false)}>
              <span className="swatch" style={{ background: HIGHLIGHT_COLORS[newColor] }} /> Highlight
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => createHighlight(true)}>
              Highlight + note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
