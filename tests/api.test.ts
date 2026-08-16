import { expect, test } from "bun:test";
import { createApp } from "../src/api/app";
import { IntelStore } from "../src/store/db";
import { at, authedApp, fixture } from "./helpers";

async function seededApp() {
  const { app, store, headers } = await authedApp("admin");
  const html = await fixture("tenders/ccgp-legal-counsel.html");
  const caseHtml = await fixture("cases/spc-guiding.html");
  const tender = await app.request("/api/intel/ingest", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      sourceId: "ccgp",
      sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
      html,
    }),
  });
  const major = await app.request("/api/intel/ingest", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      sourceId: "spc-guiding",
      sourceUrl: "https://www.court.gov.cn/zixun/xiangqing/20260801.html",
      html: caseHtml,
    }),
  });
  return { app, store, tender, major, headers };
}

test("health and source registry are readable after login", async () => {
  const { app, headers } = await seededApp();
  const health = await (await app.request("/api/health", { headers })).json();
  const sources = await (await app.request("/api/sources", { headers })).json();
  expect(health.ok).toBe(true);
  expect(health.items).toBe(2);
  expect(sources.sources.map((s: { id: string }) => s.id)).toEqual([
    "ccgp",
    "ggzy",
    "spc-guiding",
  ]);
});

test("desk shows biddable tenders and cases without making the lawyer filter", async () => {
  const { app, headers } = await seededApp();
  const desk = await (await app.request("/api/desk", { headers })).json();
  expect(desk.tenders).toHaveLength(1);
  expect(desk.cases).toHaveLength(1);
  expect(desk.agents.map((agent: { id: string }) => agent.id)).toEqual(["tender", "case"]);

  const tenders = await (await app.request("/api/intel?type=tender&biddable=1", { headers })).json();
  const cases = await (await app.request("/api/intel?type=major_case&q=独立保函", { headers })).json();
  expect(tenders.items).toHaveLength(1);
  expect(cases.items).toHaveLength(1);
});

test("intel list supports region, keyword and pagination", async () => {
  const { app, headers } = await seededApp();
  const page = await (await app.request("/api/intel?type=tender&biddable=1&page=1&pageSize=1", { headers })).json();
  expect(page.items).toHaveLength(1);
  expect(page.total).toBe(1);
  expect(page.page).toBe(1);
  expect(page.regions).toContain("北京");

  const byRegion = await (await app.request("/api/intel?type=tender&region=北京", { headers })).json();
  expect(byRegion.items).toHaveLength(1);
  const missRegion = await (await app.request("/api/intel?type=tender&region=海南", { headers })).json();
  expect(missRegion.items).toHaveLength(0);

  const byWord = await (await app.request("/api/intel?type=tender&q=法律顾问", { headers })).json();
  expect(byWord.items).toHaveLength(1);
  const missWord = await (await app.request("/api/intel?type=tender&q=半导体", { headers })).json();
  expect(missWord.items).toHaveLength(0);
});

test("export endpoints return three formats", async () => {
  const { app, tender, headers } = await seededApp();
  const created = await tender.json();
  const id = created.item.id;
  const md = await app.request(`/api/intel/${id}/export.md`, { headers });
  const docx = await app.request(`/api/intel/${id}/export.docx`, { headers });
  const pdf = await app.request(`/api/intel/${id}/export.pdf`, { headers });
  expect(md.status).toBe(200);
  expect((await md.text()).startsWith("# ")).toBe(true);
  expect(docx.headers.get("content-type")).toContain("wordprocessingml");
  expect(pdf.headers.get("content-type")).toBe("application/pdf");
});

test("logged-in dashboard is a collected-intel desk, not a subscription console", async () => {
  const { app, headers } = await seededApp();
  const page = await app.request("/", { headers });
  const html = await page.text();
  expect(page.status).toBe(200);
  expect(html).toContain("律源 LexSource");
  expect(html).toContain("招投标");
  expect(html).toContain("案件情报");
  expect(html).toContain("/settings");
  expect(html).toContain("采集值班台");
  expect(html).toContain("采集状态加载中");
  expect(html).toContain("展开");
  expect(html).toContain("采集渠道");
  expect(html).toContain("查找");
  expect(html).toContain("全部地区");
  expect(html).toContain("上一页");
  expect(html).not.toContain("现在还能投");
  expect(html).not.toContain("所里能用的案件");
  expect(html).not.toContain("本轮步骤");
  expect(html).not.toContain("间隔（分钟）");
  expect(html).not.toContain("/api/subscriptions");
  expect(html).not.toContain("创建订阅");

  const settings = await app.request("/settings", { headers });
  const settingsHtml = await settings.text();
  expect(settings.status).toBe(200);
  expect(settingsHtml).toContain("间隔（天）");
  expect(settingsHtml).toContain("运行时刻");
  expect(settingsHtml).toContain("修改密码");
  expect(settingsHtml).toContain("新建用户");
});

test("bad ingest payload is rejected", async () => {
  const { app, headers } = await seededApp();
  const res = await app.request("/api/intel/ingest", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ html: "<p>nope</p>" }),
  });
  expect(res.status).toBe(400);
});

test("missing intel returns 404", async () => {
  const { app, headers } = await seededApp();
  const res = await app.request("/api/intel/does-not-exist", { headers });
  expect(res.status).toBe(404);
});

test("POST /api/sources/:id/run ingests from a recorded listing", async () => {
  const list = await fixture("listings/ccgp-list.html");
  const detail = await fixture("tenders/ccgp-legal-counsel.html");
  const { app, store, headers } = await authedApp("admin", {
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

  const res = await app.request("/api/sources/ccgp/run", { method: "POST", headers });
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.run.status).toBe("partial");
  expect(body.run.succeeded).toBe(1);
  expect(body.run.failed).toBeGreaterThanOrEqual(1);
  expect(store.count()).toBe(1);

  const logs = await (await app.request("/api/ingest-runs?sourceId=ccgp", { headers })).json();
  expect(logs.runs).toHaveLength(1);
  expect(logs.runs[0].trigger).toBe("api");
  expect(JSON.stringify(logs)).not.toContain("预算金额");
  store.close();
});

test("source run rejects unknown source, local paths, and blocked hosts", async () => {
  const { app, store, headers } = await authedApp("admin", {
    fetchHtml: async (url) => ({
      ok: false,
      code: "blocked_host",
      message: "blocked_host",
      sourceUrl: url,
    }),
  });

  const unknown = await app.request("/api/sources/not-a-source/run", { method: "POST", headers });
  expect(unknown.status).toBe(404);

  const local = await app.request("/api/sources/ccgp/run", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ url: "./tests/fixtures/tenders/ccgp-legal-counsel.html" }),
  });
  expect(local.status).toBe(400);

  const blocked = await app.request("/api/sources/ccgp/run", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://wenshu.court.gov.cn/website/wenshu/181107ANFZ0BXSK4/index.html",
    }),
  });
  const blockedBody = await blocked.json();
  expect(blocked.status).toBe(200);
  expect(blockedBody.run.status).toBe("error");
  expect(blockedBody.run.error).toBe("blocked_host");
  expect(store.count()).toBe(0);

  const missingSeed = await app.request("/api/sources/spc-guiding/run", { method: "POST", headers });
  const missingBody = await missingSeed.json();
  expect(missingBody.run.status).toBe("error");
  expect(missingBody.run.error).toBe("blocked_host");
  expect(store.count()).toBe(0);
  store.close();
});

test("subscription endpoints are retired", async () => {
  const { app, headers } = await authedApp("admin");
  const listed = await app.request("/api/subscriptions", { headers });
  const created = await app.request("/api/subscriptions", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ type: "tender", region: "北京" }),
  });
  expect(listed.status).toBe(410);
  expect(created.status).toBe(410);
});
