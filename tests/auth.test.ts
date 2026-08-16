import { expect, test } from "bun:test";
import { ensureBootstrapUsers } from "../src/auth/bootstrap";
import { createApp } from "../src/api/app";
import { IntelStore } from "../src/store/db";
import { at, authedApp, cookieHeader, login, seedUsers } from "./helpers";

test("unauthenticated visitors get a login page and cannot read intel", async () => {
  const store = new IntelStore(":memory:");
  const app = createApp({ store, now: () => at });
  const page = await app.request("/");
  const html = await page.text();
  expect(page.status).toBe(200);
  expect(html).toContain("进入情报台");
  expect(html).toContain("/api/auth/login");
  expect(html).not.toContain("创建订阅");
  expect(html).not.toContain("现在还能投");

  const intel = await app.request("/api/intel");
  expect(intel.status).toBe(401);
  expect((await intel.json()).error).toBe("unauthorized");

  const desk = await app.request("/api/desk");
  expect(desk.status).toBe(401);

  const health = await (await app.request("/api/health")).json();
  expect(health.ok).toBe(true);
  expect(health.items).toBeUndefined();
  store.close();
});

test("failed login does not create a session", async () => {
  const store = new IntelStore(":memory:");
  await seedUsers(store);
  const app = createApp({ store, now: () => at });
  const bad = await login(app, "admin", "wrong-password");
  expect(bad.res.status).toBe(401);
  expect(bad.cookie).toBe("");
  expect(cookieHeader(bad.res.headers.get("set-cookie"))).toBe("");

  const intel = await app.request("/api/intel");
  expect(intel.status).toBe(401);
  store.close();
});

test("admin and lawyer can log in; lawyer cannot change collection", async () => {
  const admin = await authedApp("admin");
  expect(admin.login.status).toBe(200);
  const me = await (await admin.app.request("/api/auth/me", { headers: admin.headers })).json();
  expect(me.user.role).toBe("admin");
  expect(me.user.username).toBe("admin");

  const lawyer = await authedApp("lawyer", { store: admin.store });
  const run = await lawyer.app.request("/api/agents/tender/run", {
    method: "POST",
    headers: lawyer.headers,
  });
  const schedule = await lawyer.app.request("/api/agents/tender/schedule", {
    method: "PUT",
    headers: { ...lawyer.headers, "content-type": "application/json" },
    body: JSON.stringify({ intervalDays: 2, runAt: "09:30" }),
  });
  const ingest = await lawyer.app.request("/api/intel/ingest", {
    method: "POST",
    headers: { ...lawyer.headers, "content-type": "application/json" },
    body: JSON.stringify({
      sourceId: "ccgp",
      sourceUrl: "https://www.ccgp.gov.cn/example.htm",
      text: "项目名称：测试\n采购人：测试单位\n预算金额：10万元\n投标截止时间：2026年12月31日",
    }),
  });
  expect(run.status).toBe(403);
  expect(schedule.status).toBe(403);
  expect(ingest.status).toBe(403);
  expect(admin.store.getAgentSchedule("tender").intervalDays).toBe(1);
  expect(admin.store.count()).toBe(0);

  const desk = await lawyer.app.request("/api/desk", { headers: lawyer.headers });
  expect(desk.status).toBe(200);
  admin.store.close();
});

test("invalid schedule is rejected and the previous interval remains", async () => {
  const { app, store, headers } = await authedApp("admin");
  const before = store.getAgentSchedule("tender");
  const res = await app.request("/api/agents/tender/schedule", {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ intervalDays: 0, runAt: "99:99" }),
  });
  expect(res.status).toBe(400);
  expect(store.getAgentSchedule("tender").intervalDays).toBe(before.intervalDays);
  store.close();
});

test("bootstrap creates admin and lawyer only when passwords are provided", async () => {
  const store = new IntelStore(":memory:");
  const empty = await ensureBootstrapUsers(store, {}, at);
  expect(empty.created).toEqual([]);
  expect(store.userCount()).toBe(0);

  const seeded = await ensureBootstrapUsers(
    store,
    {
      LEXSOURCE_ADMIN_PASSWORD: "admin-pass",
      LEXSOURCE_LAWYER_PASSWORD: "lawyer-pass",
    },
    at,
  );
  expect(seeded.created).toEqual(["admin", "lawyer"]);
  expect(store.userCount()).toBe(2);
  const again = await ensureBootstrapUsers(
    store,
    { LEXSOURCE_ADMIN_PASSWORD: "admin-pass", LEXSOURCE_LAWYER_PASSWORD: "lawyer-pass" },
    at,
  );
  expect(again.created).toEqual([]);
  store.close();
});
