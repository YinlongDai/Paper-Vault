import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyUnlessEditor } from "@/lib/access";
import { type LinkKind, type LinksState, classify, findLinks, normalizeUrl, parseLinks } from "@/lib/links";
import { openAccessPdf, openalexUrl } from "@/lib/openalex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function loadPaper(arxivId: string) {
  return prisma.savedPaper.findUnique({
    where: { arxivId },
    select: { id: true, arxivId: true, pdfUrl: true, summary: true, links: true, linksCheckedAt: true },
  });
}

async function save(id: number, state: LinksState, checked: boolean) {
  await prisma.savedPaper.update({
    where: { id },
    data: { links: JSON.stringify(state), ...(checked ? { linksCheckedAt: new Date() } : {}) },
  });
}

/** Re-scan, keeping manual links and anything the owner removed out of the result. */
async function scan(
  paper: NonNullable<Awaited<ReturnType<typeof loadPaper>>>,
  prev: LinksState
): Promise<LinksState & { failed: string[] }> {
  let arxivId = paper.arxivId;
  let pdfUrl = paper.pdfUrl;
  const oaFailed: string[] = [];

  // OpenAlex papers: look up an open-access PDF (often an arXiv copy) and remember it as the paper's PDF.
  if (paper.arxivId.startsWith("openalex:")) {
    arxivId = "";
    pdfUrl = "";
    try {
      const workId = paper.arxivId.slice("openalex:".length).split("/").pop();
      const res = await fetch(openalexUrl(`https://api.openalex.org/works/${workId}?select=id,best_oa_location,locations`), { cache: "no-store" });
      if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
      const oa = openAccessPdf(await res.json());
      arxivId = oa.arxivId;
      pdfUrl = oa.pdfUrl;
      if (oa.pdfUrl && oa.pdfUrl !== paper.pdfUrl) {
        await prisma.savedPaper.update({ where: { id: paper.id }, data: { pdfUrl: oa.pdfUrl } });
      }
    } catch (e: any) {
      oaFailed.push(`openalex: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }

  const { links: found, failed: scanFailed } = await findLinks({ arxivId, pdfUrl, abstract: paper.summary });
  const failed = [...oaFailed, ...scanFailed];
  const removed = new Set(prev.removed.map((u) => u.toLowerCase()));
  const manual = prev.items.filter((l) => l.source === "manual");
  const seen = new Set(manual.map((l) => l.url.toLowerCase()));
  const auto = found.filter((l) => !removed.has(l.url.toLowerCase()) && !seen.has(l.url.toLowerCase()));
  return { items: [...manual, ...auto], removed: prev.removed, failed };
}

/**
 * GET ?arxivId=… → { links, checkedAt }
 * The first request for a paper scans its sources and stores the result; later requests read the cache.
 */
export async function GET(req: Request) {
  const arxivId = (new URL(req.url).searchParams.get("arxivId") ?? "").trim();
  if (!arxivId) return NextResponse.json({ error: "arxivId is required" }, { status: 400 });

  const paper = await loadPaper(arxivId);
  if (!paper) return NextResponse.json({ links: [], checkedAt: null });

  let state = parseLinks(paper.links);
  let checkedAt = paper.linksCheckedAt;
  let failed: string[] = [];
  if (!checkedAt) {
    const scanned = await scan(paper, state);
    failed = scanned.failed;
    state = { items: scanned.items, removed: scanned.removed };
    // If every source failed, don't cache an empty result; try again next time.
    const allFailed = failed.length >= 3;
    await save(paper.id, state, !allFailed);
    checkedAt = allFailed ? null : new Date();
  }
  return NextResponse.json({ links: state.items, checkedAt, ...(failed.length ? { failed } : {}) });
}

/**
 * POST (owner only)
 *  { arxivId, action: "rescan" }
 *  { arxivId, action: "add", url, kind? }
 *  { arxivId, action: "remove", url }
 */
export async function POST(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const arxivId = String(body?.arxivId ?? "").trim();
  const paper = arxivId ? await loadPaper(arxivId) : null;
  if (!paper) return NextResponse.json({ error: "Paper not found in library" }, { status: 404 });

  let state = parseLinks(paper.links);
  const action = String(body?.action ?? "");

  let failed: string[] = [];
  if (action === "rescan") {
    const scanned = await scan(paper, state);
    failed = scanned.failed;
    state = { items: scanned.items, removed: scanned.removed };
    await save(paper.id, state, true);
  } else if (action === "add") {
    const url = normalizeUrl(String(body?.url ?? "")) ?? "";
    if (!url) return NextResponse.json({ error: "Enter a full http(s) link" }, { status: 400 });
    const kind: LinkKind = body?.kind === "code" || body?.kind === "project" ? body.kind : classify(url) ?? "project";
    const key = url.toLowerCase();
    state = {
      items: [...state.items.filter((l) => l.url.toLowerCase() !== key), { kind, url, source: "manual" }],
      removed: state.removed.filter((u) => u.toLowerCase() !== key),
    };
    await save(paper.id, state, false);
  } else if (action === "remove") {
    const key = String(body?.url ?? "").toLowerCase();
    if (!key) return NextResponse.json({ error: "url is required" }, { status: 400 });
    const target = state.items.find((l) => l.url.toLowerCase() === key);
    state = {
      items: state.items.filter((l) => l.url.toLowerCase() !== key),
      // Remember removed auto-found links so a re-scan doesn't bring them back.
      removed: target && target.source !== "manual" ? [...new Set([...state.removed, target.url])] : state.removed,
    };
    await save(paper.id, state, false);
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  return NextResponse.json({ links: state.items, ...(failed.length ? { failed } : {}) });
}
