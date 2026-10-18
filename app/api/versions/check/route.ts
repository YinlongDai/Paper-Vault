import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STALE_MS = 12 * 60 * 60 * 1000;
const UA = { "User-Agent": "paper-vault/0.1 (self-hosted)" };
const ARXIV_ID = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/i;

/**
 * GET → checks arXiv for newer versions of saved papers (at most every 12h per paper) and records the
 * latest version. One arXiv API request covers up to 50 papers. Returns { checked, updated }.
 */
export async function GET() {
  const cutoff = new Date(Date.now() - STALE_MS);
  const papers = await prisma.savedPaper.findMany({
    where: { OR: [{ versionCheckedAt: null }, { versionCheckedAt: { lt: cutoff } }] },
    select: { id: true, arxivId: true },
  });
  const arxiv = papers.filter((p) => ARXIV_ID.test(p.arxivId));
  if (!arxiv.length) return NextResponse.json({ checked: 0, updated: 0 });

  let checked = 0;
  let updated = 0;
  for (let i = 0; i < arxiv.length; i += 50) {
    const batch = arxiv.slice(i, i + 50);
    const bare = batch.map((p) => p.arxivId.replace(/v\d+$/i, ""));
    try {
      const res = await fetch(`https://export.arxiv.org/api/query?id_list=${bare.join(",")}&max_results=${bare.length}`, {
        headers: UA,
        cache: "no-store",
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const latest = new Map<string, string>();
      for (const entry of xml.split("<entry>").slice(1)) {
        const id = (entry.match(/<id>\s*https?:\/\/arxiv\.org\/abs\/([^<\s]+)\s*<\/id>/) ?? [])[1] ?? "";
        const m = id.match(/^(.*?)(v\d+)$/);
        if (m) latest.set(m[1].toLowerCase(), m[2]);
      }
      const now = new Date();
      for (const p of batch) {
        const v = latest.get(p.arxivId.replace(/v\d+$/i, "").toLowerCase());
        await prisma.savedPaper.update({
          where: { id: p.id },
          data: { versionCheckedAt: now, ...(v ? { latestVersion: v } : {}) },
        });
        checked++;
        if (v) updated++;
      }
    } catch (e) {
      console.warn("[versions/check]", String((e as Error)?.message ?? e));
    }
  }
  return NextResponse.json({ checked, updated });
}
