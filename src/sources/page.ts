import * as cheerio from "cheerio";
import { nowIso } from "../domain/intel";
import { cleanPageText, cleanTitle } from "../domain/readability";
import type { RawDocument } from "./types";

export type PageLink = { url: string; text: string };

export function htmlToDocument(input: {
  sourceId: string;
  sourceUrl: string;
  html?: string;
  text?: string;
}): RawDocument {
  const html = input.html ?? "";
  const $ = html ? cheerio.load(html) : null;
  $?.("script, style, noscript, nav, header, footer, aside, iframe, form").remove();
  const title = cleanTitle(
    $?.("h1, .vF_detail_title, .title, title").first().text().replace(/\s+/g, " ").trim() ||
      input.text?.split("\n").map((line) => line.trim()).find(Boolean) ||
      "未命名页面",
  );
  const main = $?.(".vF_detail_content, .vF_detail, article, main, #content, .content").first();
  const raw = (main && main.text().trim().length > 40 ? main.text() : $?.("body").text()) ?? input.text ?? "";
  const text = cleanPageText(normalizeText(raw));
  return {
    sourceId: input.sourceId,
    sourceUrl: input.sourceUrl,
    fetchedAt: nowIso(),
    titleHint: title,
    html: html || undefined,
    text: text || title,
  };
}

export function extractLinks(html: string, baseUrl: string, limit = 40): PageLink[] {
  const $ = cheerio.load(html);
  const found: PageLink[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    if (found.length >= limit) return;
    const href = $(el).attr("href")?.trim();
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) return;
    try {
      const abs = new URL(href, baseUrl);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
      abs.hash = "";
      const url = abs.href;
      if (url === baseUrl || seen.has(url)) return;
      seen.add(url);
      const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 120);
      found.push({ url, text: text || url });
    } catch {
      // skip malformed href
    }
  });
  return found;
}

export function excerpt(text: string, max = 2400): string {
  const normalized = normalizeText(text);
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
