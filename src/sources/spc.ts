import * as cheerio from "cheerio";
import { nowIso } from "../domain/intel";
import { uniqueDetailUrls } from "./links";
import type { RawDocument, SourceAdapter } from "./types";

export const SPC_SOURCE_ID = "spc-guiding";
export const SPC_SEED_URL = "https://www.court.gov.cn/zixun/gengduo/16.html";

export const spcAdapter: SourceAdapter = {
  id: SPC_SOURCE_ID,
  name: "最高人民法院指导性案例",
  kind: "major_case",
  region: "全国",
  description: "最高法公开发布的指导性案例、典型案例与公报案例。不采集裁判文书网原文。",
  seedUrl: SPC_SEED_URL,
  parse(input) {
    const html = input.html ?? "";
    const $ = html ? cheerio.load(html) : null;
    const title =
      $?.("h1, .title, title").first().text().replace(/\s+/g, " ").trim() ||
      input.text?.split("\n").map((line) => line.trim()).find(Boolean) ||
      "未命名案例";
    const text = ($?.("body").text() ?? input.text ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return {
      sourceId: SPC_SOURCE_ID,
      sourceUrl: input.sourceUrl,
      fetchedAt: nowIso(),
      titleHint: title,
      html: html || undefined,
      text,
    };
  },
  discover(html, listingUrl) {
    return uniqueDetailUrls(html, listingUrl, isSpcDetail);
  },
};

function isSpcDetail(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)court\.gov\.cn$/i.test(parsed.hostname)) return false;
    return /\/zixun\/xiangqing\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}
