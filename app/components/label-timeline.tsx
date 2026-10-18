"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Paper, colorForLabel, formatDate } from "@/lib/papers";

const LABEL_W = 156; // width of a title tag on the timeline
const LANE_H = 46;
const MAX_ROWS = 3; // rows of title tags per side (above / below the axis) before stretching sideways
const MAX_WIDTH = 6000; // stop stretching here and add rows instead
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
    // Measure once right away (ResizeObserver callbacks don't run while a tab isn't being painted).
    setViewW(el.clientWidth);
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
    const t0 = dated[0].t;
    const t1 = dated[dated.length - 1].t;
    const span = Math.max(t1 - t0, 1);

    /**
     * Greedy row assignment at a given width, alternating above / below the axis (up0, down0, up1, ...).
     * Returns null if more than `maxRows` rows per side would be needed. Tags never overlap.
     */
    const assign = (width: number, maxRows: number): Placed[] | null => {
      const xOf = (t: number) => (t1 === t0 ? width / 2 : pad + ((t - t0) / span) * (width - pad * 2));
      const rowEnd: number[][] = [[], []]; // [above, below] → right edge of the last tag in each row
      const out: Placed[] = [];
      for (const { p, t } of dated) {
        const x = xOf(t);
        const left = Math.min(Math.max(x - LABEL_W / 2, 0), width - LABEL_W);
        let found: { lane: number; side: -1 | 1 } | null = null;
        for (let lane = 0; lane < maxRows && !found; lane++) {
          for (const side of [-1, 1] as const) {
            const ends = rowEnd[side < 0 ? 0 : 1];
            if ((ends[lane] ?? -Infinity) + MIN_GAP <= left) {
              found = { lane, side };
              break;
            }
          }
        }
        if (!found) return null;
        rowEnd[found.side < 0 ? 0 : 1][found.lane] = left + LABEL_W;
        out.push({ p, t, x, lane: found.lane, side: found.side, left });
      }
      return out;
    };

    // 1) Up to MAX_ROWS rows per side at the visible width; 2) otherwise stretch the timeline (it scrolls
    // sideways) so papers bunched in time spread out; 3) as a last resort (e.g. same-day papers) add rows.
    let width = Math.max(viewW, 2 * pad + LABEL_W);
    let placed = assign(width, MAX_ROWS);
    for (let i = 0; !placed && i < 8 && width < MAX_WIDTH; i++) {
      width = Math.min(MAX_WIDTH, Math.round(width * 1.4));
      placed = assign(width, MAX_ROWS);
    }
    if (!placed) placed = assign(width, Infinity)!;

    // Only reserve the rows that are actually used on each side of the axis.
    const up = Math.max(0, ...placed.filter((x) => x.side < 0).map((x) => x.lane + 1));
    const down = Math.max(0, ...placed.filter((x) => x.side > 0).map((x) => x.lane + 1));
    return { width, placed, up, down };
  }, [dated, viewW]);

  const color = colorForLabel(label);
  const up = layout?.up ?? 1;
  const down = layout?.down ?? 0;
  const axisY = up * LANE_H + 8;
  const height = axisY + down * LANE_H + 12;

  return (
    <div className="htl-float" style={{ "--tl-color": color } as React.CSSProperties}>
      <div ref={wrapRef} className="htl-scroll" onMouseLeave={() => onHover(null)}>
        {layout && (
          <div className="htl" style={{ width: layout.width, height }}>
            <div className="htl-axis" style={{ top: axisY }} />
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
    </div>
  );
}
