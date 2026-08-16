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
  expect(html).toContain("运行采集");
  expect(html).toContain("/api/ingest-runs");
  expect(html).toContain("/api/sources/");
  expect(html).toContain("/api/subscriptions");
  expect(html).toContain("创建订阅");
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

test("POST /api/sources/:id/run ingests from a recorded listing", async () => {
  const store = new IntelStore(":memory:");
  const list = await Bun.file(new URL("./fixtures/listings/ccgp-list.html", import.meta.url)).text();
  const detail = await Bun.file(new URL("./fixtures/tenders/ccgp-legal-counsel.html", import.meta.url)).text();
  const app = createApp({
    store,
    now: () => at,
    fetchHtml: async (url) => {
      if (url === "https://www.ccgp.gov.cn/cggg/zygg/gkzb/") {
        return {
          ok: true,
          sourceUrl: url,
          html: list,
          status: 200,
          fetchedAt: at.toISOString(),
          contentType: "text/html",
        };
      }
      if (url.endsWith("t20260801_000001.htm")) {
        return {
          ok: true,
          sourceUrl: url,
          html: detail,
          status: 200,
          fetchedAt: at.toISOString(),
          contentType: "text/html",
        };
      }
      return { ok: false, code: "http_error", message: "http_error:500", sourceUrl: url, status: 500 };
    },
  });

  const res = await app.request("/api/sources/ccgp/run", { method: "POST" });
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.run.status).toBe("partial");
  expect(body.run.succeeded).toBe(1);
  expect(body.run.failed).toBe(1);
  expect(store.count()).toBe(1);

  const logs = await (await app.request("/api/ingest-runs?sourceId=ccgp")).json();
  expect(logs.runs).toHaveLength(1);
  expect(logs.runs[0].trigger).toBe("api");
  expect(JSON.stringify(logs)).not.toContain("预算金额");
});

test("source run rejects unknown source, local paths, and blocked hosts", async () => {
  const store = new IntelStore(":memory:");
  const app = createApp({
    store,
    now: () => at,
    fetchHtml: async (url) => ({
      ok: false,
      code: "blocked_host",
      message: "blocked_host",
      sourceUrl: url,
    }),
  });

  const unknown = await app.request("/api/sources/not-a-source/run", { method: "POST" });
  expect(unknown.status).toBe(404);

  const local = await app.request("/api/sources/ccgp/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "./tests/fixtures/tenders/ccgp-legal-counsel.html" }),
  });
  expect(local.status).toBe(400);

  const blocked = await app.request("/api/sources/ccgp/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://wenshu.court.gov.cn/website/wenshu/181107ANFZ0BXSK4/index.html",
    }),
  });
  const blockedBody = await blocked.json();
  expect(blocked.status).toBe(200);
  expect(blockedBody.run.status).toBe("error");
  expect(blockedBody.run.error).toBe("blocked_host");
  expect(store.count()).toBe(0);

  const missingSeed = await app.request("/api/sources/spc-guiding/run", { method: "POST" });
  const missingBody = await missingSeed.json();
  expect(missingBody.run.error).toBe("seed_url_required");
  expect(store.count()).toBe(0);
});
