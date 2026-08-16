import * as cheerio from "cheerio";

export function uniqueDetailUrls(
  html: string,
  listingUrl: string,
  isDetail: (url: string) => boolean,
): string[] {
  const $ = cheerio.load(html);
  const found = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) return;
    try {
      const abs = new URL(href, listingUrl);
      abs.hash = "";
      const normalized = abs.href;
      if (normalized === listingUrl) return;
      if (isDetail(normalized)) found.add(normalized);
    } catch {
      // skip malformed href
    }
  });
  return [...found];
}
