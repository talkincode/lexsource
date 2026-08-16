export type AgentId = "tender" | "case";

export type CollectionAgent = {
  id: AgentId;
  name: string;
  kind: "tender" | "major_case";
  channelIds: string[];
};

export const TENDER_AGENT: CollectionAgent = {
  id: "tender",
  name: "招标采集",
  kind: "tender",
  channelIds: ["ccgp", "ggzy"],
};

export const CASE_AGENT: CollectionAgent = {
  id: "case",
  name: "案件采集",
  kind: "major_case",
  channelIds: ["spc-guiding"],
};

export const AGENT_CATALOG: CollectionAgent[] = [TENDER_AGENT, CASE_AGENT];

export const SCHEDULE_TIME_ZONE = "Asia/Shanghai";
export const DEFAULT_INTERVAL_DAYS = 1;
export const DEFAULT_RUN_AT = "08:00";
export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 30;
export const DEFAULT_AGENT_INTERVAL_MS = DEFAULT_INTERVAL_DAYS * 86_400_000;

export function getAgent(id: string): CollectionAgent | undefined {
  return AGENT_CATALOG.find((agent) => agent.id === id);
}

export function defaultAgentSources(): string[] {
  return AGENT_CATALOG.flatMap((agent) => agent.channelIds);
}

export function parseIntervalDays(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return undefined;
  const days = Math.round(n);
  if (days < MIN_INTERVAL_DAYS || days > MAX_INTERVAL_DAYS) return undefined;
  return days;
}

export function parseRunAt(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function shanghaiWallClock(at: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function calendarDaysBetween(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00+08:00`);
  const to = Date.parse(`${toYmd}T00:00:00+08:00`);
  return Math.round((to - from) / 86_400_000);
}
