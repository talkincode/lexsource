import * as cheerio from "cheerio";
import { nowIso } from "../domain/intel";
import { uniqueDetailUrls } from "./links";
import type { RawDocument, SourceAdapter } from "./types";

export const CCGP_SOURCE_ID = "ccgp";
export const CCGP_SEED_URL = "https://www.ccgp.gov.cn/cggg/zygg/gkzb/";

export const ccgpAdapter: SourceAdapter = {
  id: CCGP_SOURCE_ID,
  name: "中国政府采购网",
  kind: "tender",
  region: "全国",
  description: "财政部指定政府采购信息公开渠道，法律服务类招标公告主通道。",
  seedUrl: CCGP_SEED_URL,
  parse(input) {
    return parseCcgp(input);
  },
  discover(html, listingUrl) {
    return discoverCcgp(html, listingUrl);
  },
};

export function discoverCcgp(html: string, listingUrl: string): string[] {
  return uniqueDetailUrls(html, listingUrl, isCcgpDetail);
}

function isCcgpDetail(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)ccgp\.gov\.cn$/i.test(parsed.hostname)) return false;
    return /\/cggg\/.+\.html?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function parseCcgp(input: {
  html?: string;
  text?: string;
  sourceUrl: string;
}): RawDocument {
  const html = input.html ?? "";
  const $ = html ? cheerio.load(html) : null;
  const title =
    $?.("h1, .vF_detail_title, title").first().text().replace(/\s+/g, " ").trim() ||
    input.text?.split("\n").map((line) => line.trim()).find(Boolean) ||
    "未命名招标公告";
  const text = ($?.("body").text() ?? input.text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    sourceId: CCGP_SOURCE_ID,
    sourceUrl: input.sourceUrl,
    fetchedAt: nowIso(),
    titleHint: title,
    html: html || undefined,
    text,
  };
}
