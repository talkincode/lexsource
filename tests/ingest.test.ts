import { expect, test } from "bun:test";
import { ingestDocument } from "../src/pipeline/ingest";
import { IntelStore } from "../src/store/db";

const at = new Date("2026-08-16T08:00:00.000Z");

test("ingest writes a verified tender and is idempotent", async () => {
  const store = new IntelStore(":memory:");
  const html = await Bun.file(new URL("./fixtures/tenders/ccgp-legal-counsel.html", import.meta.url)).text();
  const input = {
    sourceId: "ccgp",
    sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
    html,
  };
  const first = ingestDocument(store, input, at);
  const second = ingestDocument(store, input, at);
  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
  if (!first.ok || !second.ok) return;
  expect(first.item.id).toBe(second.item.id);
  expect(store.count()).toBe(1);
  store.close();
});

test("hard-failed verify does not persist a row", () => {
  const store = new IntelStore(":memory:");
  const result = ingestDocument(
    store,
    {
      sourceId: "ccgp",
      sourceUrl: "https://wenshu.court.gov.cn/website/wenshu/181107ANFZ0BXSK4/index.html?docId=abc",
      text: "采购人：测试单位\n预算金额：10万元\n投标截止时间：2026年12月1日",
    },
    at,
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.stage).toBe("verify");
  expect(store.count()).toBe(0);
  store.close();
});

test("unknown source fails closed without writing", () => {
  const store = new IntelStore(":memory:");
  const result = ingestDocument(store, {
    sourceId: "not-a-source",
    sourceUrl: "https://example.com/a",
    text: "hello",
  });
  expect(result.ok).toBe(false);
  expect(store.count()).toBe(0);
  store.close();
});
