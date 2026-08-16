import { expect, test } from "bun:test";
import { extractTender } from "../src/pipeline/extract";
import { verifyIntel } from "../src/pipeline/verify";
import { parseCcgp } from "../src/sources/ccgp";

const at = new Date("2026-08-16T08:00:00.000Z");

test("future complete tender verifies and is biddable", async () => {
  const html = await Bun.file(new URL("./fixtures/tenders/ccgp-legal-counsel.html", import.meta.url)).text();
  const item = verifyIntel(
    extractTender(
      parseCcgp({
        html,
        sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
      }),
    ),
    at,
  );
  expect(item.type).toBe("tender");
  if (item.type !== "tender") return;
  expect(item.verification.status).toBe("verified");
  expect(item.biddable).toBe(true);
});

test("expired tender needs review and is not biddable", async () => {
  const html = await Bun.file(new URL("./fixtures/tenders/ggzy-expired.html", import.meta.url)).text();
  const item = verifyIntel(
    extractTender(
      parseCcgp({
        html,
        sourceUrl: "https://www.ggzy.gov.cn/deal/202601/expired-legal.htm",
      }),
    ),
    at,
  );
  expect(item.type).toBe("tender");
  if (item.type !== "tender") return;
  expect(item.verification.status).toBe("needs_review");
  expect(item.biddable).toBe(false);
  expect(item.verification.checks.some((check) => check.name === "deadline_future" && !check.ok)).toBe(true);
});

test("wenshu source is allowed as reference intel", () => {
  const item = verifyIntel(
    extractTender({
      sourceId: "wenshu",
      sourceUrl: "https://wenshu.court.gov.cn/website/wenshu/181107ANFZ0BXSK4/index.html?docId=abc",
      fetchedAt: at.toISOString(),
      titleHint: "某市司法局法律顾问项目",
      text: "采购人：某市司法局\n预算金额：10万元\n投标截止时间：2026年12月1日\n法律顾问",
      suggestions: [],
    }),
    at,
  );
  expect(item.verification.status).not.toBe("failed");
  expect(item.verification.checks.some((check) => check.name === "source_allowed")).toBe(false);
});
