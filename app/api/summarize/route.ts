import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyUnlessEditor } from "@/lib/access";
import { friendlyGeminiError, generate, pdfPart } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function defaultPrompt(title: string) {
  return (
    `You are an expert research assistant. Summarize the attached paper PDF.\n\n` +
    `Title: ${title}\n\n` +
    `Return in Markdown with sections:\n` +
    `1) TL;DR (3-5 bullets)\n` +
    `2) Problem & motivation\n` +
    `3) Method\n` +
    `4) Key results / experiments\n` +
    `5) Limitations\n` +
    `6) 3-5 follow-up ideas / open questions\n\n` +
    `Be faithful to the paper. If something isn't stated, say so.`
  );
}

async function summarizePdfWithGemini(pdfUrl: string, prompt: string) {
  return generate([{ role: "user", parts: [{ text: prompt }, await pdfPart(pdfUrl)] }]);
}

export async function POST(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;

  try {
    const body = await req.json();
    const arxivId = String(body?.arxivId ?? "").trim();
    const force = body?.force === true;

    if (!arxivId) {
      return NextResponse.json({ error: "arxivId is required" }, { status: 400 });
    }

    const paper = await prisma.savedPaper.findUnique({
      where: { arxivId },
      select: { arxivId: true, title: true, pdfUrl: true, aiSummary: true },
    });

    if (!paper) {
      return NextResponse.json({ error: "Paper not found" }, { status: 404 });
    }

    // If already summarized, return cached (unless the caller asked to regenerate)
    if (!force && paper.aiSummary && paper.aiSummary.trim()) {
      return NextResponse.json({ ok: true, aiSummary: paper.aiSummary });
    }

    const prompt = String(body?.prompt ?? "").trim() || defaultPrompt(paper.title || "");
    const pdfUrl = String(paper.pdfUrl ?? "").trim();
    if (!pdfUrl) {
      return NextResponse.json({ error: "Missing pdfUrl for this paper" }, { status: 400 });
    }

    const summary = await summarizePdfWithGemini(pdfUrl, prompt);

    await prisma.savedPaper.update({
      where: { arxivId },
      data: { aiSummary: summary },
    });

    return NextResponse.json({ ok: true, aiSummary: summary });
  } catch (e: any) {
    const raw = String(e?.message ?? e);
    console.error("[api/summarize] error:", raw);
    return NextResponse.json(
      { error: "Failed to summarize", detail: friendlyGeminiError(raw) },
      { status: /Missing GEMINI_API_KEY|API_KEY_INVALID/.test(raw) ? 503 : 500 }
    );
  }
}
