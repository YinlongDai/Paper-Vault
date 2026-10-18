// OpenAlex request helper. Without a key, OpenAlex gives each IP a small shared daily budget (and hosting
// providers share IPs between many sites), so set OPENALEX_API_KEY (free at https://openalex.org/settings/api)
// to get your own budget. The mailto parameter puts requests in OpenAlex's "polite pool".

export function openalexUrl(url: string) {
  const u = new URL(url);
  const key = String(process.env.OPENALEX_API_KEY ?? "").trim();
  if (key && !u.searchParams.has("api_key")) u.searchParams.set("api_key", key);
  if (!u.searchParams.has("mailto")) u.searchParams.set("mailto", "paper-vault@users.noreply.github.com");
  return u.toString();
}

/** Best open-access PDF for an OpenAlex work, plus its arXiv id when that copy lives on arXiv. */
export function openAccessPdf(work: any): { pdfUrl: string; arxivId: string } {
  const locations: any[] = [work?.best_oa_location, ...(Array.isArray(work?.locations) ? work.locations : [])].filter(Boolean);
  const withPdf = locations.find((l) => typeof l?.pdf_url === "string" && l.pdf_url);
  const arxivLanding = locations.map((l) => String(l?.landing_page_url ?? "")).find((u) => /arxiv\.org\/abs\//i.test(u)) ?? "";
  const arxivId = (arxivLanding.match(/arxiv\.org\/abs\/([^?#\s]+)/i)?.[1] ?? "").replace(/v\d+$/i, "");
  const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : String(withPdf?.pdf_url ?? "");
  return { pdfUrl, arxivId };
}
