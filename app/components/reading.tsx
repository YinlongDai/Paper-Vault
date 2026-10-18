"use client";

import { type Paper, type ReadStatus, STATUS_LABEL } from "@/lib/papers";

const ORDER: ReadStatus[] = ["unread", "reading", "done"];

export function statusOf(p: Pick<Paper, "status">): ReadStatus {
  return p.status === "reading" || p.status === "done" ? p.status : "unread";
}

/** Segmented To read / Reading / Done control (read-only label for visitors). */
export function StatusPicker({ value, canEdit, onChange }: { value: ReadStatus; canEdit: boolean; onChange: (s: ReadStatus) => void }) {
  if (!canEdit) return <StatusBadge status={value} />;
  return (
    <div className="segmented" role="radiogroup" aria-label="Reading status">
      {ORDER.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} className={`seg seg-${s}`} onClick={() => onChange(s)}>
          {STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

/** Small status pill; clicking cycles the status when `onCycle` is given. */
export function StatusBadge({ status, onCycle }: { status: ReadStatus; onCycle?: () => void }) {
  const cls = `status-pill status-${status}`;
  if (!onCycle) return <span className={cls}>{STATUS_LABEL[status]}</span>;
  return (
    <button
      type="button"
      className={cls}
      title="Click to change reading status"
      onClick={(e) => {
        e.stopPropagation();
        onCycle();
      }}
    >
      {STATUS_LABEL[status]}
    </button>
  );
}

export function nextStatus(s: ReadStatus): ReadStatus {
  return ORDER[(ORDER.indexOf(s) + 1) % ORDER.length];
}

export function PriorityToggle({ high, canEdit, onChange }: { high: boolean; canEdit: boolean; onChange: (high: boolean) => void }) {
  if (!canEdit) return high ? <span className="priority-flag on">⚑ High priority</span> : null;
  return (
    <button
      type="button"
      className={`priority-flag ${high ? "on" : ""}`}
      aria-pressed={high}
      title={high ? "Remove high priority" : "Mark as high priority"}
      onClick={() => onChange(!high)}
    >
      ⚑ {high ? "High priority" : "Priority"}
    </button>
  );
}

/** "p. 5 / 25" with a thin bar. */
export function ReadingProgress({ page, count }: { page?: number | null; count?: number | null }) {
  if (!page || !count) return null;
  const pct = Math.min(100, Math.round((page / count) * 100));
  return (
    <span className="progress" title={`Page ${page} of ${count}`}>
      <span className="progress-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span>
        p. {page} / {count}
      </span>
    </span>
  );
}
