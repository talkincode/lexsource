import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pollerConfigFromEnv, startPoller } from "../src/pipeline/poller";
import { resetInflightForTests, RunInProgressError, runSourceIngest } from "../src/pipeline/run";
import { createHttpClient, recordedFetch } from "../src/sources/http";
import { IntelStore } from "../src/store/db";

const at = new Date("2026-08-16T08:00:00.000Z");

async function recordedCcgp() {
  const list = await Bun.file(new URL("./fixtures/listings/ccgp-list.html", import.meta.url)).text();
  const detail = await Bun.file(new URL("./fixtures/tenders/ccgp-legal-counsel.html", import.meta.url)).text();
  return createHttpClient({
    minIntervalMs: 0,
    fetchImpl: recordedFetch({
      "https://www.ccgp.gov.cn/cggg/zygg/gkzb/": { body: list },
      "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm": { body: detail },
      "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260802_missing.htm": { status: 500, body: "boom" },
    }),
  });
}

test("finishedAt and duration use injected now instead of Date.now", async () => {
  resetInflightForTests();
  const store = new IntelStore(":memory:");
  const file = new URL("./fixtures/tenders/ccgp-legal-counsel.html", import.meta.url).pathname;
  let tick = at.getTime();
  const now = () => {
    tick += 400;
    return new Date(tick);
  };
  const run = await runSourceIngest({
    store,
    sourceId: "ccgp",
    target: file,
    trigger: "cli",
    now,
  });
  expect(run.startedAt).toBe(new Date(at.getTime() + 400).toISOString());
  expect(run.finishedAt).toBe(new Date(tick).toISOString());
  expect(run.durationMs).toBe(Date.parse(run.finishedAt ?? "") - Date.parse(run.startedAt));
  expect(run.durationMs).toBeGreaterThan(0);
  store.close();
});

test("run from local html file writes one item and a run log", async () => {
  resetInflightForTests();
  const store = new IntelStore(":memory:");
  const file = new URL("./fixtures/tenders/ccgp-legal-counsel.html", import.meta.url).pathname;
  const run = await runSourceIngest({
    store,
    sourceId: "ccgp",
    target: file,
    trigger: "cli",
    now: () => at,
  });
  expect(run.status).toBe("ok");
  expect(run.succeeded).toBe(1);
  expect(run.failed).toBe(0);
  expect(run.trigger).toBe("cli");
  expect(store.count()).toBe(1);
  expect(JSON.stringify(run)).not.toContain("预算金额");
  store.close();
});

test("run from recorded listing ingests successes and continues after http failure", async () => {
  resetInflightForTests();
  const store = new IntelStore(":memory:");
  const run = await runSourceIngest({
    store,
    sourceId: "ccgp",
    http: await recordedCcgp(),
    trigger: "api",
    now: () => at,
  });
  expect(run.status).toBe("partial");
  expect(run.discovered).toBe(2);
  expect(run.succeeded).toBe(1);
  expect(run.failed).toBe(1);
  expect(run.error).toBe("parse");
  expect(store.count()).toBe(1);
  expect(store.listIngestRuns({ sourceId: "ccgp" })).toHaveLength(1);
  store.close();
});

test("blocked live url is logged and does not persist", async () => {
  resetInflightForTests();
  const store = new IntelStore(":memory:");
  const run = await runSourceIngest({
    store,
    sourceId: "ccgp",
    target: "https://wenshu.court.gov.cn/website/wenshu/181107ANFZ0BXSK4/index.html",
    http: createHttpClient({
      minIntervalMs: 0,
      fetchImpl: recordedFetch({}),
    }),
    trigger: "cli",
    now: () => at,
  });
  expect(run.status).toBe("error");
  expect(run.failed).toBe(1);
  expect(run.error).toBe("blocked_host");
  expect(store.count()).toBe(0);
  store.close();
});

test("ggzy recorded listing preserves source html path into the store", async () => {
  resetInflightForTests();
  const store = new IntelStore(":memory:");
  const list = await Bun.file(new URL("./fixtures/listings/ggzy-list.html", import.meta.url)).text();
  const detail = await Bun.file(new URL("./fixtures/tenders/ggzy-expired.html", import.meta.url)).text();
  const run = await runSourceIngest({
    store,
    sourceId: "ggzy",
    http: createHttpClient({
      minIntervalMs: 0,
      fetchImpl: recordedFetch({
        "https://www.ggzy.gov.cn/": { body: list },
        "https://www.ggzy.gov.cn/deal/202601/expired-legal.htm": { body: detail },
      }),
    }),
    trigger: "schedule",
    now: () => at,
  });
  expect(run.status).toBe("ok");
  expect(run.succeeded).toBe(1);
  const item = store.list({ sourceId: "ggzy" })[0];
  expect(item?.sourceUrl).toBe("https://www.ggzy.gov.cn/deal/202601/expired-legal.htm");
  expect(item?.type === "tender" && item.biddable).toBe(false);
  store.close();
});

test("spc-guiding without a url fails closed", async () => {
  resetInflightForTests();
  const store = new IntelStore(":memory:");
  const run = await runSourceIngest({
    store,
    sourceId: "spc-guiding",
    trigger: "api",
    now: () => at,
  });
  expect(run.status).toBe("error");
  expect(run.error).toBe("seed_url_required");
  expect(store.count()).toBe(0);
  store.close();
});

test("overlapping runs for the same source are rejected", async () => {
  resetInflightForTests();
  const store = new IntelStore(":memory:");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = runSourceIngest({
    store,
    sourceId: "ccgp",
    target: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
    trigger: "api",
    now: () => at,
    http: async () => {
      await gate;
      return {
        ok: false,
        code: "network",
        message: "network",
        sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
      };
    },
  });
  await Promise.resolve();
  await expect(
    runSourceIngest({
      store,
      sourceId: "ccgp",
      trigger: "api",
      now: () => at,
    }),
  ).rejects.toBeInstanceOf(RunInProgressError);
  release();
  await first;
  store.close();
});

test("poller stays off by default and ticks only when enabled", async () => {
  expect(pollerConfigFromEnv({}).enabled).toBe(false);
  expect(pollerConfigFromEnv({ LEXSOURCE_POLL_ENABLED: "1", LEXSOURCE_POLL_INTERVAL_MS: "120000" })).toMatchObject({
    enabled: true,
    intervalMs: 120000,
    sources: ["ccgp", "ggzy"],
  });

  const offTicks: string[] = [];
  const off = startPoller({
    enabled: false,
    intervalMs: 10,
    run: async (sourceId) => {
      offTicks.push(sourceId);
    },
  });
  expect(off.running()).toBe(false);
  await Bun.sleep(25);
  off.stop();
  expect(offTicks).toEqual([]);

  const ticks: string[] = [];
  const on = startPoller({
    enabled: true,
    intervalMs: 15,
    sources: ["ccgp"],
    run: async (sourceId) => {
      ticks.push(sourceId);
    },
  });
  expect(on.running()).toBe(true);
  await Bun.sleep(40);
  on.stop();
  expect(ticks.length).toBeGreaterThan(0);
  expect(ticks.every((id) => id === "ccgp")).toBe(true);
});

test("cli ingest --url local file exits 0 and writes the db", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lexsource-cli-"));
  const db = join(dir, "lexsource.db");
  const fixture = new URL("./fixtures/tenders/ccgp-legal-counsel.html", import.meta.url).pathname;
  const proc = Bun.spawn({
    cmd: ["bun", "src/cli.ts", "ingest", "--source", "ccgp", "--url", fixture],
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, LEXSOURCE_DB: db },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  expect(exit).toBe(0);
  expect(stdout).toContain('"status":"ok"');
  expect(stdout).toContain('"succeeded":1');
  const store = new IntelStore(db);
  expect(store.count()).toBe(1);
  store.close();
  await rm(dir, { recursive: true, force: true });
});
