import { NextResponse } from "next/server";

function textBetween(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : "";
}

function allBetween(xml: string, tag: string) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const max = searchParams.get("max") ?? "10";
  const start = searchParams.get("start") ?? "0";
  const field = searchParams.get("field") ?? "smart";

  const sort = searchParams.get("sort") ?? "relevance";
  const order = searchParams.get("order") ?? "descending";

  const sortBy = sort === "submittedDate" || sort === "lastUpdatedDate" || sort === "relevance" ? sort : "relevance";
  const sortOrder = order === "ascending" || order === "descending" ? order : "descending";

  if (!q.trim()) {
    return NextResponse.json({ papers: [] });
  }

  const qq = q.trim();
  const quoted = `"${qq.replace(/"/g, "\\\"")}"`;

  let searchQuery = "";
  if (field === "title") {
    // Better title search:
    // 1) phrase match (ti:"...")
    // 2) all-words match (ti:word1 AND ti:word2 ...)
    // This tends to be much closer than raw `ti:<string>`.
    const words = qq
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z0-9_\-\.]/g, ""))
      .filter(Boolean);

    const allWords = words.length
      ? `(${words.map((w) => `ti:${w}`).join(" AND ")})`
      : "";

    searchQuery = allWords ? `(ti:${quoted} OR ${allWords})` : `ti:${quoted}`;
  }
  else if (field === "author") searchQuery = `au:${quoted}`;
  else if (field === "abstract") searchQuery = `abs:${qq}`;
  else if (field === "all") searchQuery = `all:${qq}`;
  else {
    // smart default: search title OR abstract
    searchQuery = `(ti:${qq} OR abs:${qq})`;
  }

  const url =
    `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}` +
    `&start=${start}&max_results=${max}&sortBy=${encodeURIComponent(sortBy)}&sortOrder=${encodeURIComponent(sortOrder)}`;

  const xml = await fetch(url, {
    headers: { "User-Agent": "paper-vault/0.1 (self-hosted)" },
    cache: "no-store",
  }).then((r) => r.text());

  const entries = xml.split("<entry>").slice(1).map((e) => "<entry>" + e);

  const papers = entries.map((e) => {
    const idUrl = textBetween(e, "id");
    const title = textBetween(e, "title").replace(/\s+/g, " ");
    const summary = textBetween(e, "summary").replace(/\s+/g, " ");
    const published = textBetween(e, "published");
    const authors = allBetween(e, "name").join(", ");

    const arxivId = idUrl.split("/abs/")[1] ?? idUrl;
    const absUrl = idUrl;
    const pdfUrl = idUrl.replace("/abs/", "/pdf/");

    return { arxivId, title, summary, published, authors, absUrl, pdfUrl };
  });

  return NextResponse.json({ papers });
}