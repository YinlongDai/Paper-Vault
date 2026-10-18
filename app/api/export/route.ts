import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { denyUnlessEditor } from "@/lib/access";
import { parseLinks } from "@/lib/links";

export const dynamic = "force-dynamic";

// Owner-only exports (they contain private notes):
//   ?format=md&arxivId=…        one paper as Markdown
//   ?format=md&label=…          papers with a label
//   ?format=md&status=reading   papers with a reading status
//   ?format=md                  whole library
//   ?format=json                full backup: papers, labels, notes, highlights, links

const STATUS: Record<string, string> = { unread: "To read", reading: "Reading", done: "Done" };

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "export";
}

function dateOnly(s: string | Date | null | undefined) {
  const ms = Date.parse(String(s ?? ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "";
}

function quote(text: string) {
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

type Row = Awaited<ReturnType<typeof load>>[number];

async function load(where: object) {
  return prisma.savedPaper.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      labels: { include: { label: true } },
      annotations: { orderBy: [{ page: "asc" }, { createdAt: "asc" }] },
    },
  });
}

function paperMarkdown(p: Row) {
  const out: string[] = [];
  const isArxiv = !p.arxivId.startsWith("openalex:");
  out.push(`# ${p.title}`, "");
  const meta = [p.authors && `*${p.authors}*`, p.published && `Published ${dateOnly(p.published)}`, isArxiv && `arXiv [${p.arxivId}](${p.absUrl})`]
    .filter(Boolean)
    .join(" · ");
  if (meta) out.push(meta, "");

  const links = parseLinks(p.links).items;
  if (links.length) out.push(links.map((l) => `[${l.kind === "code" ? "Code" : "Project page"}](${l.url})`).join(" · "), "");

  const labels = p.labels.map((x) => x.label.name);
  const status = `${STATUS[p.status] ?? p.status}${p.lastPage && p.pageCount ? ` (p. ${p.lastPage}/${p.pageCount})` : ""}${p.priority ? " · ⚑ high priority" : ""}`;
  out.push(`**Status:** ${status}${labels.length ? `  \n**Labels:** ${labels.join(", ")}` : ""}`, "");

  if (p.summary.trim()) out.push("## Abstract", "", p.summary.trim(), "");
  if ((p.note ?? "").trim()) out.push("## Notes", "", (p.note ?? "").trim(), "");

  if (p.annotations.length) {
    out.push("## Highlights", "");
    for (const a of p.annotations) {
      out.push(`**p. ${a.page}${a.version ? ` · ${a.version}` : ""}**`, "", quote(a.quote), "");
      if (a.note.trim()) out.push(a.note.trim(), "");
    }
  }

  if ((p.aiSummary ?? "").trim()) out.push("## AI summary", "", (p.aiSummary ?? "").trim(), "");
  return out.join("\n");
}

export async function GET(req: Request) {
  const denied = await denyUnlessEditor();
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "json" ? "json" : "md";
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const [papers, labels] = await Promise.all([load({}), prisma.label.findMany({ orderBy: { name: "asc" } })]);
    const backup = {
      app: "paper-vault",
      exportedAt: new Date().toISOString(),
      labels: labels.map((l) => l.name),
      papers: papers.map(({ labels: pl, annotations, id: _id, ...p }) => ({
        ...p,
        labelNames: pl.map((x) => x.label.name),
        links: parseLinks(p.links),
        annotations: annotations.map(({ id: _a, paperId: _p, rects, ...a }) => ({ ...a, rects: JSON.parse(rects || "[]") })),
      })),
    };
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="paper-vault-backup-${stamp}.json"`,
      },
    });
  }

  const arxivId = (sp.get("arxivId") ?? "").trim();
  const label = (sp.get("label") ?? "").trim();
  const status = (sp.get("status") ?? "").trim();
  const where = arxivId
    ? { arxivId }
    : label
      ? { labels: { some: { label: { name: label } } } }
      : status
        ? { status }
        : {};
  const papers = await load(where);
  if (!papers.length) return NextResponse.json({ error: "Nothing to export" }, { status: 404 });

  const scope = arxivId ? papers[0].title : label ? `Label: ${label}` : status ? STATUS[status] ?? status : "Library";
  const body =
    papers.length === 1
      ? paperMarkdown(papers[0])
      : [`# Paper Vault: ${scope}`, "", `Exported ${stamp} · ${papers.length} papers`, "", ...papers.map((p) => "---\n\n" + paperMarkdown(p).replace(/^# /, "## ").replace(/\n## /g, "\n### "))].join("\n");

  return new NextResponse(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${slug(scope)}-${stamp}.md"`,
    },
  });
}
