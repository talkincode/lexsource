import { expect, test } from "bun:test";
import { AGENT_CATALOG } from "../src/agents/catalog";
import { policyFor } from "../src/agents/policy";
import { schedulerEnabledFromEnv, startScheduler } from "../src/agents/scheduler";
import { COLLECTION_TOOLS } from "../src/agents/tools";
import { runCollectionAgent } from "../src/agents/runtime";
import { ingestDocument } from "../src/pipeline/ingest";
import { resetInflightForTests, runSourceIngest } from "../src/pipeline/run";
import { createHttpClient, recordedFetch } from "../src/sources/http";
import { IntelStore } from "../src/store/db";
import { at, authedApp, createDeterministicCollector, fixture } from "./helpers";

test("collection tools and policy are agent-native, not a per-site crawler", () => {
  const names = COLLECTION_TOOLS.map((tool) => tool.function.name);
  expect(names).toEqual(["list_channels", "fetch_url", "extract_links", "save_intel", "skip", "finish"]);
  expect(policyFor("tender")).toContain("必须通过工具工作");
  expect(policyFor("tender")).toContain("save_intel");
  expect(policyFor("case")).toContain("wenshu.court.gov.cn");
});

test("office supplies never land unless the agent explicitly accepts", async () => {
  const store = new IntelStore(":memory:");
  const html = await fixture("rejected/office-supplies.html");
  const rejected = await ingestDocument(
    store,
    {
      sourceId: "ccgp",
      sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260803_office.htm",
      html,
    },
    at,
    undefined,
    { decision: { accept: false, reason: "办公用品供货，不是法律服务" } },
  );
  expect(rejected.ok).toBe(false);
  if (!rejected.ok) expect(rejected.stage).toBe("relevance");
  expect(store.count()).toBe(0);
  store.close();
});

test("scheduler is on by default and runs tender plus case agents when due", async () => {
  expect(schedulerEnabledFromEnv({})).toBe(true);
  expect(schedulerEnabledFromEnv({ LEXSOURCE_SCHEDULER_ENABLED: "0" })).toBe(false);

  const store = new IntelStore(":memory:");
  const offTicks: string[] = [];
  const off = startScheduler({
    store,
    enabled: false,
    tickMs: 10,
    now: () => at,
    run: async (agentId) => {
      offTicks.push(agentId);
    },
  });
  expect(off.running()).toBe(false);
  await Bun.sleep(25);
  off.stop();
  expect(offTicks).toEqual([]);

  const ticks: string[] = [];
  const on = startScheduler({
    store,
    enabled: true,
    tickMs: 50,
    now: () => at,
    run: async (agentId) => {
      ticks.push(agentId);
    },
  });
  expect(on.running()).toBe(true);
  await Bun.sleep(20);
  on.stop();
  expect(ticks).toEqual(AGENT_CATALOG.map((agent) => agent.id));
  expect(ticks).toContain("case");
  store.close();
});

test("unconfigured model records an error step and does not invent intel", async () => {
  resetInflightForTests();
  const store = new IntelStore(":memory:");
  const run = await runCollectionAgent({
    store,
    agentId: "tender",
    trigger: "api",
    now: () => at,
    complete: null,
  });
  expect(run.status).toBe("error");
  expect(run.error).toBe("azure_openai_unconfigured");
  const steps = store.listIngestRunSteps(run.id);
  expect(steps).toHaveLength(1);
  expect(steps[0]?.kind).toBe("error");
  expect(store.count()).toBe(0);
  store.close();
});

test("admin can run the case agent from a recorded listing", async () => {
  resetInflightForTests();
  const list = await fixture("listings/spc-list.html");
  const detail = await fixture("cases/spc-guiding.html");
  const { app, store, headers } = await authedApp("admin", {
    fetchHtml: async (url) => {
      const http = createHttpClient({
        minIntervalMs: 0,
        fetchImpl: recordedFetch({
          "https://www.court.gov.cn/zixun/gengduo/16.html": { body: list },
          "https://www.court.gov.cn/zixun/xiangqing/20260801.html": { body: detail },
        }),
      });
      return http(url);
    },
  });

  const res = await app.request("/api/agents/case/run", { method: "POST", headers });
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.runs[0].status).toBe("ok");
  expect(body.runs[0].succeeded).toBe(1);
  const steps = store.listIngestRunSteps(body.runs[0].id);
  expect(steps.some((step) => step.kind === "action" && step.tool === "list_channels")).toBe(true);
  expect(steps.some((step) => step.kind === "action" && step.tool === "save_intel")).toBe(true);
  expect(store.desk().cases).toHaveLength(1);
  const brief = store.desk().cases[0];
  expect(brief?.type).toBe("major_case");
  if (brief?.type === "major_case") {
    expect(brief.briefMarkdown).toContain("独立保函");
  }
  store.close();
});

test("tender agent skips non-legal listings and still stores legal counsel", async () => {
  resetInflightForTests();
  const store = new IntelStore(":memory:");
  const list = `<!doctype html><ul>
    <a href="https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm">法律顾问</a>
    <a href="https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260803_office.htm">办公用品</a>
  </ul>`;
  const legal = await fixture("tenders/ccgp-legal-counsel.html");
  const office = await fixture("rejected/office-supplies.html");
  const run = await runSourceIngest({
    store,
    sourceId: "ccgp",
    trigger: "schedule",
    now: () => at,
    complete: createDeterministicCollector(),
    http: createHttpClient({
      minIntervalMs: 0,
      fetchImpl: recordedFetch({
        "https://www.ccgp.gov.cn/cggg/zygg/gkzb/": { body: list },
        "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm": { body: legal },
        "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260803_office.htm": { body: office },
      }),
    }),
  });
  expect(run.status).toBe("ok");
  expect(run.succeeded).toBe(1);
  expect(run.skipped).toBe(1);
  expect(run.failed).toBe(0);
  expect(store.count()).toBe(1);
  expect(store.desk().tenders).toHaveLength(1);
  store.close();
});
