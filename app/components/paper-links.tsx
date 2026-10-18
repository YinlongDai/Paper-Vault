"use client";

import { useEffect, useState } from "react";
import { fetchJson, sendJson } from "@/lib/papers";
import { useToast } from "./providers";
import { Modal, Spinner } from "./ui";

export type PaperLink = { kind: "code" | "project"; url: string; source: string; stars?: number };

const SOURCE_LABEL: Record<string, string> = {
  pdf: "PDF first page",
  huggingface: "Hugging Face",
  arxiv: "arXiv listing",
  manual: "added by you",
};

export function CodeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.19c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function GlobeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
    </svg>
  );
}

function shortStars(n?: number) {
  if (typeof n !== "number") return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

function prettyUrl(u: string) {
  return u.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function linkLabel(l: PaperLink, many: boolean, manyProjects = false) {
  if (l.kind === "code") {
    const host = (() => {
      try {
        return new URL(l.url).hostname.replace(/^www\./, "");
      } catch {
        return "";
      }
    })();
    const repo = host === "github.com" ? l.url.split("/").slice(-1)[0] : "";
    return many && repo ? `Code · ${repo}` : host === "huggingface.co" ? "Hugging Face" : "Code";
  }
  if (manyProjects) {
    try {
      return new URL(l.url).hostname.replace(/^www\./, "");
    } catch {
      /* fall through */
    }
  }
  return "Project page";
}

/** Code / project-page buttons for a saved paper, with an owner-only editor. */
export function PaperLinks({
  arxivId,
  canEdit,
  onLoaded,
}: {
  arxivId: string;
  canEdit: boolean;
  /** Called once after the first load (the scan may have found an open-access PDF for the paper). */
  onLoaded?: () => void;
}) {
  const toast = useToast();
  const [links, setLinks] = useState<PaperLink[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [draftKind, setDraftKind] = useState<"auto" | "code" | "project">("auto");

  useEffect(() => {
    let cancelled = false;
    setLinks(null);
    fetchJson<{ links: PaperLink[] }>(`/api/links?arxivId=${encodeURIComponent(arxivId)}`)
      .then((j) => {
        if (cancelled) return;
        setLinks(j.links ?? []);
        onLoaded?.();
      })
      .catch(() => !cancelled && setLinks([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arxivId]);

  async function act(body: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const j = await sendJson<{ links: PaperLink[] }>("/api/links", "POST", { arxivId, ...body });
      setLinks(j.links ?? []);
      if (ok) toast(ok);
      return true;
    } catch (e: any) {
      toast(String(e?.message ?? e), { kind: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (links === null) {
    return (
      <span className="btn btn-sm btn-ghost" style={{ cursor: "default" }}>
        <Spinner /> Finding code…
      </span>
    );
  }

  const codeCount = links.filter((l) => l.kind === "code").length;
  const projectCount = links.filter((l) => l.kind === "project").length;

  return (
    <>
      {links.map((l) => (
        <a key={l.url} className={`btn btn-sm link-btn-${l.kind}`} href={l.url} target="_blank" rel="noreferrer" title={l.url}>
          {l.kind === "code" ? <CodeIcon /> : <GlobeIcon />}
          {linkLabel(l, codeCount > 1, projectCount > 1)}
          {l.stars !== undefined && <span className="chip-count">★ {shortStars(l.stars)}</span>}
        </a>
      ))}
      {canEdit && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)} title="Edit code and project links">
          {links.length ? "✎ Links" : "+ Code / project link"}
        </button>
      )}

      {editing && (
        <Modal
          title="Code & project links"
          onClose={() => setEditing(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => act({ action: "rescan" }, "Links re-scanned")} disabled={busy}>
                {busy ? <Spinner /> : "↻"} Re-scan
              </button>
              <span className="spacer" />
              <button type="button" className="btn btn-primary" onClick={() => setEditing(false)}>
                Done
              </button>
            </>
          }
        >
          <div className="meta" style={{ marginBottom: 12 }}>
            Found automatically from the PDF&apos;s first page, Hugging Face and the arXiv listing. Remove wrong ones or add your own; removed
            links stay hidden after a re-scan.
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {links.length === 0 && <div className="meta">No links yet.</div>}
            {links.map((l) => (
              <div key={l.url} className="row" style={{ flexWrap: "nowrap", gap: 10 }}>
                <span className="badge" style={{ flex: "none" }}>
                  {l.kind === "code" ? <CodeIcon size={11} /> : <GlobeIcon size={11} />}
                  {l.kind === "code" ? "Code" : "Project"}
                </span>
                <a href={l.url} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontSize: 13.5 }}>
                  {prettyUrl(l.url)}
                </a>
                <span className="meta hide-sm" style={{ fontSize: 12, flex: "none" }}>
                  {SOURCE_LABEL[l.source] ?? l.source}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-icon"
                  aria-label={`Remove ${l.url}`}
                  title="Remove"
                  disabled={busy}
                  onClick={() => act({ action: "remove", url: l.url })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <form
            className="row"
            style={{ marginTop: 16, flexWrap: "nowrap" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!draftUrl.trim()) return;
              const ok = await act({ action: "add", url: draftUrl.trim(), ...(draftKind !== "auto" ? { kind: draftKind } : {}) });
              if (ok) setDraftUrl("");
            }}
          >
            <input
              className="input"
              style={{ flex: 1, height: 32 }}
              placeholder="https://github.com/owner/repo"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              aria-label="Link to add"
            />
            <select className="select" style={{ height: 32 }} value={draftKind} onChange={(e) => setDraftKind(e.target.value as any)} aria-label="Link type">
              <option value="auto">Auto</option>
              <option value="code">Code</option>
              <option value="project">Project page</option>
            </select>
            <button type="submit" className="btn btn-sm" disabled={busy || !draftUrl.trim()}>
              Add
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
