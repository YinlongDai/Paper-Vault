// Gemini helpers shared by AI summaries and "Ask the paper". The PDF is sent inline (≤ 18 MB).

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
export type GeminiTurn = { role: "user" | "model"; parts: Part[] };

const MAX_PDF_BYTES = 18 * 1024 * 1024;
let cachedModel = "";

async function listGeminiModels(key: string): Promise<any[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { cache: "no-store" as any });
  if (!r.ok) {
    const raw = await r.text().catch(() => "");
    throw new Error(`ListModels failed ${r.status}: ${raw}`);
  }
  const j: any = await r.json();
  return Array.isArray(j?.models) ? j.models : [];
}

function pickModelName(models: any[]): string {
  // Keep only models that support generateContent; prefer Flash-style models for speed/cost.
  const supported = models.filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"));
  const names = supported.map((m) => String(m?.name ?? "").trim()).filter(Boolean);
  return names.find((n) => /flash/i.test(n)) || names[0] || "";
}

async function modelPath(key: string) {
  let name = String(process.env.GEMINI_MODEL ?? "").trim() || cachedModel;
  if (!name) {
    name = pickModelName(await listGeminiModels(key));
    cachedModel = name;
  }
  if (!name) throw new Error("No Gemini model available for generateContent. Check ListModels output / API key restrictions.");
  return name.startsWith("models/") ? name : `models/${name}`;
}

/** Download a PDF and return it as an inline Gemini part. */
export async function pdfPart(pdfUrl: string): Promise<Part> {
  const res = await fetch(pdfUrl, {
    cache: "no-store" as any,
    redirect: "follow",
    headers: { "User-Agent": "paper-vault/0.1 (self-hosted)", Accept: "application/pdf,*/*;q=0.8" },
  });
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
  const len = Number(res.headers.get("content-length") || "0");
  if (len && len > MAX_PDF_BYTES) throw new Error(`PDF too large (${Math.round(len / (1024 * 1024))}MB).`);
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_PDF_BYTES) throw new Error(`PDF too large (${Math.round(ab.byteLength / (1024 * 1024))}MB).`);
  return { inlineData: { mimeType: "application/pdf", data: Buffer.from(ab).toString("base64") } };
}

/** Run a Gemini conversation and return the text of the reply. */
export async function generate(contents: GeminiTurn[], systemInstruction?: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/${await modelPath(key)}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    }),
    cache: "no-store" as any,
  });
  const raw = await r.text();
  if (!r.ok) throw new Error(`Gemini error ${r.status}: ${raw.length > 2000 ? raw.slice(0, 2000) + "..." : raw}`);
  const j: any = JSON.parse(raw);
  return String(j?.candidates?.[0]?.content?.parts?.map((p: any) => String(p?.text ?? "")).join("") ?? "").trim();
}

/** One-line, user-facing version of a Gemini / PDF error. */
export function friendlyGeminiError(raw: string) {
  if (/Missing GEMINI_API_KEY/.test(raw)) return "AI is not set up: add GEMINI_API_KEY to your env file.";
  if (/API_KEY_INVALID|API key not valid/i.test(raw)) return "Gemini rejected the API key: check GEMINI_API_KEY.";
  if (/PDF too large/.test(raw)) return raw;
  if (/Failed to fetch PDF/.test(raw)) return raw;
  if (/Gemini error 429|RESOURCE_EXHAUSTED/.test(raw)) return "Gemini rate limit or quota reached: try again later.";
  const firstLine = raw.split("\n")[0];
  return firstLine.length > 200 ? firstLine.slice(0, 200) + "…" : firstLine;
}
