import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/auth";

const DEFAULT_LABELS = ["Feature Learning", "Robotic Foundation Model", "World Model"];

async function ensureDefaultLabels() {
  const count = await prisma.label.count();
  if (count > 0) return;

  await prisma.label.createMany({
    data: DEFAULT_LABELS.map((name) => ({ name })),
    skipDuplicates: true,
  });
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const admin = String(process.env.ADMIN_GITHUB_USERNAME ?? "").trim();
  const username = String((session as any)?.user?.login ?? (session as any)?.user?.name ?? "").trim();

  if (!session) return { ok: false as const, status: 401 as const, msg: "Unauthorized" };
  if (!admin || username !== admin) return { ok: false as const, status: 403 as const, msg: "Forbidden" };
  return { ok: true as const };
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
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.msg }, { status: gate.status });

  const body = await req.json();

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

  const p = body;
  const labelNamesRaw: string[] = Array.isArray(p?.labelNames) ? p.labelNames : [];
  const labelNames = Array.from(new Set(labelNamesRaw.map((x) => String(x ?? "").trim()).filter(Boolean)));

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

  for (const raw of labelNames) {
    const name = String(raw ?? "").trim();
    if (!name) continue;
    await prisma.label.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  await prisma.savedPaperLabel.deleteMany({ where: { paperId: paper.id } });

  if (labelNames.length > 0) {
    const labels = await prisma.label.findMany({ where: { name: { in: labelNames } } });
    await prisma.savedPaperLabel.createMany({
      data: labels.map((l) => ({ paperId: paper.id, labelId: l.id })),
    });
  }

  return NextResponse.json({ ok: true, arxivId: paper.arxivId, shouldSummarize });
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.msg }, { status: gate.status });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const arxivId = searchParams.get("arxivId") ?? "";

  if (type === "label") {
    const name = String(searchParams.get("name") ?? "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const label = await prisma.label.findUnique({ where: { name } });
    if (!label) return NextResponse.json({ ok: true, deleted: false });

    await prisma.savedPaperLabel.deleteMany({ where: { labelId: label.id } });
    await prisma.label.delete({ where: { id: label.id } });

    return NextResponse.json({ ok: true, deleted: true });
  }

  if (!arxivId.trim()) return NextResponse.json({ error: "arxivId is required" }, { status: 400 });

  await prisma.savedPaper.delete({ where: { arxivId } });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.msg }, { status: gate.status });

  try {
    const body = await req.json();
    const arxivId = String(body?.arxivId ?? "").trim();
    const note = String(body?.note ?? "");

    if (!arxivId) return NextResponse.json({ error: "arxivId is required" }, { status: 400 });

    const updated = await prisma.savedPaper.update({
      where: { arxivId },
      data: { note },
    });

    return NextResponse.json({ ok: true, item: { arxivId: updated.arxivId, note: updated.note } });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to update note", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}