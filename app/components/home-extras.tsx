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
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [spin, setSpin] = useState(0);

  useEffect(() => {
    setLabel((cur) => (cur && candidates.includes(cur) ? cur : pickRandom(candidates)));
  }, [candidates]);

  const items = useMemo(() => {
    if (!label) return [];
    return papers
      .filter((p) => (p.labelNames ?? []).includes(label))
      .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  }, [papers, label]);

  if (!label) return null;

  const shown = items.slice(0, 8);
  let lastYear = "";
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
          const showYear = y !== lastYear;
          lastYear = y;
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

function Rediscover({ papers }: { papers: Paper[] }) {
  const [pick, setPick] = useState<Paper | undefined>(undefined);
  useEffect(() => {
    setPick((cur) => (cur && papers.some((p) => p.arxivId === cur.arxivId) ? cur : pickRandom(papers)));
  }, [papers]);
  if (!pick) return null;

  return (
    <section className="card reveal" style={{ animationDelay: "180ms" }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Rediscover
        </h2>
        <span className="spacer" />
        {papers.length > 1 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPick((cur) => pickRandom(papers, cur))}>
            Another
          </button>
        )}
      </div>
      <div key={pick.arxivId} className="reveal">
        <Link href={paperHref(pick)} className="paper-title" style={{ fontSize: 15 }}>
          {pick.title}
        </Link>
        <div className="meta" style={{ marginTop: 3 }}>
          {shortAuthors(pick.authors, 3)} · {formatDate(pick.published)}
        </div>
        {pick.summary && <div className="paper-abstract clamp-3" style={{ fontSize: 13.5 }}>{pick.summary}</div>}
        {(pick.labelNames ?? []).length > 0 && (
          <div className="row" style={{ marginTop: 10, gap: 6 }}>
            {(pick.labelNames ?? []).map((n) => (
              <LabelChip key={n} name={n} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function YearChart({ papers }: { papers: Paper[] }) {
  const data = useMemo(() => {
    const counts = new Map<number, number>();
    for (const p of papers) {
      const y = Number(yearOf(p.published));
      if (y) counts.set(y, (counts.get(y) ?? 0) + 1);
    }
    if (!counts.size) return [];
    const ys = [...counts.keys()];
    const min = Math.max(Math.min(...ys), Math.max(...ys) - 11);
    const max = Math.max(...ys);
    const out: { year: number; n: number }[] = [];
    for (let y = min; y <= max; y++) out.push({ year: y, n: counts.get(y) ?? 0 });
    return out;
  }, [papers]);

  if (data.length < 2) return null;
  const peak = Math.max(...data.map((d) => d.n), 1);

  return (
    <section className="card reveal" style={{ animationDelay: "240ms" }}>
      <h2 className="section-title">Papers by publication year</h2>
      <div className="spark">
        {data.map((d, i) => (
          <div
            key={d.year}
            className="spark-bar"
            title={`${d.year}: ${d.n} paper${d.n === 1 ? "" : "s"}`}
            style={{ height: `${Math.max(4, (d.n / peak) * 100)}%`, animationDelay: `${i * 40}ms`, opacity: d.n ? 1 : 0.3 }}
          />
        ))}
      </div>
      <div className="row meta" style={{ fontSize: 11.5, marginTop: 6 }}>
        <span>{data[0].year}</span>
        <span className="spacer" />
        <span>{data[data.length - 1].year}</span>
      </div>
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
    <section className="card reveal" style={{ animationDelay: "300ms" }}>
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
        <div className="stack" style={{ gap: 20 }}>
          <Rediscover papers={papers} />
          <YearChart papers={papers} />
          <RecentlySaved papers={papers} />
        </div>
      </div>
    </div>
  );
}
