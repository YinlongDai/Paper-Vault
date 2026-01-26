import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(_req: Request, { params }: { params: { arxivId: string } }) {
  const paper = await prisma.savedPaper.findUnique({ where: { arxivId: params.arxivId } });
  if (!paper) return NextResponse.json({ ok: true });

  await prisma.savedPaperLabel.deleteMany({ where: { paperId: paper.id } });
  await prisma.savedPaper.delete({ where: { arxivId: params.arxivId } });

  return NextResponse.json({ ok: true });
}