import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ✅ Next.js 16: params is a Promise
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ arxivId: string }> }
) {
  const { arxivId } = await context.params;

  const paper = await prisma.savedPaper.findUnique({ where: { arxivId } });
  if (!paper) return NextResponse.json({ ok: true });

  await prisma.savedPaperLabel.deleteMany({ where: { paperId: paper.id } });
  await prisma.savedPaper.delete({ where: { arxivId } });

  return NextResponse.json({ ok: true });
}