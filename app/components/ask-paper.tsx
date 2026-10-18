"use client";

import { useEffect, useRef, useState } from "react";
import { renderMarkdown, sendJson } from "@/lib/papers";
import { useToast } from "./providers";
import { Spinner } from "./ui";

export type ChatMsg = { role: "user" | "model"; text: string; quote?: string };

const SUGGESTIONS = [
  "What problem does this paper solve, and why does it matter?",
  "Explain the method step by step in simple terms.",
  "What are the key results, and on which benchmarks?",
  "What are the limitations or open questions?",
  "How does it differ from prior work?",
];

/** Chat with Gemini about the paper's PDF. Messages live in the parent so they survive tab switches. */
export function AskPaper({
  arxivId,
  canEdit,
  hasPdf,
  messages,
  setMessages,
  seedQuote,
  clearSeed,
  onAddToNotes,
}: {
  arxivId: string;
  canEdit: boolean;
  hasPdf: boolean;
  messages: ChatMsg[];
  setMessages: (fn: (m: ChatMsg[]) => ChatMsg[]) => void;
  seedQuote: string;
  clearSeed: () => void;
  onAddToNotes: (markdown: string) => Promise<void>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, busy]);

  useEffect(() => {
    if (seedQuote) {
      setDraft((d) => d || "Explain this passage.");
      inputRef.current?.focus();
    }
  }, [seedQuote]);

  if (!canEdit) {
    return <div className="notice info">Only the owner can ask questions about papers (it uses the owner&apos;s Gemini quota).</div>;
  }
  if (!hasPdf) return <div className="notice info">This paper has no PDF, so there is nothing to ask about yet.</div>;

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const quote = seedQuote;
    const history = messages.map(({ role, text }) => ({ role, text }));
    setMessages((m) => [...m, { role: "user", text: q, quote: quote || undefined }]);
    setDraft("");
    clearSeed();
    setBusy(true);
    try {
      const j = await sendJson<{ answer: string }>("/api/ask", "POST", { arxivId, question: q, history, quote });
      setMessages((m) => [...m, { role: "model", text: j.answer }]);
    } catch (e: any) {
      toast(String(e?.message ?? e), { kind: "error" });
      setMessages((m) => m.slice(0, -1));
      setDraft(q);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Ask the paper
        </h2>
        <span className="spacer" />
        {messages.length > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMessages(() => [])} disabled={busy}>
            Clear chat
          </button>
        )}
      </div>

      {messages.length === 0 && (
        <div className="row" style={{ marginBottom: 12 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip chip-plain" onClick={() => ask(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.quote && <div className="note-quote" style={{ marginBottom: 6 }}>“{m.quote}”</div>}
            {m.role === "user" ? (
              <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
            ) : (
              <>
                <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                <div className="row" style={{ marginTop: 6, gap: 4 }}>
                  <button
                    type="button"
                    className="mini-btn"
                    onClick={async () => {
                      const q = messages[i - 1];
                      const md = `**Q:** ${q?.quote ? `“${q.quote}” — ` : ""}${q?.text ?? ""}\n\n${m.text}`;
                      await onAddToNotes(md);
                    }}
                  >
                    + Add to notes
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {busy && (
          <div className="chat-msg model">
            <span className="row meta">
              <Spinner /> Reading the paper…
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {seedQuote && (
        <div className="row" style={{ marginTop: 10, flexWrap: "nowrap" }}>
          <div className="note-quote" style={{ flex: 1 }}>
            Asking about: “{seedQuote}”
          </div>
          <button type="button" className="mini-btn" onClick={clearSeed}>
            ✕
          </button>
        </div>
      )}

      <form
        className="row"
        style={{ marginTop: 10, flexWrap: "nowrap", alignItems: "flex-end" }}
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <textarea
          ref={inputRef}
          className="textarea"
          style={{ flex: 1, minHeight: 44, fontFamily: "inherit", fontSize: 14 }}
          rows={2}
          value={draft}
          placeholder="Ask anything about this paper… (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(draft);
            }
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
          {busy ? <Spinner /> : "Ask"}
        </button>
      </form>
      <div className="meta" style={{ fontSize: 12, marginTop: 6 }}>
        Answers come from Gemini reading the PDF and can be wrong; check the cited pages.
      </div>
    </section>
  );
}
