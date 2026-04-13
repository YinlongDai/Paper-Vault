import { NextRequest } from "next/server";

const ALLOW_HOSTS = new Set([
  "arxiv.org",
  "www.arxiv.org",
  "export.arxiv.org",
]);

function bad(status: number, msg: string) {
  return new Response(msg, { status });
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("url");
  if (!u) return bad(400, "Missing url");

  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return bad(400, "Invalid url");
  }

  if (target.protocol !== "https:") return bad(400, "Only https is allowed");
  if (!ALLOW_HOSTS.has(target.hostname)) return bad(403, "Host not allowed");

  // Pass Range header through for PDF.js partial loading (important for speed).
  const range = req.headers.get("range") ?? undefined;

  const upstream = await fetch(target.toString(), {
    headers: {
      ...(range ? { range } : {}),
      // Some CDNs behave better with a UA
      "user-agent": "paper-vault-pdf-proxy",
    },
    // Avoid caching surprises while debugging; you can relax later.
    cache: "no-store",
  });

  if (!upstream.ok && upstream.status !== 206) {
    return bad(upstream.status, `Upstream error: ${upstream.status}`);
  }

  const headers = new Headers(upstream.headers);

  // Ensure correct content type for pdf.js
  headers.set("content-type", "application/pdf");

  // Optional: keep range support headers if present
  // (upstream likely provides them; we just pass-through)
  // headers.get('accept-ranges'), 'content-range', etc.

  // Make sure this route isn't cached incorrectly by edge/CDN while testing
  headers.set("cache-control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status, // 200 or 206
    headers,
  });
}