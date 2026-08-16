import { expect, test } from "bun:test";
import { createApp } from "../src/api/app";
import { IntelStore } from "../src/store/db";

const at = new Date("2026-08-16T08:00:00.000Z");

async function seededApp() {
  const store = new IntelStore(":memory:");
  const app = createApp({ store, now: () => at });
  const html = await Bun.file(new URL("./fixtures/tenders/ccgp-legal-counsel.html", import.meta.url)).text();
  const caseHtml = await Bun.file(new URL("./fixtures/cases/spc-guiding.html", import.meta.url)).text();
  const tender = await app.request("/api/intel/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceId: "ccgp",
      sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
      html,
    }),
  });
  const major = await app.request("/api/intel/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceId: "spc-guiding",
      sourceUrl: "https://www.court.gov.cn/zixun/xiangqing/20260801.html",
      html: caseHtml,
    }),
  });
  return { app, store, tender, major };
}

test("health and source registry are readable", async () => {
  const { app } = await seededApp();
  const health = await (await app.request("/api/health")).json();
  const sources = await (await app.request("/api/sources")).json();
  expect(health.ok).toBe(true);
  expect(health.items).toBe(2);
  expect(sources.sources.map((s: { id: string }) => s.id)).toEqual([
    "ccgp",
    "ggzy",
    "spc-guiding",
  ]);
});

test("list filters biddable tenders and major cases", async () => {
  const { app } = await seededApp();
  const tenders = await (await app.request("/api/intel?type=tender&biddable=1")).json();
  const cases = await (await app.request("/api/intel?type=major_case&q=独立保函")).json();
  expect(tenders.items).toHaveLength(1);
  expect(cases.items).toHaveLength(1);
});

test("export endpoints return three formats", async () => {
  const { app, tender } = await seededApp();
  const created = await tender.json();
  const id = created.item.id;
  const md = await app.request(`/api/intel/${id}/export.md`);
  const docx = await app.request(`/api/intel/${id}/export.docx`);
  const pdf = await app.request(`/api/intel/${id}/export.pdf`);
  expect(md.status).toBe(200);
  expect((await md.text()).startsWith("# ")).toBe(true);
  expect(docx.headers.get("content-type")).toContain("wordprocessingml");
  expect(pdf.headers.get("content-type")).toBe("application/pdf");
});

test("dashboard html is served", async () => {
  const { app } = await seededApp();
  const page = await app.request("/");
  const html = await page.text();
  expect(page.status).toBe(200);
  expect(html).toContain("律源 LexSource");
  expect(html).toContain("/api/intel");
});

test("bad ingest payload is rejected", async () => {
  const { app } = await seededApp();
  const res = await app.request("/api/intel/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<p>nope</p>" }),
  });
  expect(res.status).toBe(400);
});

test("missing intel returns 404", async () => {
  const { app } = await seededApp();
  const res = await app.request("/api/intel/does-not-exist");
  expect(res.status).toBe(404);
});
