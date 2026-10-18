import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyUnlessEditor } from "@/lib/access";

export const dynamic = "force-dynamic";

const FIELDS = new Set(["smart", "title", "author", "abstract", "all"]);

/** GET → { searches } */
export async function GET() {
  const searches = await prisma.savedSearch.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ searches });
}

/**
 * POST (owner)
 *  { query, field }        follow a search
 *  { id, action: "seen" }  mark its new papers as seen
 */
export async function POST(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));

  if (body?.action === "seen") {
    const id = Number(body?.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await prisma.savedSearch.updateMany({ where: { id }, data: { lastSeenAt: new Date() } });
    return NextResponse.json({ ok: true });
  }

  const query = String(body?.query ?? "").trim().slice(0, 200);
  const field = FIELDS.has(body?.field) ? body.field : "smart";
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });
  const search = await prisma.savedSearch.upsert({
    where: { query_field: { query, field } },
    update: {},
    create: { query, field, lastSeenAt: new Date() },
  });
  return NextResponse.json({ search });
}

/** DELETE ?id=… (owner) */
export async function DELETE(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await prisma.savedSearch.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
