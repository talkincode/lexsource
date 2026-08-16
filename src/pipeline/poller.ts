export type PollerOptions = {
  enabled?: boolean;
  intervalMs?: number;
  sources?: string[];
  run: (sourceId: string) => Promise<unknown>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export type Poller = {
  stop: () => void;
  running: () => boolean;
  sources: string[];
  intervalMs: number;
};

const DEFAULT_SOURCES = ["ccgp", "ggzy"];

export function startPoller(options: PollerOptions): Poller {
  const enabled = options.enabled ?? false;
  const intervalMs = options.intervalMs ?? 3_600_000;
  const sources = options.sources?.length ? options.sources : DEFAULT_SOURCES;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;

  if (!enabled) {
    return {
      stop() {},
      running: () => false,
      sources,
      intervalMs,
    };
  }

  let busy = false;
  const timer = setIntervalFn(() => {
    void tick();
  }, intervalMs);

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const sourceId of sources) {
        await options.run(sourceId);
      }
    } finally {
      busy = false;
    }
  }

  return {
    stop() {
      clearIntervalFn(timer);
    },
    running: () => true,
    sources,
    intervalMs,
  };
}

export function pollerConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): {
  enabled: boolean;
  intervalMs: number;
  sources: string[];
} {
  const sources = (env.LEXSOURCE_POLL_SOURCES ?? DEFAULT_SOURCES.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    enabled: env.LEXSOURCE_POLL_ENABLED === "1",
    intervalMs: Number(env.LEXSOURCE_POLL_INTERVAL_MS ?? 3_600_000),
    sources: sources.length ? sources : DEFAULT_SOURCES,
  };
}
