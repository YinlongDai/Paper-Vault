import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyUnlessEditor } from "@/lib/access";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ arxivId: string }> }
) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;

  const { arxivId } = await context.params;

  const paper = await prisma.savedPaper.findUnique({ where: { arxivId }, select: { id: true } });
  if (!paper) return NextResponse.json({ ok: true });

  await prisma.savedPaperLabel.deleteMany({ where: { paperId: paper.id } });
  await prisma.annotation.deleteMany({ where: { paperId: paper.id } });
  await prisma.savedPaper.delete({ where: { id: paper.id } });

  return NextResponse.json({ ok: true });
}
