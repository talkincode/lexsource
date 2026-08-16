import { getChannel } from "../agents/channels";
import { runCollectionAgent, RunInProgressError, resetInflightForTests } from "../agents/runtime";
import type { CompleteFn } from "../agents/llm";
import type { IntelItem } from "../domain/intel";
import type { FetchHtml } from "../sources/types";
import type { IngestRun, IngestTrigger, IntelStore } from "../store/db";

export { RunInProgressError, resetInflightForTests };

export type RunSourceInput = {
  store: IntelStore;
  sourceId: string;
  target?: string;
  http?: FetchHtml;
  trigger: IngestTrigger;
  now?: () => Date;
  maxItems?: number;
  onIngested?: (item: IntelItem) => void;
  complete?: CompleteFn;
};

export async function runSourceIngest(input: RunSourceInput): Promise<IngestRun> {
  const channel = input.store.getCollectionChannel(input.sourceId) ?? getChannel(input.sourceId);
  if (!channel) {
    const now = input.now ?? (() => new Date());
    const started = now();
    const run = input.store.startIngestRun({
      sourceId: input.sourceId,
      trigger: input.trigger,
      startedAt: started.toISOString(),
    });
    return input.store.finishIngestRun(run.id, {
      finishedAt: now().toISOString(),
      durationMs: 0,
      status: "error",
      discovered: 0,
      succeeded: 0,
      skipped: 0,
      failed: 1,
      error: "unknown_source",
    });
  }
  return runCollectionAgent({
    store: input.store,
    agentId: channel.agentId,
    http: input.http,
    complete: input.complete,
    trigger: input.trigger,
    now: input.now,
    maxItems: input.maxItems,
    focusUrl: input.target?.trim() || channel.seedUrls[0],
    focusChannelId: channel.id,
    allowLocalFiles: Boolean(input.target && isLocalHtmlTarget(input.target)),
  });
}

export function isLocalHtmlTarget(target: string): boolean {
  return !/^https?:\/\//i.test(target);
}
