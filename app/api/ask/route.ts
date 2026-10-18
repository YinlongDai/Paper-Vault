import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyUnlessEditor } from "@/lib/access";
import { type GeminiTurn, friendlyGeminiError, generate, pdfPart } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = [
  "You are a careful research assistant answering questions about the attached paper (PDF).",
  "Use only the paper unless the question explicitly asks for outside context, and say so when you do.",
  "Cite pages as (p. N) where the information appears. If the paper doesn't say, say that plainly.",
  "Answer concisely in Markdown; use short lists and LaTeX-free plain notation for math.",
].join(" ");

type Msg = { role: "user" | "model"; text: string };

/**
 * POST (owner only; uses the Gemini quota)
 * { arxivId, question, history?: [{ role, text }], quote?: string } → { answer }
 */
export async function POST(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const arxivId = String(body?.arxivId ?? "").trim();
    const question = String(body?.question ?? "").trim().slice(0, 4000);
    const quote = String(body?.quote ?? "").trim().slice(0, 4000);
    if (!arxivId || !question) return NextResponse.json({ error: "arxivId and question are required" }, { status: 400 });

    const paper = await prisma.savedPaper.findUnique({ where: { arxivId }, select: { title: true, pdfUrl: true, absUrl: true } });
    if (!paper) return NextResponse.json({ error: "Paper not found" }, { status: 404 });
    if (!paper.pdfUrl || paper.pdfUrl === paper.absUrl) return NextResponse.json({ error: "This paper has no PDF to read" }, { status: 400 });

    const history: Msg[] = (Array.isArray(body?.history) ? body.history : [])
      .filter((m: any) => (m?.role === "user" || m?.role === "model") && typeof m?.text === "string")
      .slice(-12)
      .map((m: any) => ({ role: m.role, text: String(m.text).slice(0, 8000) }));

    // The PDF rides along with the first user turn; later turns are plain text.
    const pdf = await pdfPart(paper.pdfUrl);
    const contents: GeminiTurn[] = [];
    const first = `Paper: ${paper.title}`;
    if (!history.length) {
      contents.push({ role: "user", parts: [{ text: first }, pdf, { text: withQuote(question, quote) }] });
    } else {
      history.forEach((m, i) => {
        contents.push(
          i === 0 && m.role === "user"
            ? { role: "user", parts: [{ text: first }, pdf, { text: m.text }] }
            : { role: m.role, parts: [{ text: m.text }] }
        );
      });
      if (history[0]?.role !== "user") contents.unshift({ role: "user", parts: [{ text: first }, pdf] });
      contents.push({ role: "user", parts: [{ text: withQuote(question, quote) }] });
    }

    const answer = await generate(contents, SYSTEM);
    return NextResponse.json({ answer: answer || "(No answer returned.)" });
  } catch (e: any) {
    const raw = String(e?.message ?? e);
    console.error("[api/ask] error:", raw);
    return NextResponse.json(
      { error: "Couldn't answer", detail: friendlyGeminiError(raw) },
      { status: /Missing GEMINI_API_KEY|API_KEY_INVALID/.test(raw) ? 503 : 500 }
    );
  }
}

function withQuote(question: string, quote: string) {
  return quote ? `About this passage from the paper:\n"""${quote}"""\n\n${question}` : question;
}
