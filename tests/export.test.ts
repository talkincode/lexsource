import { expect, test } from "bun:test";
import { toDocx } from "../src/export/docx";
import { toMarkdown } from "../src/export/markdown";
import { toPdf } from "../src/export/pdf";
import { extractTender } from "../src/pipeline/extract";
import { verifyIntel } from "../src/pipeline/verify";
import { parseCcgp } from "../src/sources/ccgp";

async function sampleTender() {
  const html = await Bun.file(new URL("./fixtures/tenders/ccgp-legal-counsel.html", import.meta.url)).text();
  return verifyIntel(
    extractTender(
      parseCcgp({
        html,
        sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
      }),
    ),
    new Date("2026-08-16T08:00:00.000Z"),
  );
}

test("markdown export is the canonical text form", async () => {
  const md = toMarkdown(await sampleTender());
  expect(md).toContain("# 某市司法局2026年度常年法律顾问服务公开招标公告");
  expect(md).toContain("某市司法局");
  expect(md).toContain("86.5万元");
  expect(md).toContain("https://www.ccgp.gov.cn/");
});

test("docx and pdf are generated from the same markdown source", async () => {
  const item = await sampleTender();
  const docx = await toDocx(item);
  const pdf = await toPdf(item);
  expect(docx.byteLength).toBeGreaterThan(1000);
  expect(Buffer.from(docx.subarray(0, 2)).toString()).toBe("PK");
  expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
});
