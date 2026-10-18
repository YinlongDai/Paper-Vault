"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Viewer } from "@/lib/papers";

type Toast = { id: number; text: string; kind: "info" | "error"; action?: { label: string; run: () => void } };
type ToastFn = (text: string, opts?: { kind?: "info" | "error"; action?: Toast["action"] }) => void;

const ViewerCtx = createContext<Viewer | null>(null);
const ToastCtx = createContext<ToastFn>(() => {});

/** Who is looking at the page. `null` while loading. */
export function useViewer() {
  return useContext(ViewerCtx);
}

/** True when the current viewer may change data (always true in the local build). */
export function useCanEdit() {
  return !!useContext(ViewerCtx)?.canEdit;
}

export function useToast() {
  return useContext(ToastCtx);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((v) => setViewer(v))
      .catch(() => setViewer({ authEnabled: false, signedIn: false, canEdit: false, name: "" }));
  }, []);

  const toast = useCallback<ToastFn>((text, opts) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, kind: opts?.kind ?? "info", action: opts?.action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.action ? 6000 : 3200);
  }, []);

  return (
    <ViewerCtx.Provider value={viewer}>
      <ToastCtx.Provider value={toast}>
        {children}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
              <span>{t.text}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.run();
                    setToasts((all) => all.filter((x) => x.id !== t.id));
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </ViewerCtx.Provider>
  );
}
