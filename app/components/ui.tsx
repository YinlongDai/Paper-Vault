"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { colorForLabel } from "@/lib/papers";
import { useViewer } from "./providers";

export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function StarIcon({ filled, size = 15 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
    </svg>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const viewer = useViewer();

  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <Link href="/" className="brand">
          <span aria-hidden="true">📚</span>
          <span>My Paper Vault</span>
        </Link>
        <nav className="nav">
          <Link href="/" className="nav-link" aria-current={pathname === "/" ? "page" : undefined}>
            <SearchIcon size={14} />
            <span>Search</span>
          </Link>
          <Link href="/saved" className="nav-link" aria-current={pathname.startsWith("/saved") ? "page" : undefined}>
            <StarIcon size={14} />
            <span>Library</span>
          </Link>
        </nav>
        <div className="spacer" />
        {viewer?.authEnabled &&
          (viewer.signedIn ? (
            <div className="row" style={{ gap: 10 }}>
              <span className="meta hide-sm">
                {viewer.name}
                {!viewer.canEdit && " · read-only"}
              </span>
              <a className="btn btn-sm btn-ghost" href="/api/auth/signout">
                Sign out
              </a>
            </div>
          ) : (
            <a className="btn btn-sm" href="/api/auth/signin">
              Sign in
            </a>
          ))}
      </div>
    </header>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <h2 className="modal-title" style={{ flex: 1 }}>
            {title}
          </h2>
          <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
        {footer && (
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** A "⋯" button with a dropdown that closes on outside click / Escape. */
export function Menu({ children, label = "More actions" }: { children: (close: () => void) => React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="btn btn-sm btn-ghost btn-icon"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function LabelChip({
  name,
  pressed,
  onClick,
  onRemove,
  count,
}: {
  name: string;
  pressed?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  count?: number;
}) {
  const style = { "--c": colorForLabel(name) } as React.CSSProperties;
  if (onRemove) {
    return (
      <span className="chip" style={{ ...style, cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
        {name}
        <button
          type="button"
          className="chip-x"
          aria-label={`Remove label ${name}`}
          title="Remove label"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </span>
    );
  }
  return (
    <button type="button" className="chip" style={style} aria-pressed={pressed} onClick={onClick}>
      {name}
      {typeof count === "number" && <span className="chip-count">{count}</span>}
    </button>
  );
}

/**
 * Toggle existing labels and create new ones inline.
 * `selected` is the set of chosen names; `onChange` receives the new set.
 */
export function LabelPicker({
  all,
  selected,
  onChange,
}: {
  all: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const names = Array.from(new Set([...all, ...selected])).sort((a, b) => a.localeCompare(b));
  const chosen = new Set(selected);

  function toggle(name: string) {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(Array.from(next));
  }

  function addDraft() {
    const name = draft.trim();
    if (!name) return;
    const existing = names.find((n) => n.toLowerCase() === name.toLowerCase());
    onChange(Array.from(new Set([...selected, existing ?? name])));
    setDraft("");
  }

  return (
    <div>
      <div className="row">
        {names.length === 0 && <span className="meta">No labels yet — create one below.</span>}
        {names.map((n) => (
          <LabelChip key={n} name={n} pressed={chosen.has(n)} onClick={() => toggle(n)} />
        ))}
      </div>
      <div className="row" style={{ marginTop: 12, flexWrap: "nowrap" }}>
        <input
          className="input"
          style={{ flex: 1, height: 32 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              addDraft();
            }
          }}
          placeholder="New label…"
          aria-label="New label name"
        />
        <button type="button" className="btn btn-sm" onClick={addDraft} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
