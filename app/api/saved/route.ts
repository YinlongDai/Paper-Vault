import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_LABELS = ["Feature Learning", "Robotic Foundation Model", "World Model"];

async function ensureDefaultLabels() {
  for (const name of DEFAULT_LABELS) {
    await prisma.label.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");

  if (type === "labels") {
    await ensureDefaultLabels();
    const labels = await prisma.label.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json({ labels });
  }

  const items = await prisma.savedPaper.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      labels: { include: { label: true } },
    },
  });

  const itemsWithLabels = items.map((p) => ({
    ...p,
    labelNames: p.labels.map((x) => x.label.name),
  }));

  return NextResponse.json({ items: itemsWithLabels });
}

export async function POST(req: Request) {
  const body = await req.json();

  // Create label
  if (body?.kind === "label") {
    const name = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Label name is required" }, { status: 400 });

    const label = await prisma.label.upsert({
      where: { name },
      update: {},
      create: { name },
    });

    return NextResponse.json({ label });
  }

  // Save paper + assign labels
  const p = body;
  const labelNames: string[] = Array.isArray(p?.labelNames) ? p.labelNames : [];

  // Summarize only if we don't already have a cached AI summary.
  // (This covers first-save and also retries when a previous summarize failed.)
  const existing = await prisma.savedPaper.findUnique({
    where: { arxivId: p.arxivId },
    select: { aiSummary: true },
  });
  const shouldSummarize = !String(existing?.aiSummary ?? "").trim();

  const paper = await prisma.savedPaper.upsert({
    where: { arxivId: p.arxivId },
    update: {
      title: p.title,
      authors: p.authors,
      summary: p.summary,
      pdfUrl: p.pdfUrl,
      absUrl: p.absUrl,
      published: p.published,
      // Do NOT update note here
      // Do NOT update aiSummary here
    },
    create: {
      arxivId: p.arxivId,
      title: p.title,
      authors: p.authors,
      summary: p.summary,
      pdfUrl: p.pdfUrl,
      absUrl: p.absUrl,
      published: p.published,
      note: "",
      aiSummary: "",
    },
  });

  // Ensure labels exist
  for (const raw of labelNames) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    await prisma.label.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // Replace links
  await prisma.savedPaperLabel.deleteMany({ where: { paperId: paper.id } });

  if (labelNames.length > 0) {
    const labels = await prisma.label.findMany({ where: { name: { in: labelNames } } });
    await prisma.savedPaperLabel.createMany({
      data: labels.map((l) => ({ paperId: paper.id, labelId: l.id })),
    });
  }

  // Return shouldSummarize so the client can trigger /api/summarize (Option 1)
  return NextResponse.json({ ok: true, arxivId: paper.arxivId, shouldSummarize });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const arxivId = searchParams.get("arxivId") ?? "";

  if (!arxivId.trim()) {
    return NextResponse.json({ error: "arxivId is required" }, { status: 400 });
  }

  await prisma.savedPaper.delete({ where: { arxivId } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const arxivId = String(body?.arxivId ?? "").trim();
    const note = String(body?.note ?? "");

    if (!arxivId) {
      return NextResponse.json({ error: "arxivId is required" }, { status: 400 });
    }

    const updated = await prisma.savedPaper.update({
      where: { arxivId },
      data: { note },
    });

    // keep response light
    return NextResponse.json({ ok: true, item: { arxivId: updated.arxivId, note: updated.note } });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to update note", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}