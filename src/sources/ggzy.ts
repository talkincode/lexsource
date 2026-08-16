import * as cheerio from "cheerio";
import { nowIso } from "../domain/intel";
import { uniqueDetailUrls } from "./links";
import type { RawDocument, SourceAdapter } from "./types";

export const GGZY_SOURCE_ID = "ggzy";
export const GGZY_SEED_URL = "https://www.ggzy.gov.cn/";

export const ggzyAdapter: SourceAdapter = {
  id: GGZY_SOURCE_ID,
  name: "全国公共资源交易平台",
  kind: "tender",
  region: "全国",
  description: "全国公共资源交易公告聚合通道，覆盖省级交易中心转发的法律服务采购。",
  seedUrl: GGZY_SEED_URL,
  discover(html, listingUrl) {
    return discoverGgzy(html, listingUrl);
  },
  parse(input) {
    const html = input.html ?? "";
    const $ = html ? cheerio.load(html) : null;
    const title =
      $?.("h1, .title, title").first().text().replace(/\s+/g, " ").trim() ||
      input.text?.split("\n").map((line) => line.trim()).find(Boolean) ||
      "未命名交易公告";
    const text = ($?.("body").text() ?? input.text ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return {
      sourceId: GGZY_SOURCE_ID,
      sourceUrl: input.sourceUrl,
      fetchedAt: nowIso(),
      titleHint: title,
      html: html || undefined,
      text,
    };
  },
};

export function discoverGgzy(html: string, listingUrl: string): string[] {
  return uniqueDetailUrls(html, listingUrl, isGgzyDetail);
}

function isGgzyDetail(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)ggzy\.gov\.cn$/i.test(parsed.hostname)) return false;
    return /\.html?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}
