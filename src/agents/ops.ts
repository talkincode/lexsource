import {
  AGENT_CATALOG,
  calendarDaysBetween,
  getAgent,
  parseRunAt,
  shanghaiWallClock,
  type AgentId,
  type CollectionAgent,
} from "./catalog";
import { COLLECTION_TOOLS } from "./tools";
import { listChannels } from "./channels";
import { loadAzureOpenAIConfig } from "./azure";
import { isLockInflight } from "./runtime";
import { isAgentDue } from "./scheduler";
import type { AgentSchedule, IngestRun, IngestRunStep, IntelStore } from "../store/db";

export const REACT_PATTERN = "react" as const;

export type LlmOps = {
  configured: boolean;
  model: string | null;
  pattern: typeof REACT_PATTERN;
};

export type PipelineOps = {
  pattern: typeof REACT_PATTERN;
  tools: string[];
  stages: Array<{ id: string; name: string; detail: string }>;
  channels: Array<{ id: string; name: string; kind: string; agentId: AgentId; seedUrls: string[] }>;
};

export type AgentOps = CollectionAgent & {
  schedule: AgentSchedule;
  running: boolean;
  blocked: boolean;
  due: boolean;
  nextDueAt: string | null;
  lastRun: IngestRun | null;
  latestStep: IngestRunStep | null;
};

export type DeskOps = {
  llm: LlmOps;
  pipeline: PipelineOps;
  agents: AgentOps[];
};

export function llmOps(
  completeConfigured: boolean,
  env: Record<string, string | undefined> = process.env,
): LlmOps {
  const azure = loadAzureOpenAIConfig(env);
  return {
    configured: completeConfigured,
    model: completeConfigured ? (azure?.model ?? "injected") : null,
    pattern: REACT_PATTERN,
  };
}

export function pipelineOps(store?: IntelStore): PipelineOps {
  return {
    pattern: REACT_PATTERN,
    tools: COLLECTION_TOOLS.map((tool) => tool.function.name),
    stages: [
      { id: "discover", name: "发现", detail: "Agent 用 list_channels / fetch_url / extract_links 打开种子页并挑选详情。" },
      { id: "judge", name: "判定", detail: "Agent 读正文后 save_intel 或 skip。非法律服务不得入库。" },
      { id: "extract", name: "抽取", detail: "入库管道抽出采购人、预算、截止日或案例要旨。" },
      { id: "verify", name: "验证", detail: "schema 与截止日回查。过期或验证失败不可投标。" },
      { id: "store", name: "入库", detail: "保留来源 URL 与原文，律师值班台只看筛过的成品。" },
    ],
    channels: (store?.listCollectionChannels() ?? listChannels()).map((channel) => ({
      id: channel.id,
      name: channel.name,
      kind: channel.kind,
      agentId: channel.agentId,
      seedUrls: channel.seedUrls,
    })),
  };
}

export function isAgentRunning(agent: CollectionAgent, store?: IntelStore): boolean {
  const locks = store ? sourceIdsForAgent(agent.id, store) : [agent.id, ...agent.channelIds];
  return locks.some((lock) => isLockInflight(lock));
}

export function sourceIdsForAgent(agentId: AgentId, store?: IntelStore): string[] {
  const agent = getAgent(agentId);
  const extras = store
    ? store.listCollectionChannels().filter((channel) => channel.agentId === agentId).map((channel) => channel.id)
    : agent?.channelIds ?? [];
  return agent ? [agent.id, ...new Set(extras)] : [agentId];
}

export function lastRunForAgent(store: IntelStore, agentId: AgentId): IngestRun | null {
  const ids = new Set(sourceIdsForAgent(agentId, store));
  return store.listIngestRuns({ limit: 80 }).find((run) => ids.has(run.sourceId)) ?? null;
}

export function nextDueAt(schedule: AgentSchedule, at: Date): string | null {
  if (!schedule.enabled) return null;
  const runMinutes = parseRunAt(schedule.runAt);
  if (runMinutes == null) return null;
  if (isAgentDue(schedule, at)) return at.toISOString();

  const now = shanghaiWallClock(at);
  if (now.minutes < runMinutes) return shanghaiDateTime(now.date, runMinutes);

  const last = schedule.lastRunAt ? shanghaiWallClock(new Date(schedule.lastRunAt)) : now;
  const elapsed = schedule.lastRunAt ? calendarDaysBetween(last.date, now.date) : 0;
  const remain = schedule.lastRunAt ? schedule.intervalDays - elapsed : 1;
  const add = Math.max(1, remain);
  return shanghaiDateTime(addShanghaiDays(now.date, add), runMinutes);
}

export function buildDeskOps(store: IntelStore, completeConfigured: boolean, at = new Date()): DeskOps {
  const llm = llmOps(completeConfigured);
  return {
    llm,
    pipeline: pipelineOps(store),
    agents: AGENT_CATALOG.map((agent) => {
      const schedule = store.getAgentSchedule(agent.id);
      const lastRun = lastRunForAgent(store, agent.id);
      return {
        ...agent,
        schedule,
        running: isAgentRunning(agent, store),
        blocked: !llm.configured,
        due: isAgentDue(schedule, at),
        nextDueAt: nextDueAt(schedule, at),
        lastRun,
        latestStep: lastRun ? store.latestIngestRunStep(lastRun.id) : null,
      };
    }),
  };
}

function shanghaiDateTime(ymd: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return new Date(`${ymd}T${hh}:${mm}:00+08:00`).toISOString();
}

function addShanghaiDays(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00+08:00`) + days * 86_400_000;
  return shanghaiWallClock(new Date(t)).date;
}
