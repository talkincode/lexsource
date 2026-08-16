import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { IntelItem } from "../domain/intel";
import { ingestDocument, type IngestResult } from "./ingest";
import { getSource } from "../sources/registry";
import { createHttpClient, isBlockedHost } from "../sources/http";
import type { FetchHtml } from "../sources/types";
import type { IngestRun, IngestTrigger, IntelStore } from "../store/db";

const DEFAULT_MAX_ITEMS = 20;
const inflight = new Set<string>();

export type RunSourceInput = {
  store: IntelStore;
  sourceId: string;
  target?: string;
  http?: FetchHtml;
  trigger: IngestTrigger;
  now?: () => Date;
  maxItems?: number;
  onIngested?: (item: IntelItem) => void;
};

export class RunInProgressError extends Error {
  constructor(public readonly sourceId: string) {
    super("run_in_progress");
    this.name = "RunInProgressError";
  }
}

export async function runSourceIngest(input: RunSourceInput): Promise<IngestRun> {
  const { store, sourceId, trigger } = input;
  const now = input.now ?? (() => new Date());
  const maxItems = input.maxItems ?? Number(process.env.LEXSOURCE_FETCH_MAX ?? DEFAULT_MAX_ITEMS);

  if (inflight.has(sourceId)) throw new RunInProgressError(sourceId);
  inflight.add(sourceId);

  const started = now();
  const startedAt = started.toISOString();
  let run = store.startIngestRun({ sourceId, trigger, startedAt });

  try {
    const source = getSource(sourceId);
    const target = input.target?.trim() || source.seedUrl;
    if (!target) {
      return finish(store, run, started, {
        status: "error",
        failed: 1,
        error: "seed_url_required",
      }, now);
    }

    if (isLocalHtmlTarget(target)) {
      const html = await Bun.file(localPath(target)).text();
      const sourceUrl = sourceUrlFromHtml(html) ?? pathToFileURL(resolve(localPath(target))).href;
      const result = ingestDocument(store, { sourceId, sourceUrl, html }, now(), input.onIngested);
      return finish(store, run, started, countsFromResults([result]), now);
    }

    const http = input.http ?? createHttpClient();
    const fetched = await http(target);
    if (!fetched.ok) {
      return finish(store, run, started, {
        status: "error",
        failed: 1,
        error: fetched.code,
      }, now);
    }

    const discovered = (source.discover?.(fetched.html, fetched.sourceUrl) ?? [])
      .filter((url) => url !== fetched.sourceUrl && !isBlockedHost(url))
      .slice(0, Math.max(1, maxItems));

    const results: IngestResult[] = [];
    if (discovered.length === 0) {
      results.push(
        ingestDocument(
          store,
          { sourceId, sourceUrl: fetched.sourceUrl, html: fetched.html },
          now(),
          input.onIngested,
        ),
      );
    } else {
      for (const detailUrl of discovered) {
        const page = await http(detailUrl);
        if (!page.ok) {
          results.push({ ok: false, stage: "parse", error: page.code });
          continue;
        }
        results.push(
          ingestDocument(
            store,
            { sourceId, sourceUrl: page.sourceUrl, html: page.html },
            now(),
            input.onIngested,
          ),
        );
      }
    }

    return finish(store, run, started, countsFromResults(results), now);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    const code = message.startsWith("Unknown source") ? "unknown_source" : "run_failed";
    return finish(store, run, started, { status: "error", failed: 1, error: code }, now);
  } finally {
    inflight.delete(sourceId);
  }
}

export function isLocalHtmlTarget(target: string): boolean {
  return !/^https?:\/\//i.test(target);
}

export function resetInflightForTests(): void {
  inflight.clear();
}

function localPath(target: string): string {
  if (target.startsWith("file:")) return new URL(target).pathname;
  return target;
}

function sourceUrlFromHtml(html: string): string | undefined {
  return html.match(/data-source-url="([^"]+)"/)?.[1];
}

function countsFromResults(results: IngestResult[]): {
  discovered: number;
  succeeded: number;
  failed: number;
  status: IngestRun["status"];
  error: string | null;
} {
  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;
  const codes = [
    ...new Set(
      results.flatMap((result) => {
        if (result.ok) return [];
        if ("stage" in result) return [result.stage];
        return ["error"];
      }),
    ),
  ];
  return {
    discovered: results.length,
    succeeded,
    failed,
    status: failed === 0 ? "ok" : succeeded === 0 ? "error" : "partial",
    error: codes.length ? codes.join(",") : null,
  };
}

function finish(
  store: IntelStore,
  run: IngestRun,
  started: Date,
  patch: Partial<Pick<IngestRun, "status" | "discovered" | "succeeded" | "failed" | "error">>,
  now: () => Date,
): IngestRun {
  const finishedMs = Math.max(now().getTime(), started.getTime());
  const finishedAt = new Date(finishedMs).toISOString();
  return store.finishIngestRun(run.id, {
    finishedAt,
    durationMs: Math.max(0, finishedMs - started.getTime()),
    status: patch.status ?? "error",
    discovered: patch.discovered ?? 0,
    succeeded: patch.succeeded ?? 0,
    failed: patch.failed ?? 0,
    error: patch.error ?? null,
  });
}
