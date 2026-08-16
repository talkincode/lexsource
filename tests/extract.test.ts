import { expect, test } from "bun:test";
import { extractMajorCase, extractTender } from "../src/pipeline/extract";
import { parseCcgp } from "../src/sources/ccgp";
import { spcAdapter } from "../src/sources/spc";

const now = new Date("2026-08-16T08:00:00.000Z");

test("extracts a CCGP legal-counsel tender from fixture html", async () => {
  const html = await Bun.file(new URL("./fixtures/tenders/ccgp-legal-counsel.html", import.meta.url)).text();
  const doc = parseCcgp({
    html,
    sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
  });
  doc.fetchedAt = now.toISOString();
  const item = extractTender(doc);
  expect(item.purchaser).toBe("某市司法局");
  expect(item.serviceType).toBe("general_counsel");
  expect(item.budget).toBe(865000);
  expect(item.deadlineAt).toContain("2026-12-20");
  expect(item.region).toBe("北京");
  expect(item.qualification).toContain("律师事务所");
});

test("extracts an SPC guiding case brief", async () => {
  const html = await Bun.file(new URL("./fixtures/cases/spc-guiding.html", import.meta.url)).text();
  const doc = spcAdapter.parse({
    html,
    sourceUrl: "https://www.court.gov.cn/zixun/xiangqing/20260801.html",
  });
  const item = extractMajorCase(doc);
  expect(item.caseClass).toBe("guiding");
  expect(item.holding).toContain("独立保函");
  expect(item.statutes.some((s) => s.includes("民法典"))).toBe(true);
  expect(item.lawFirmAngles).toContain("precedent");
  expect(item.briefMarkdown).toContain("裁判要旨");
});
