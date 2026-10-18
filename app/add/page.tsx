"use client";

// Target of the "+ Paper Vault" bookmarklet: /add?url=<page the user was on>.

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { type Label, type Paper, fetchJson } from "@/lib/papers";
import { useCanEdit } from "../components/providers";
import { ReadOnlyNotice, Spinner } from "../components/ui";
import { type ResolvedPaper, ResolvedPreview, resolveInput } from "../components/quick-add";

function AddInner() {
  const params = useSearchParams();
  const url = (params.get("url") ?? params.get("q") ?? "").trim();
  const canEdit = useCanEdit();
  const [paper, setPaper] = useState<ResolvedPaper | null>(null);
  const [error, setError] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);

  async function loadLibrary() {
    const [s, l] = await Promise.all([
      fetchJson<{ items: Paper[] }>("/api/saved").catch(() => ({ items: [] as Paper[] })),
      fetchJson<{ labels: Label[] }>("/api/saved?type=labels").catch(() => ({ labels: [] as Label[] })),
    ]);
    setSavedIds(s.items.map((p) => p.arxivId));
    setLabels(l.labels.map((x) => x.name));
  }

  useEffect(() => {
    loadLibrary();
    if (!url) return;
    resolveInput(url)
      .then(setPaper)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [url]);

  return (
    <main className="container page" style={{ maxWidth: 680 }}>
      <h1 className="page-title">Add a paper</h1>
      <ReadOnlyNotice what="add papers" />
      <div style={{ marginTop: 16 }}>
        {!url ? (
          <div className="notice info">
            Open this page from the “+ Paper Vault” bookmarklet on a paper page, or use “+ Add paper” in the{" "}
            <Link href="/saved" style={{ textDecoration: "underline" }}>
              Library
            </Link>
            .
          </div>
        ) : error ? (
          <div className="notice">
            Couldn&apos;t find a paper for <code>{url}</code>: {error}
          </div>
        ) : !paper ? (
          <div className="card row">
            <Spinner /> <span className="muted">Looking up {url}…</span>
          </div>
        ) : (
          <ResolvedPreview paper={paper} labels={labels} savedIds={savedIds} canEdit={canEdit} onSaved={loadLibrary} />
        )}
      </div>
    </main>
  );
}

export default function AddPage() {
  return (
    <Suspense fallback={null}>
      <AddInner />
    </Suspense>
  );
}
