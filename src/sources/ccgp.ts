import { uniqueDetailUrls } from "./links";
import { htmlToDocument } from "./page";
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
  return htmlToDocument({
    sourceId: CCGP_SOURCE_ID,
    sourceUrl: input.sourceUrl,
    html: input.html,
    text: input.text,
  });
}
