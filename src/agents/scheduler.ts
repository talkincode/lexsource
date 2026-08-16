import {
  AGENT_CATALOG,
  calendarDaysBetween,
  parseRunAt,
  shanghaiWallClock,
  type AgentId,
} from "./catalog";
import type { AgentSchedule, IntelStore } from "../store/db";

export type SchedulerOptions = {
  store: IntelStore;
  run: (agentId: AgentId) => Promise<unknown>;
  now?: () => Date;
  enabled?: boolean;
  tickMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export type Scheduler = {
  stop: () => void;
  running: () => boolean;
  tick: () => Promise<AgentId[]>;
};

const DEFAULT_TICK_MS = 30_000;

export function isAgentDue(schedule: AgentSchedule, at: Date): boolean {
  if (!schedule.enabled) return false;
  const runMinutes = parseRunAt(schedule.runAt);
  if (runMinutes == null) return false;
  const now = shanghaiWallClock(at);
  if (now.minutes < runMinutes) return false;
  if (!schedule.lastRunAt) return true;
  const last = shanghaiWallClock(new Date(schedule.lastRunAt));
  return calendarDaysBetween(last.date, now.date) >= schedule.intervalDays;
}

export function startScheduler(options: SchedulerOptions): Scheduler {
  const enabled = options.enabled ?? true;
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const now = options.now ?? (() => new Date());
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  if (!enabled) {
    return {
      stop() {},
      running: () => false,
      async tick() {
        return [];
      },
    };
  }

  let busy = false;
  const timer = setIntervalFn(() => {
    void tick();
  }, tickMs);

  async function tick(): Promise<AgentId[]> {
    if (busy) return [];
    busy = true;
    const ran: AgentId[] = [];
    try {
      const at = now();
      for (const agent of AGENT_CATALOG) {
        const schedule = options.store.getAgentSchedule(agent.id);
        if (!isAgentDue(schedule, at)) continue;
        await options.run(agent.id);
        options.store.touchAgentRun(agent.id, at);
        ran.push(agent.id);
      }
    } finally {
      busy = false;
    }
    return ran;
  }

  void tick();

  return {
    stop() {
      clearIntervalFn(timer);
    },
    running: () => true,
    tick,
  };
}

export function schedulerEnabledFromEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.LEXSOURCE_SCHEDULER_ENABLED !== "0";
}
