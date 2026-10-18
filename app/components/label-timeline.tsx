"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Paper, colorForLabel, formatDate } from "@/lib/papers";

const LABEL_W = 156; // width of a title tag on the timeline
const LANE_H = 46;
const LANES = 2; // per side (above / below the axis)
const MIN_GAP = 8;

type Placed = { p: Paper; t: number; x: number; lane: number; side: -1 | 1; left: number };

/**
 * Horizontal publication timeline for the papers under a label. Hovering a paper reports it through
 * `onHover` (null when the pointer leaves); clicking opens it.
 */
export function HorizontalTimeline({
  papers,
  label,
  activeId,
  onHover,
  onOpen,
}: {
  papers: Paper[];
  label: string;
  activeId: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [viewW, setViewW] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dated = useMemo(
    () =>
      papers
        .map((p) => ({ p, t: Date.parse(p.published) }))
        .filter((x) => Number.isFinite(x.t))
        .sort((a, b) => a.t - b.t),
    [papers]
  );

  const layout = useMemo(() => {
    if (!dated.length || !viewW) return null;
    const pad = LABEL_W / 2 + 12;
    // Widen (and scroll) when there are too many papers to fit in the lanes.
    const width = Math.max(viewW, dated.length * ((LABEL_W + MIN_GAP) / (LANES * 2)) + pad * 2);
    const t0 = dated[0].t;
    const t1 = dated[dated.length - 1].t;
    const span = Math.max(t1 - t0, 1);
    const xOf = (t: number) => (t1 === t0 ? width / 2 : pad + ((t - t0) / span) * (width - pad * 2));

    // Greedy lane assignment, alternating above / below the axis: up0, down0, up1, down1.
    const order: [number, -1 | 1][] = [];
    for (let l = 0; l < LANES; l++) order.push([l, -1], [l, 1]);
    const laneEnd = new Map<string, number>();
    const placed: Placed[] = dated.map(({ p, t }) => {
      const x = xOf(t);
      const left = Math.min(Math.max(x - LABEL_W / 2, 0), width - LABEL_W);
      let choice = order.find(([l, s]) => (laneEnd.get(`${l}${s}`) ?? -Infinity) + MIN_GAP <= left);
      if (!choice) {
        // Everything is busy: use the lane that frees up first.
        choice = [...order].sort((a, b) => (laneEnd.get(`${a[0]}${a[1]}`) ?? 0) - (laneEnd.get(`${b[0]}${b[1]}`) ?? 0))[0];
      }
      laneEnd.set(`${choice[0]}${choice[1]}`, left + LABEL_W);
      return { p, t, x, lane: choice[0], side: choice[1], left };
    });

    const ticks: { x: number; label: string }[] = [];
    const y0 = new Date(t0).getUTCFullYear();
    const y1 = new Date(t1).getUTCFullYear();
    const step = Math.max(1, Math.ceil((y1 - y0 + 1) / 12));
    for (let y = y0; y <= y1 + 1; y += step) {
      const t = Date.UTC(y, 0, 1);
      if (t >= t0 - span * 0.02 && t <= t1 + span * 0.02) ticks.push({ x: xOf(t), label: String(y) });
    }
    return { width, placed, ticks };
  }, [dated, viewW]);

  const color = colorForLabel(label);
  const height = LANES * 2 * LANE_H + 52; // room for the year labels along the bottom
  const axisY = LANES * LANE_H + 17;

  return (
    <section className="card htl-card" style={{ "--tl-color": color } as React.CSSProperties}>
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Timeline
        </h2>
        <span className="meta" style={{ fontSize: 12.5 }}>
          {dated.length} paper{dated.length === 1 ? "" : "s"} by publication date · hover to focus, click to open
        </span>
      </div>
      <div ref={wrapRef} className="htl-scroll" onMouseLeave={() => onHover(null)}>
        {layout && (
          <div className="htl" style={{ width: layout.width, height }}>
            <div className="htl-axis" style={{ top: axisY }} />
            {layout.ticks.map((tk) => (
              <div key={tk.label} className="htl-tick" style={{ left: tk.x, top: 0, height: height - 16 }}>
                <span>{tk.label}</span>
              </div>
            ))}
            {layout.placed.map(({ p, x, lane, side, left }, i) => {
              const labelTop = side < 0 ? axisY - (lane + 1) * LANE_H - 4 : axisY + lane * LANE_H + 12;
              const stemTop = side < 0 ? labelTop + 40 : axisY;
              const stemH = side < 0 ? axisY - stemTop : labelTop - axisY;
              const active = activeId === p.arxivId;
              const dim = activeId !== null && !active;
              return (
                <div
                  key={p.arxivId}
                  className={`htl-item ${active ? "active" : ""} ${dim ? "dim" : ""}`}
                  style={{ animationDelay: `${i * 35}ms` }}
                  onMouseEnter={() => onHover(p.arxivId)}
                  onFocus={() => onHover(p.arxivId)}
                >
                  <div className="htl-stem" style={{ left: x, top: stemTop, height: Math.max(stemH, 0) }} />
                  <button type="button" className="htl-dot" style={{ left: x, top: axisY }} aria-label={p.title} onClick={() => onOpen(p.arxivId)} />
                  <button
                    type="button"
                    className="htl-label"
                    style={{ left, top: labelTop, width: LABEL_W }}
                    title={`${p.title} · ${formatDate(p.published)}`}
                    onClick={() => onOpen(p.arxivId)}
                  >
                    <span className="htl-title">{p.title}</span>
                    <span className="htl-date">{formatDate(p.published)}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
