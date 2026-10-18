"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Label, type Paper, colorForLabel, formatDate, shortAuthors, yearOf } from "@/lib/papers";
import { LabelChip } from "./ui";

function pickRandom<T>(arr: T[], avoid?: T): T | undefined {
  if (!arr.length) return undefined;
  const pool = arr.length > 1 && avoid !== undefined ? arr.filter((x) => x !== avoid) : arr;
  return pool[Math.floor(Math.random() * pool.length)];
}

function paperHref(p: Paper) {
  return `/saved?paper=${encodeURIComponent(p.arxivId)}`;
}

/** Animates a number from 0 to `value` once it scrolls into view. */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const dur = 900;
      const tick = (t: number) => {
        const k = Math.min(1, (t - start) / dur);
        setShown(Math.round(value * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);

  return <span ref={ref}>{shown.toLocaleString()}</span>;
}

function LabelTimeline({ papers, labels }: { papers: Paper[]; labels: Label[] }) {
  const candidates = useMemo(() => {
    const withTwo = labels.filter((l) => l.count >= 2).map((l) => l.name);
    return withTwo.length ? withTwo : labels.filter((l) => l.count >= 1).map((l) => l.name);
  }, [labels]);
  // Mounted only once the library has loaded, so the random pick can happen in the initializer.
  const [picked, setLabel] = useState<string | undefined>(() => pickRandom(candidates));
  const [spin, setSpin] = useState(0);
  const label = picked && candidates.includes(picked) ? picked : candidates[0];

  const items = useMemo(() => {
    if (!label) return [];
    return papers
      .filter((p) => (p.labelNames ?? []).includes(label))
      .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  }, [papers, label]);

  if (!label) return null;

  const shown = items.slice(0, 8);
  const color = colorForLabel(label);

  return (
    <section className="card reveal" style={{ animationDelay: "120ms" }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Timeline
        </h2>
        <LabelChip name={label} />
        <span className="spacer" />
        {candidates.length > 1 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setLabel((cur) => pickRandom(candidates, cur));
              setSpin((s) => s + 1);
            }}
            title="Show another label"
          >
            <span className="shuffle-spin" style={{ transform: `rotate(${spin * 180}deg)` }}>
              ⟳
            </span>
            Shuffle
          </button>
        )}
      </div>
      <div className="meta" style={{ marginBottom: 6 }}>
        {items.length} paper{items.length === 1 ? "" : "s"} labelled “{label}”, newest first.
      </div>

      <div key={`${label}-${spin}`} className="timeline" style={{ "--tl-color": color } as React.CSSProperties}>
        {shown.map((p, i) => {
          const y = yearOf(p.published) || "Undated";
          const showYear = i === 0 || y !== (yearOf(shown[i - 1].published) || "Undated");
          return (
            <div key={p.arxivId}>
              {showYear && (
                <div className="tl-year reveal" style={{ animationDelay: `${i * 60}ms` }}>
                  {y}
                </div>
              )}
              <Link href={paperHref(p)} className="tl-item reveal" style={{ animationDelay: `${i * 60 + 30}ms` }}>
                <div className="tl-title">{p.title}</div>
                <div className="meta" style={{ marginTop: 2 }}>
                  {shortAuthors(p.authors, 3)} · {formatDate(p.published)}
                </div>
              </Link>
            </div>
          );
        })}
      </div>
      {items.length > shown.length && (
        <div className="meta" style={{ marginTop: 6 }}>
          +{items.length - shown.length} more in the{" "}
          <Link href="/saved" style={{ textDecoration: "underline" }}>
            Library
          </Link>
        </div>
      )}
    </section>
  );
}

function RecentlySaved({ papers }: { papers: Paper[] }) {
  const recent = useMemo(
    () => [...papers].sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0)).slice(0, 4),
    [papers]
  );
  if (!recent.length) return null;
  return (
    <section className="card reveal" style={{ animationDelay: "180ms" }}>
      <h2 className="section-title">Recently saved</h2>
      <div className="stack" style={{ gap: 10 }}>
        {recent.map((p) => (
          <Link key={p.arxivId} href={paperHref(p)} style={{ textDecoration: "none" }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{p.title}</div>
            <div className="meta" style={{ fontSize: 12 }}>
              saved {formatDate(p.createdAt)}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Library-driven extras shown on the search page before a query is entered. */
export function HomeExtras({ papers, labels }: { papers: Paper[]; labels: Label[] }) {
  if (!papers.length) return null;

  const notes = papers.filter((p) => String(p.note ?? "").trim()).length;
  const highlights = papers.reduce((n, p) => n + (p.annotationCount ?? 0), 0);
  const summaries = papers.filter((p) => String(p.aiSummary ?? "").trim()).length;

  const stats = [
    { label: "papers saved", value: papers.length },
    { label: "labels", value: labels.length },
    { label: "papers with notes", value: notes },
    { label: "highlights", value: highlights },
    { label: "AI summaries", value: summaries },
  ];

  return (
    <div style={{ marginTop: 28 }}>
      <div className="stats">
        {stats.map((s, i) => (
          <div key={s.label} className="stat reveal" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="stat-value">
              <CountUp value={s.value} />
            </div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="home-grid" style={{ marginTop: 20 }}>
        <LabelTimeline papers={papers} labels={labels} />
        <RecentlySaved papers={papers} />
      </div>
    </div>
  );
}
