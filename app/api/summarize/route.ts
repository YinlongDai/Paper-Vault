import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

async function listGeminiModels(key: string): Promise<any[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { cache: "no-store" as any });
  if (!r.ok) {
    const raw = await r.text().catch(() => "");
    throw new Error(`ListModels failed ${r.status}: ${raw}`);
  }
  const j: any = await r.json();
  return Array.isArray(j?.models) ? j.models : [];
}

function pickModelName(models: any[]): string {
  // Keep only models that support generateContent
  const supported = models.filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"));
  const names = supported.map((m) => String(m?.name ?? "").trim()).filter(Boolean);

  // Prefer Flash-style models for speed/cost
  const prefer = names.find((n) => /flash/i.test(n));
  if (prefer) return prefer;

  // Fallback: any model
  return names[0] || "";
}

async function summarizePdfWithGemini(pdfUrl: string, prompt: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");

  // fetch PDF bytes
  const pdfRes = await fetch(pdfUrl, {
    cache: "no-store" as any,
    redirect: "follow",
    headers: {
      "User-Agent": "paper-vault/0.1 (self-hosted)",
      Accept: "application/pdf,*/*;q=0.8",
    },
  });
  if (!pdfRes.ok) throw new Error(`Failed to fetch PDF: ${pdfRes.status}`);

  const len = Number(pdfRes.headers.get("content-length") || "0");
  const MAX_BYTES = 18 * 1024 * 1024; // 18MB
  if (len && len > MAX_BYTES) {
    throw new Error(
      `PDF too large (${Math.round(len / (1024 * 1024))}MB). Try a smaller PDF or use Gemini Files API.`
    );
  }

  const ab = await pdfRes.arrayBuffer();
  const b64 = Buffer.from(ab).toString("base64");

  // Gemini API supports passing PDFs inline as application/pdf
  // Allow overriding the model via env, otherwise auto-pick from ListModels.
  const envModel = String(process.env.GEMINI_MODEL ?? "").trim();
  let modelName = envModel;

  if (!modelName) {
    const models = await listGeminiModels(key);
    modelName = pickModelName(models);
  }

  if (!modelName) {
    throw new Error("No Gemini model available for generateContent. Check ListModels output / API key restrictions.");
  }

  // `modelName` may already include the `models/` prefix (as returned by ListModels).
  const modelPath = modelName.startsWith("models/") ? modelName : `models/${modelName}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(key)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "application/pdf", data: b64 } },
        ],
      },
    ],
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store" as any,
  });

  const raw = await r.text();
  if (!r.ok) {
    const msg = raw.length > 2000 ? raw.slice(0, 2000) + "..." : raw;
    throw new Error(`Gemini error ${r.status}: ${msg}`);
  }

  const j: any = JSON.parse(raw);
  const out =
    j?.candidates?.[0]?.content?.parts
      ?.map((p: any) => String(p?.text ?? ""))
      .join("") ?? "";

  return String(out).trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const arxivId = String(body?.arxivId ?? "").trim();

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

    // If already summarized, return cached
    if (paper.aiSummary && paper.aiSummary.trim()) {
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
    return NextResponse.json(
      { error: "Failed to summarize", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}