import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyUnlessEditor } from "@/lib/access";

export const dynamic = "force-dynamic";

const COLORS = new Set(["yellow", "green", "blue", "pink", "purple"]);

type Rect = [number, number, number, number];

function cleanRects(raw: unknown): Rect[] {
  const arr = Array.isArray(raw) ? raw : [];
  const clamp = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
  return arr
    .filter((r): r is unknown[] => Array.isArray(r) && r.length === 4)
    .map((r) => r.map(clamp) as Rect)
    .filter(([, , w, h]) => w > 0 && h > 0)
    .slice(0, 200);
}

function toClient(a: { id: number; version: string; page: number; rects: string; quote: string; note: string; color: string; createdAt: Date; updatedAt: Date }) {
  let rects: Rect[] = [];
  try {
    rects = JSON.parse(a.rects);
  } catch {
    rects = [];
  }
  return { ...a, rects };
}

async function paperIdFor(arxivId: string) {
  const p = await prisma.savedPaper.findUnique({ where: { arxivId }, select: { id: true } });
  return p?.id ?? null;
}

/** GET ?arxivId=… → { annotations } (all versions; the client filters by the version it shows). */
export async function GET(req: Request) {
  const arxivId = (new URL(req.url).searchParams.get("arxivId") ?? "").trim();
  if (!arxivId) return NextResponse.json({ error: "arxivId is required" }, { status: 400 });

  const paperId = await paperIdFor(arxivId);
  if (!paperId) return NextResponse.json({ annotations: [] });

  const rows = await prisma.annotation.findMany({
    where: { paperId },
    orderBy: [{ page: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ annotations: rows.map(toClient) });
}

/** POST { arxivId, version, page, rects, quote, note?, color? } → { annotation } */
export async function POST(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const arxivId = String(body?.arxivId ?? "").trim();
  const paperId = arxivId ? await paperIdFor(arxivId) : null;
  if (!paperId) return NextResponse.json({ error: "Paper not found in library" }, { status: 404 });

  const rects = cleanRects(body?.rects);
  const page = Math.max(1, Math.floor(Number(body?.page) || 0));
  if (!rects.length || !page) return NextResponse.json({ error: "page and rects are required" }, { status: 400 });

  const row = await prisma.annotation.create({
    data: {
      paperId,
      version: String(body?.version ?? "").slice(0, 10),
      page,
      rects: JSON.stringify(rects),
      quote: String(body?.quote ?? "").slice(0, 4000),
      note: String(body?.note ?? "").slice(0, 20000),
      color: COLORS.has(body?.color) ? body.color : "yellow",
    },
  });
  return NextResponse.json({ annotation: toClient(row) });
}

/** PATCH { id, note?, color? } → { annotation } */
export async function PATCH(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const data: { note?: string; color?: string } = {};
  if (typeof body?.note === "string") data.note = body.note.slice(0, 20000);
  if (COLORS.has(body?.color)) data.color = body.color;

  try {
    const row = await prisma.annotation.update({ where: { id }, data });
    return NextResponse.json({ annotation: toClient(row) });
  } catch {
    return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
  }
}

/** DELETE ?id=… */
export async function DELETE(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });

  await prisma.annotation.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
