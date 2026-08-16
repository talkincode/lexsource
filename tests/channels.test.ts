import { expect, test } from "bun:test";
import { mcpServersFromEnv, openMcpSession } from "../src/agents/mcp";
import { IntelStore } from "../src/store/db";
import { at, authedApp } from "./helpers";

test("admin can add a channel and cookie is write-only", async () => {
  const { app, store, headers } = await authedApp("admin");
  const created = await app.request("/api/channels", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      id: "jiangsu",
      name: "江苏政府采购网",
      kind: "tender",
      seedUrls: ["https://www.ccgp-jiangsu.gov.cn/"],
      hints: "省网",
    }),
  });
  expect(created.status).toBe(201);
  const cookie = await app.request("/api/channels/jiangsu/cookie", {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ cookie: "sid=secret-cookie-value" }),
  });
  expect(cookie.status).toBe(200);
  const listed = await (await app.request("/api/channels", { headers })).json();
  const dumped = JSON.stringify(listed);
  expect(dumped).not.toContain("secret-cookie-value");
  const row = listed.channels.find((channel: { id: string }) => channel.id === "jiangsu");
  expect(row.hasCookie).toBe(true);
  expect(store.cookieForUrl("https://www.ccgp-jiangsu.gov.cn/notice/1.htm")).toBe("sid=secret-cookie-value");

  const lawyer = await authedApp("lawyer", { store });
  const forbidden = await lawyer.app.request("/api/channels", { headers: lawyer.headers });
  expect(forbidden.status).toBe(403);
  store.close();
});

test("builtin channels cannot be deleted", async () => {
  const { app, headers, store } = await authedApp("admin");
  const res = await app.request("/api/channels/ccgp", { method: "DELETE", headers });
  expect(res.status).toBe(400);
  store.close();
});

test("MCP env can enable Playwright and a mock server exposes tools", async () => {
  expect(mcpServersFromEnv({ LEXSOURCE_MCP_PLAYWRIGHT: "1" })).toEqual([
    { id: "playwright", command: "npx", args: ["-y", "@playwright/mcp@latest"] },
  ]);
  const echo = new URL("./fixtures/mcp-echo.ts", import.meta.url).pathname;
  const session = await openMcpSession([{ id: "playwright", command: process.execPath, args: [echo] }]);
  expect(session.has("browser_navigate")).toBe(true);
  const result = await session.call("browser_navigate", { url: "https://wenshu.court.gov.cn/" });
  expect(JSON.stringify(result)).toContain("wenshu.court.gov.cn");
  await session.close();
});

test("purgeIntel removes intel only", async () => {
  const store = new IntelStore(":memory:");
  await store.createUser({ username: "admin", password: "admin-pass", role: "admin" }, at);
  store.upsert({
    type: "tender",
    id: "abc123456789",
    sourceId: "ccgp",
    sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
    title: "法律顾问采购",
    publishedAt: at.toISOString(),
    ingestedAt: at.toISOString(),
    region: "北京",
    rawText: "采购人：某局 预算金额：10万元 投标截止时间：2026年12月1日 法律顾问",
    confidence: 0.8,
    verification: { status: "verified", checks: [] },
    purchaser: "某局",
    projectName: "法律顾问采购",
    budget: 100000,
    budgetText: "10万元",
    serviceType: "general_counsel",
    qualification: "律师事务所",
    deadlineAt: "2026-12-01T09:00:00.000Z",
    bidOpenAt: null,
    contact: null,
    biddable: true,
    suggestions: [],
  });
  expect(store.count()).toBe(1);
  expect(store.purgeIntel()).toBe(1);
  expect(store.count()).toBe(0);
  expect(store.userCount()).toBe(1);
  store.close();
});
