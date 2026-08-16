import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/api/app";
import { createFileSink, createMemorySink, createWebhookSink, defaultSink } from "../src/notify/deliver";
import { ingestDocument } from "../src/pipeline/ingest";
import { notifySubscriptions } from "../src/pipeline/notify";
import { IntelStore } from "../src/store/db";

const at = new Date("2026-08-16T08:00:00.000Z");

async function fixture(name: string) {
  return Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();
}

test("subscription happy path: create, ingest biddable tender, deliver, preview", async () => {
  const store = new IntelStore(":memory:");
  const sink = createMemorySink();
  const app = createApp({ store, now: () => at, deliver: sink });

  const created = await app.request("/api/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "北京常年顾问",
      type: "tender",
      region: "北京",
      serviceType: "general_counsel",
      budgetMin: 100000,
      budgetMax: 2_000_000,
    }),
  });
  expect(created.status).toBe(201);
  const { subscription } = await created.json();

  const html = await fixture("tenders/ccgp-legal-counsel.html");
  const ingested = await app.request("/api/intel/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceId: "ccgp",
      sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
      html,
    }),
  });
  expect(ingested.status).toBe(201);
  const saved = await ingested.json();

  expect(sink.events).toHaveLength(1);
  expect(sink.events[0]?.subscriptionId).toBe(subscription.id);
  expect(sink.events[0]?.itemId).toBe(saved.item.id);
  expect(sink.events[0]?.sourceUrl).toContain("ccgp.gov.cn");
  expect(JSON.stringify(sink.events)).not.toContain("预算金额");

  const preview = await (await app.request(`/api/subscriptions/${subscription.id}/preview`, { method: "POST" })).json();
  expect(preview.items).toHaveLength(1);
  expect(preview.items[0].id).toBe(saved.item.id);
  expect(preview.withheld).toEqual([]);

  const listed = await (await app.request("/api/subscriptions")).json();
  expect(listed.subscriptions).toHaveLength(1);
  store.close();
});

test("expired tender is stored but not delivered", async () => {
  const store = new IntelStore(":memory:");
  const sink = createMemorySink();
  const app = createApp({ store, now: () => at, deliver: sink });

  await app.request("/api/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "浙江专项", type: "tender", region: "浙江" }),
  });

  const html = await fixture("tenders/ggzy-expired.html");
  const ingested = await app.request("/api/intel/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceId: "ggzy",
      sourceUrl: "https://www.ggzy.gov.cn/deal/202601/expired-legal.htm",
      html,
    }),
  });
  expect(ingested.status).toBe(201);
  const saved = await ingested.json();
  expect(saved.item.biddable).toBe(false);
  expect(store.count()).toBe(1);
  expect(sink.events).toEqual([]);

  const subs = await (await app.request("/api/subscriptions")).json();
  const preview = await (
    await app.request(`/api/subscriptions/${subs.subscriptions[0].id}/preview`, { method: "POST" })
  ).json();
  expect(preview.items).toEqual([]);
  expect(preview.withheld).toEqual([
    { id: saved.item.id, title: saved.item.title, reason: "not_biddable" },
  ]);
  store.close();
});

test("subscription APIs have no auth until login exists", async () => {
  const store = new IntelStore(":memory:");
  const app = createApp({ store, now: () => at });
  const listed = await app.request("/api/subscriptions");
  const created = await app.request("/api/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "major_case", region: "全国" }),
  });
  expect(listed.status).toBe(200);
  expect(created.status).toBe(201);
  expect(listed.headers.get("www-authenticate")).toBeNull();
  store.close();
});

test("invalid subscription is rejected and not persisted", async () => {
  const store = new IntelStore(":memory:");
  const app = createApp({ store, now: () => at });
  const missingType = await app.request("/api/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "坏规则", region: "北京" }),
  });
  const badRange = await app.request("/api/subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "tender", budgetMin: 200, budgetMax: 100 }),
  });
  expect(missingType.status).toBe(400);
  expect(badRange.status).toBe(400);
  expect(store.listSubscriptions()).toEqual([]);
  store.close();
});

test("failed delivery is not recorded and can retry", async () => {
  const store = new IntelStore(":memory:");
  const html = await fixture("tenders/ccgp-legal-counsel.html");
  const sub = store.createSubscription(
    { name: "北京", type: "tender", region: "北京", serviceType: "general_counsel" },
    at,
  );
  const item = ingestDocument(
    store,
    {
      sourceId: "ccgp",
      sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
      html,
    },
    at,
  );
  expect(item.ok).toBe(true);
  if (!item.ok) return;

  const first = notifySubscriptions({
    store,
    item: item.item,
    now: () => at,
    sink: {
      deliver() {
        throw new Error("sink_down");
      },
    },
  });
  expect(first).toEqual([]);
  expect(store.hasDelivery(sub.id, item.item.id)).toBe(false);

  const sink = createMemorySink();
  const second = notifySubscriptions({ store, item: item.item, sink, now: () => at });
  expect(second).toHaveLength(1);
  expect(store.hasDelivery(sub.id, item.item.id)).toBe(true);

  const third = notifySubscriptions({ store, item: item.item, sink, now: () => at });
  expect(third).toEqual([]);
  expect(sink.events).toHaveLength(1);
  store.close();
});

test("file sink writes jsonl outbox and webhook env is reserved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lexsource-outbox-"));
  const path = join(dir, "outbox.jsonl");
  const fileSink = createFileSink(path);
  fileSink.deliver({
    subscriptionId: "sub1",
    itemId: "item1",
    type: "tender",
    title: "测试标",
    sourceUrl: "https://www.ccgp.gov.cn/a.htm",
    region: "北京",
    deliveredAt: at.toISOString(),
  });
  const text = await readFile(path, "utf8");
  expect(text).toContain("item1");
  expect(text).not.toContain("<html");

  const posted: string[] = [];
  const webhook = createWebhookSink("https://hooks.example.test/lex", async (url, init) => {
    posted.push(`${url}:${init?.body}`);
    return new Response("ok");
  });
  webhook.deliver({
    subscriptionId: "sub1",
    itemId: "item1",
    type: "tender",
    title: "测试标",
    sourceUrl: "https://www.ccgp.gov.cn/a.htm",
    region: "北京",
    deliveredAt: at.toISOString(),
  });
  await Bun.sleep(5);
  expect(posted[0]).toContain("https://hooks.example.test/lex");

  const composed = defaultSink({ LEXSOURCE_OUTBOX: path, LEXSOURCE_WEBHOOK_URL: "https://hooks.example.test/lex" });
  expect(typeof composed.deliver).toBe("function");
  await rm(dir, { recursive: true, force: true });
});

test("subscription update and delete recover from missing ids", async () => {
  const store = new IntelStore(":memory:");
  const app = createApp({ store, now: () => at });
  const created = await (
    await app.request("/api/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "major_case", name: "指导案例" }),
    })
  ).json();
  const updated = await app.request(`/api/subscriptions/${created.subscription.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ region: "全国" }),
  });
  expect(updated.status).toBe(200);
  expect((await updated.json()).subscription.region).toBe("全国");

  const missing = await app.request("/api/subscriptions/does-not-exist", { method: "DELETE" });
  expect(missing.status).toBe(404);
  const deleted = await app.request(`/api/subscriptions/${created.subscription.id}`, { method: "DELETE" });
  expect(deleted.status).toBe(200);
  expect(store.listSubscriptions()).toEqual([]);
  store.close();
});
