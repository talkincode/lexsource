import * as cheerio from "cheerio";
import { nowIso } from "../domain/intel";
import type { RawDocument, SourceAdapter } from "./types";

export const CCGP_SOURCE_ID = "ccgp";

export const ccgpAdapter: SourceAdapter = {
  id: CCGP_SOURCE_ID,
  name: "中国政府采购网",
  kind: "tender",
  region: "全国",
  description: "财政部指定政府采购信息公开渠道，法律服务类招标公告主通道。",
  parse(input) {
    return parseCcgp(input);
  },
};

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
