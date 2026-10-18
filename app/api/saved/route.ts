import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyUnlessEditor, getViewer } from "@/lib/access";
import { redactText } from "@/lib/redact";
import { parseLinks } from "@/lib/links";

const DEFAULT_LABELS = ["Feature Learning", "Robotic Foundation Model", "World Model"];

/** Seed starter labels into a brand-new, empty library only (so deleting every label doesn't bring them back). */
async function ensureDefaultLabels() {
  const [labelCount, paperCount] = await Promise.all([prisma.label.count(), prisma.savedPaper.count()]);
  if (labelCount > 0 || paperCount > 0) return;

  // Upsert one by one: works on both SQLite and Postgres and is safe if two requests race.
  for (const name of DEFAULT_LABELS) {
    await prisma.label.upsert({ where: { name }, update: {}, create: { name } });
  }
}

/** Reading state and links carried over when "Undo remove" re-creates a paper. */
function restoreFields(p: any) {
  const out: Record<string, unknown> = {};
  if (["unread", "reading", "done"].includes(p?.status)) out.status = p.status;
  if (p?.priority === 0 || p?.priority === 1) out.priority = p.priority;
  for (const k of ["lastPage", "pageCount"]) if (Number.isInteger(p?.[k]) && p[k] > 0) out[k] = p[k];
  if (typeof p?.lastZoom === "number" && p.lastZoom > 0) out.lastZoom = p.lastZoom;
  for (const k of ["lastReadAt", "versionCheckedAt", "linksCheckedAt"])
    if (p?.[k] && Number.isFinite(Date.parse(p[k]))) out[k] = new Date(p[k]);
  for (const k of ["latestVersion", "versionSeen"]) if (typeof p?.[k] === "string" && /^v\d+$/.test(p[k])) out[k] = p[k];
  if (Array.isArray(p?.links)) out.links = JSON.stringify({ items: p.links, removed: [] });
  return out;
}

function cleanLabelNames(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from(new Set(arr.map((x) => String(x ?? "").trim()).filter(Boolean)));
}

/** Replace the full label set of a paper, creating any labels that don't exist yet. */
async function setPaperLabels(paperId: number, labelNames: string[]) {
  for (const name of labelNames) {
    await prisma.label.upsert({ where: { name }, update: {}, create: { name } });
  }

  await prisma.savedPaperLabel.deleteMany({ where: { paperId } });

  if (labelNames.length > 0) {
    const labels = await prisma.label.findMany({ where: { name: { in: labelNames } } });
    await prisma.savedPaperLabel.createMany({
      data: labels.map((l) => ({ paperId, labelId: l.id })),
    });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");

    if (type === "labels") {
      await ensureDefaultLabels();
      const labels = await prisma.label.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { papers: true } } },
      });
      return NextResponse.json({
        labels: labels.map((l) => ({ id: l.id, name: l.name, count: l._count.papers })),
      });
    }

    const items = await prisma.savedPaper.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        labels: { include: { label: true } },
        _count: { select: { annotations: true } },
      },
    });

    // Notes are private: only the owner gets the real text.
    const { canEdit } = await getViewer();

    const itemsWithLabels = items.map(({ labels, _count, links, linksCheckedAt: _checked, ...p }) => ({
      ...p,
      links: parseLinks(links).items,
      ...(canEdit || !String(p.note ?? "").trim() ? {} : { note: redactText(p.note ?? ""), noteHidden: true }),
      annotationCount: _count.annotations,
      labelNames: labels.map((x) => x.label.name).sort((a, b) => a.localeCompare(b)),
    }));

    return NextResponse.json({ items: itemsWithLabels });
  } catch (e: any) {
    console.error("[api/saved GET] error:", e);
    return NextResponse.json(
      { error: "Failed to fetch saved items", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;

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
  const arxivId = String(p?.arxivId ?? "").trim();
  if (!arxivId) return NextResponse.json({ error: "arxivId is required" }, { status: 400 });

  const existing = await prisma.savedPaper.findUnique({
    where: { arxivId },
    select: { aiSummary: true },
  });
  const shouldSummarize = !String(existing?.aiSummary ?? "").trim();

  const fields = {
    title: String(p.title ?? ""),
    authors: String(p.authors ?? ""),
    summary: String(p.summary ?? ""),
    pdfUrl: String(p.pdfUrl ?? ""),
    absUrl: String(p.absUrl ?? ""),
    published: String(p.published ?? ""),
  };

  const paper = await prisma.savedPaper.upsert({
    where: { arxivId },
    update: fields,
    // note / aiSummary / createdAt are only honoured on create so "Undo remove" can restore a paper as it was.
    create: {
      arxivId,
      ...fields,
      note: typeof p.note === "string" ? p.note : "",
      aiSummary: typeof p.aiSummary === "string" ? p.aiSummary : "",
      ...(p.createdAt && Number.isFinite(Date.parse(p.createdAt)) ? { createdAt: new Date(p.createdAt) } : {}),
      ...restoreFields(p),
    },
  });

  await setPaperLabels(paper.id, cleanLabelNames(p?.labelNames));

  return NextResponse.json({ ok: true, arxivId: paper.arxivId, shouldSummarize });
}

export async function DELETE(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;

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

  const paper = await prisma.savedPaper.findUnique({ where: { arxivId }, select: { id: true } });
  if (paper) {
    await prisma.savedPaperLabel.deleteMany({ where: { paperId: paper.id } });
    await prisma.annotation.deleteMany({ where: { paperId: paper.id } });
    await prisma.savedPaper.delete({ where: { id: paper.id } });
  }
  return NextResponse.json({ ok: true });
}

/**
 * Partial updates:
 *  - { arxivId, note }                → update the Markdown note
 *  - { arxivId, labelNames }          → replace the paper's labels
 *  - { kind: "label", from, to }      → rename a label everywhere
 */
export async function PATCH(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;

  try {
    const body = await req.json();

    if (body?.kind === "label") {
      const from = String(body?.from ?? "").trim();
      const to = String(body?.to ?? "").trim();
      if (!from || !to) return NextResponse.json({ error: "from and to are required" }, { status: 400 });
      if (from === to) return NextResponse.json({ ok: true });

      const clash = await prisma.label.findUnique({ where: { name: to } });
      if (clash) return NextResponse.json({ error: `Label "${to}" already exists` }, { status: 409 });

      await prisma.label.update({ where: { name: from }, data: { name: to } });
      return NextResponse.json({ ok: true });
    }

    const arxivId = String(body?.arxivId ?? "").trim();
    if (!arxivId) return NextResponse.json({ error: "arxivId is required" }, { status: 400 });

    const paper = await prisma.savedPaper.findUnique({ where: { arxivId }, select: { id: true } });
    if (!paper) return NextResponse.json({ error: "Paper not found" }, { status: 404 });

    if (typeof body?.note === "string") {
      await prisma.savedPaper.update({ where: { arxivId }, data: { note: body.note } });
    }

    // Reading queue / progress / version acknowledgement
    const data: {
      status?: string;
      priority?: number;
      lastPage?: number;
      pageCount?: number;
      lastZoom?: number;
      lastReadAt?: Date;
      versionSeen?: string;
    } = {};
    if (["unread", "reading", "done"].includes(body?.status)) data.status = body.status;
    if (body?.priority === 0 || body?.priority === 1) data.priority = body.priority;
    if (body?.progress && typeof body.progress === "object") {
      const pg = Math.floor(Number(body.progress.page));
      const pc = Math.floor(Number(body.progress.pageCount));
      const zm = Number(body.progress.zoom);
      if (pg >= 1) data.lastPage = pg;
      if (pc >= 1) data.pageCount = pc;
      if (zm > 0 && zm <= 10) data.lastZoom = zm;
      data.lastReadAt = new Date();
    }
    if (typeof body?.versionSeen === "string" && /^v\d+$/.test(body.versionSeen)) data.versionSeen = body.versionSeen;
    if (Object.keys(data).length) await prisma.savedPaper.update({ where: { arxivId }, data });

    if (Array.isArray(body?.labelNames)) {
      await setPaperLabels(paper.id, cleanLabelNames(body.labelNames));
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to update paper", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
