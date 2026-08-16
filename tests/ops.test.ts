import { expect, test } from "bun:test";
import { AGENT_CATALOG } from "../src/agents/catalog";
import { buildDeskOps, nextDueAt, pipelineOps } from "../src/agents/ops";
import { resetInflightForTests } from "../src/agents/runtime";
import { IntelStore } from "../src/store/db";
import { at, authedApp, createDeterministicCollector } from "./helpers";

test("pipeline ops names the ReAct tools and collection stages", () => {
  const pipeline = pipelineOps();
  expect(pipeline.pattern).toBe("react");
  expect(pipeline.tools).toEqual(["list_channels", "fetch_url", "extract_links", "save_intel", "skip", "finish"]);
  expect(pipeline.stages.map((stage) => stage.id)).toEqual([
    "discover",
    "judge",
    "extract",
    "verify",
    "store",
  ]);
  expect(pipeline.channels.map((channel) => channel.id)).toEqual(["ccgp", "ggzy", "spc-guiding"]);
});

test("next due is immediate when the agent has never run past the wall clock", () => {
  const store = new IntelStore(":memory:");
  const schedule = store.getAgentSchedule("tender");
  expect(schedule.lastRunAt).toBeNull();
  expect(nextDueAt(schedule, at)).toBe(at.toISOString());
  store.close();
});

test("paused agents have no next due", () => {
  const store = new IntelStore(":memory:");
  const schedule = store.updateAgentSchedule("tender", { enabled: false }, at);
  expect(nextDueAt(schedule, at)).toBeNull();
  store.close();
});

test("desk ops marks an unconfigured model as blocked", () => {
  const store = new IntelStore(":memory:");
  const ops = buildDeskOps(store, false, at);
  expect(ops.llm.configured).toBe(false);
  expect(ops.llm.pattern).toBe("react");
  expect(ops.agents).toHaveLength(AGENT_CATALOG.length);
  expect(ops.agents.every((agent) => agent.blocked)).toBe(true);
  store.close();
});

test("agent run persists ReAct steps and the run detail API returns them", async () => {
  resetInflightForTests();
  const { app, store, headers } = await authedApp("admin", {
    complete: createDeterministicCollector(),
    fetchHtml: async (url) => ({
      ok: true,
      sourceUrl: url,
      html: `<html><body><a href="https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm">法律顾问</a></body></html>`,
      status: 200,
      fetchedAt: at.toISOString(),
      contentType: "text/html",
    }),
  });
  const res = await app.request("/api/agents/tender/run", { method: "POST", headers });
  const body = await res.json();
  expect(res.status).toBe(200);
  const runId = body.runs[0].id;
  const steps = store.listIngestRunSteps(runId);
  const tools = steps.filter((step) => step.kind === "action").map((step) => step.tool);
  expect(tools[0]).toBe("list_channels");
  expect(tools).toContain("fetch_url");
  expect(tools).toContain("finish");

  const detail = await (await app.request(`/api/ingest-runs/${runId}`, { headers })).json();
  expect(detail.run.id).toBe(runId);
  expect(detail.steps.length).toBeGreaterThan(2);
  expect(detail.steps.some((step: { kind: string }) => step.kind === "observation")).toBe(true);

  const desk = await (await app.request("/api/desk", { headers })).json();
  expect(desk.ops.llm.configured).toBe(true);
  expect(desk.ops.llm.pattern).toBe("react");
  expect(desk.agents.find((agent: { id: string }) => agent.id === "tender")?.lastRun?.id).toBe(runId);
  store.close();
});

test("lawyer can read run traces but cannot start a collection", async () => {
  resetInflightForTests();
  const admin = await authedApp("admin");
  admin.store.startIngestRun({ sourceId: "tender", trigger: "api", startedAt: at.toISOString() });
  const run = admin.store.listIngestRuns()[0];
  admin.store.appendIngestRunStep({
    runId: run.id,
    seq: 1,
    kind: "action",
    tool: "list_channels",
    input: {},
    output: null,
    at: at.toISOString(),
  });
  const lawyer = await authedApp("lawyer", { store: admin.store });
  const detail = await lawyer.app.request(`/api/ingest-runs/${run.id}`, { headers: lawyer.headers });
  expect(detail.status).toBe(200);
  expect((await detail.json()).steps).toHaveLength(1);
  const start = await lawyer.app.request("/api/agents/tender/run", {
    method: "POST",
    headers: lawyer.headers,
  });
  expect(start.status).toBe(403);
  admin.store.close();
});

test("missing run detail is 404", async () => {
  const { app, headers, store } = await authedApp("admin");
  const res = await app.request("/api/ingest-runs/does-not-exist", { headers });
  expect(res.status).toBe(404);
  store.close();
});
