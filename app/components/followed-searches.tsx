"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type Paper, fetchJson, formatDate, sendJson, shortAuthors } from "@/lib/papers";
import { useCanEdit, useToast } from "./providers";
import { Spinner } from "./ui";

export type SavedSearch = { id: number; query: string; field: string; createdAt: string; lastSeenAt: string | null };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function loadSearches() {
  const j = await fetchJson<{ searches: SavedSearch[] }>("/api/searches");
  return j.searches ?? [];
}

function searchHref(s: SavedSearch, sortByDate = true) {
  const sp = new URLSearchParams({ q: s.query });
  if (s.field !== "title") sp.set("field", s.field);
  if (sortByDate) sp.set("sort", "submittedDate");
  return `/?${sp.toString()}`;
}

/** "Follow this search" toggle shown above search results. */
export function FollowSearchButton({ query, field }: { query: string; field: string }) {
  const canEdit = useCanEdit();
  const toast = useToast();
  const [existing, setExisting] = useState<SavedSearch | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadSearches()
      .then((all) => !cancelled && setExisting(all.find((s) => s.query.toLowerCase() === query.toLowerCase() && s.field === field) ?? null))
      .catch(() => !cancelled && setExisting(null));
    return () => {
      cancelled = true;
    };
  }, [query, field]);

  if (!canEdit || existing === undefined) return null;

  return existing ? (
    <button
      type="button"
      className="btn btn-sm btn-saved"
      title="Stop following this search"
      onClick={async () => {
        await fetchJson(`/api/searches?id=${existing.id}`, { method: "DELETE" }).catch(() => {});
        setExisting(null);
        toast("Stopped following this search");
      }}
    >
      ★ Following
    </button>
  ) : (
    <button
      type="button"
      className="btn btn-sm"
      title="Show new papers for this search on the home page every week"
      onClick={async () => {
        try {
          const j = await sendJson<{ search: SavedSearch }>("/api/searches", "POST", { query, field });
          setExisting(j.search);
          toast("Following: new papers will show on the home page");
        } catch (e: any) {
          toast(String(e?.message ?? e), { kind: "error" });
        }
      }}
    >
      ☆ Follow search
    </button>
  );
}

type Feed = { search: SavedSearch; papers: Paper[]; unseen: number; error?: string };

/** Home: newest arXiv papers (last 7 days) for each followed search. */
export function NewThisWeek() {
  const canEdit = useCanEdit();
  const [feeds, setFeeds] = useState<Feed[] | null>(null);

  const load = useCallback(async () => {
    const searches = await loadSearches().catch(() => [] as SavedSearch[]);
    if (!searches.length) {
      setFeeds([]);
      return;
    }
    const since = Date.now() - WEEK_MS;
    const results = await Promise.all(
      searches.map(async (s): Promise<Feed> => {
        try {
          const j = await fetchJson<{ papers: Paper[] }>(
            `/api/arxiv?q=${encodeURIComponent(s.query)}&max=25&start=0&field=${encodeURIComponent(s.field)}&sort=submittedDate&order=descending`
          );
          // arXiv only: date-sorted OpenAlex matches are loose and sometimes carry future dates.
          const until = Date.now() + 24 * 60 * 60 * 1000;
          const papers = (j.papers ?? []).filter((p) => {
            const t = Date.parse(p.published) || 0;
            return p.source !== "openalex" && t >= since && t <= until;
          });
          const seen = Date.parse(s.lastSeenAt ?? "") || 0;
          return { search: s, papers, unseen: papers.filter((p) => (Date.parse(p.published) || 0) > seen).length };
        } catch (e: any) {
          return { search: s, papers: [], unseen: 0, error: String(e?.message ?? e) };
        }
      })
    );
    setFeeds(results);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (feeds === null) {
    return (
      <section className="card reveal" style={{ marginTop: 20 }}>
        <h2 className="section-title">New this week</h2>
        <div className="row meta">
          <Spinner /> Checking your followed searches…
        </div>
      </section>
    );
  }
  if (!feeds.length) return null;

  return (
    <section className="card reveal" style={{ marginTop: 20, animationDelay: "60ms" }}>
      <h2 className="section-title">New this week · followed searches</h2>
      <div className="feeds">
        {feeds.map((f) => (
          <div key={f.search.id} className="feed">
            <div className="row" style={{ marginBottom: 6 }}>
              <Link href={searchHref(f.search)} style={{ fontWeight: 650, textDecoration: "none" }}>
                “{f.search.query}”
              </Link>
              {f.unseen > 0 && <span className="new-version-badge">{f.unseen} new</span>}
              <span className="spacer" />
              <span className="meta" style={{ fontSize: 12 }}>
                {f.papers.length} this week
              </span>
            </div>
            {f.error ? (
              <div className="meta" style={{ fontSize: 12.5 }}>
                Couldn&apos;t check: {f.error}
              </div>
            ) : f.papers.length === 0 ? (
              <div className="meta" style={{ fontSize: 12.5 }}>
                Nothing new in the last 7 days.
              </div>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {f.papers.slice(0, 3).map((p) => (
                  <a key={p.arxivId} href={p.absUrl} target="_blank" rel="noreferrer" className="feed-item">
                    <span className="tl-title" style={{ fontSize: 13 }}>
                      {p.title}
                    </span>
                    <span className="meta" style={{ fontSize: 11.5 }}>
                      {shortAuthors(p.authors, 2)} · {formatDate(p.published)}
                    </span>
                  </a>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 8, gap: 10 }}>
              <Link href={searchHref(f.search)} className="link-btn" style={{ textDecoration: "none" }}>
                See all →
              </Link>
              {canEdit && f.unseen > 0 && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={async () => {
                    await sendJson("/api/searches", "POST", { id: f.search.id, action: "seen" }).catch(() => {});
                    setFeeds((cur) => cur?.map((x) => (x.search.id === f.search.id ? { ...x, unseen: 0 } : x)) ?? cur);
                  }}
                >
                  Mark seen
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
