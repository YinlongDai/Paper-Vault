"use client";

import { useEffect, useMemo, useState } from "react";
import { bareArxivId, diffWords, fetchJson, formatDate } from "@/lib/papers";
import { Spinner } from "./ui";

export type PaperVersion = { version: string; date: string; size: string; title: string; summary: string; pdfUrl: string };

/** Loads the arXiv version history for a paper (null while loading, [] when unavailable). */
export function useVersions(arxivId: string, enabled: boolean) {
  const [versions, setVersions] = useState<PaperVersion[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    setVersions(null);
    setError("");
    fetchJson<{ versions: PaperVersion[] }>(`/api/versions?id=${encodeURIComponent(bareArxivId(arxivId))}`)
      .then((j) => !cancelled && setVersions(j.versions ?? []))
      .catch((e) => {
        if (cancelled) return;
        setVersions([]);
        setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [arxivId, enabled]);

  return { versions, error };
}

function Diff({ a, b }: { a: string; b: string }) {
  const parts = useMemo(() => diffWords(a, b), [a, b]);
  const changed = parts.some((p) => p.kind !== "same");
  if (!changed) return <span>{b}</span>;
  return (
    <span>
      {parts.map((p, i) =>
        p.kind === "same" ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span key={i} className={p.kind === "add" ? "diff-add" : "diff-del"}>
            {p.text}
          </span>
        )
      )}
    </span>
  );
}

export function VersionsPanel({
  versions,
  error,
  savedVersion,
  readingVersion,
  annotationCounts,
  onRead,
}: {
  versions: PaperVersion[] | null;
  error: string;
  savedVersion: string;
  readingVersion: string;
  annotationCounts: Record<string, number>;
  onRead: (v: string) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sideBySide, setSideBySide] = useState(false);

  useEffect(() => {
    if (!versions?.length) return;
    const last = versions[versions.length - 1].version;
    const prev = versions.length > 1 ? versions[versions.length - 2].version : last;
    setFrom((f) => f || prev);
    setTo((t) => t || last);
  }, [versions]);

  if (versions === null) {
    return (
      <div className="card row">
        <Spinner /> <span className="muted">Loading version history from arXiv…</span>
      </div>
    );
  }
  if (!versions.length) {
    return <div className="notice info">{error ? `Couldn't load versions: ${error}` : "No version history available."}</div>;
  }

  const A = versions.find((v) => v.version === from);
  const B = versions.find((v) => v.version === to);
  const latest = versions[versions.length - 1].version;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="version-table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Submitted</th>
              <th>Size</th>
              <th>Highlights</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.version}>
                <td>
                  <b>{v.version}</b>
                  {v.version === latest && <span className="badge" style={{ marginLeft: 6 }}>latest</span>}
                  {v.version === savedVersion && <span className="badge" style={{ marginLeft: 6 }}>saved</span>}
                </td>
                <td>{formatDate(v.date)}</td>
                <td className="muted">{v.size}</td>
                <td className="muted">{annotationCounts[v.version] ?? 0}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${readingVersion === v.version ? "btn-primary" : ""}`}
                    onClick={() => onRead(v.version)}
                  >
                    {readingVersion === v.version ? "Reading" : "Read"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {versions.length > 1 && (
        <section className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <h2 className="section-title" style={{ margin: 0 }}>
              Compare
            </h2>
            <span className="spacer" />
            <select className="select" style={{ height: 30 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Older version">
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}
                </option>
              ))}
            </select>
            <span className="meta">→</span>
            <select className="select" style={{ height: 30 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Newer version">
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}
                </option>
              ))}
            </select>
          </div>

          {A && B && (
            <>
              <div className="meta" style={{ marginBottom: 10 }}>
                {A.version} ({formatDate(A.date)}) → {B.version} ({formatDate(B.date)}) ·{" "}
                <span className="diff-del">removed</span> <span className="diff-add">added</span>
              </div>
              <div style={{ fontWeight: 650, marginBottom: 8 }}>
                <Diff a={A.title} b={B.title} />
              </div>
              <div className="paper-abstract" style={{ marginTop: 0 }}>
                {A.summary || B.summary ? <Diff a={A.summary} b={B.summary} /> : <span className="meta">No abstract text available.</span>}
              </div>
              {A.summary === B.summary && A.title === B.title && (
                <div className="meta" style={{ marginTop: 8 }}>
                  Title and abstract are identical; the changes are inside the paper. Compare the PDFs below.
                </div>
              )}

              <div className="row" style={{ marginTop: 16 }}>
                <button type="button" className="btn btn-sm" onClick={() => setSideBySide((v) => !v)}>
                  {sideBySide ? "Hide PDFs" : "Show PDFs side by side"}
                </button>
              </div>
              {sideBySide && (
                <div className="split" style={{ marginTop: 12 }}>
                  {[A, B].map((v) => (
                    <div key={v.version}>
                      <div className="meta" style={{ marginBottom: 6 }}>
                        {v.version} · {formatDate(v.date)}
                      </div>
                      <iframe className="pdf-frame" style={{ height: "75vh" }} src={`/api/pdf?url=${encodeURIComponent(v.pdfUrl)}`} title={`PDF ${v.version}`} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
