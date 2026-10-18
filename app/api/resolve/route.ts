import { NextResponse } from "next/server";
import { resolvePaper } from "@/lib/resolve";

export const dynamic = "force-dynamic";

/** GET ?input=<arXiv id / link / DOI>[&title=1] → { paper } or 404. Read-only lookup. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const input = (sp.get("input") ?? "").slice(0, 500);
  try {
    const paper = await resolvePaper(input, sp.get("title") === "1");
    if (!paper) return NextResponse.json({ error: "Couldn't find that paper" }, { status: 404 });
    return NextResponse.json({ paper });
  } catch (e: any) {
    return NextResponse.json({ error: "Lookup failed", detail: String(e?.message ?? e) }, { status: 502 });
  }
}
