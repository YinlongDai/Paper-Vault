import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Version = {
  version: string; // "v1"
  date: string; // ISO
  size: string; // "2,664 KB"
  title: string;
  summary: string;
  pdfUrl: string;
};

const UA = { "User-Agent": "paper-vault/0.1 (self-hosted)" };

function textBetween(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

function decode(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * GET ?id=2209.05557v3 → { id, versions: [{ version, date, size, title, summary, pdfUrl }] }
 * Dates and sizes come from the abstract page's submission history; each version's own
 * title/abstract comes from the arXiv API (which answers versioned ids individually).
 */
export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get("id") ?? "").trim();
  const id = raw.replace(/v\d+$/i, "");
  if (!/^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/i.test(id)) {
    return NextResponse.json({ error: "Not an arXiv id" }, { status: 400 });
  }

  try {
    const absRes = await fetch(`https://arxiv.org/abs/${id}`, { headers: UA, next: { revalidate: 3600 } });
    if (!absRes.ok) throw new Error(`arXiv abstract page returned ${absRes.status}`);
    const html = await absRes.text();

    const history: { version: string; date: string; size: string }[] = [];
    const re = /\[(v\d+)\](?:<\/a>)?<\/strong>\s*([^<(]+?)\s*\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const ms = Date.parse(m[2].trim());
      history.push({ version: m[1], date: Number.isFinite(ms) ? new Date(ms).toISOString() : m[2].trim(), size: m[3].trim() });
    }
    if (!history.length) throw new Error("Couldn't read the submission history");

    const ids = history.map((h) => `${id}${h.version}`).join(",");
    const apiRes = await fetch(`https://export.arxiv.org/api/query?id_list=${ids}&max_results=${history.length}`, {
      headers: UA,
      next: { revalidate: 3600 },
    });
    const xml = apiRes.ok ? await apiRes.text() : "";
    const meta = new Map<string, { title: string; summary: string }>();
    for (const e of xml.split("<entry>").slice(1)) {
      const v = (textBetween(e, "id").match(/(v\d+)$/) ?? [])[1];
      if (v) meta.set(v, { title: decode(textBetween(e, "title")), summary: decode(textBetween(e, "summary")) });
    }

    const versions: Version[] = history.map((h) => ({
      ...h,
      title: meta.get(h.version)?.title ?? "",
      summary: meta.get(h.version)?.summary ?? "",
      pdfUrl: `https://arxiv.org/pdf/${id}${h.version}`,
    }));

    return NextResponse.json({ id, versions });
  } catch (e: any) {
    return NextResponse.json({ error: "Failed to load versions", detail: String(e?.message ?? e) }, { status: 502 });
  }
}
