import type { AgentId } from "./catalog";
import { getAgent } from "./catalog";
import { azureChatCompletion } from "./azure";
import { loadAzureOpenAIConfig } from "./azure";
import type { CompleteFn, ChatRequest, ChatResponse, ToolCall } from "./llm";
import { channelBrief, policyFor } from "./policy";
import { COLLECTION_TOOLS, executeTool, type AgentSession, type CachedPage } from "./tools";
import { mcpServersFromEnv, openMcpSession, type McpSession } from "./mcp";
import { excerpt } from "../sources/page";
import { createHttpClient } from "../sources/http";
import type { FetchHtml } from "../sources/types";
import type { IngestRun, IngestTrigger, IntelStore } from "../store/db";

export type RunAgentInput = {
  store: IntelStore;
  agentId: AgentId;
  http?: FetchHtml;
  complete?: CompleteFn | null;
  trigger: IngestTrigger;
  now?: () => Date;
  maxItems?: number;
  maxSteps?: number;
  focusUrl?: string;
  focusChannelId?: string;
  allowLocalFiles?: boolean;
  primed?: CachedPage;
};

const DEFAULT_MAX_STEPS = 24;
const inflight = new Set<string>();

export class RunInProgressError extends Error {
  constructor(public readonly sourceId: string) {
    super("run_in_progress");
    this.name = "RunInProgressError";
  }
}

export function resetInflightForTests(): void {
  inflight.clear();
}

export function isLockInflight(lock: string): boolean {
  return inflight.has(lock);
}

export function listInflightLocks(): string[] {
  return [...inflight];
}

export async function runCollectionAgent(input: RunAgentInput): Promise<IngestRun> {
  const agent = getAgent(input.agentId);
  if (!agent) throw new Error(`unknown_agent:${input.agentId}`);
  const now = input.now ?? (() => new Date());
  const lock = input.focusChannelId ?? input.agentId;
  if (inflight.has(lock)) throw new RunInProgressError(lock);
  inflight.add(lock);

  const started = now();
  const sourceId = input.focusChannelId ?? input.agentId;
  let run = input.store.startIngestRun({ sourceId, trigger: input.trigger, startedAt: started.toISOString() });
  let mcp: McpSession | null = null;
  let seq = 0;
  const record = (
    kind: "thought" | "action" | "observation" | "error",
    extra: { tool?: string | null; input?: unknown; output?: unknown } = {},
  ) => {
    seq += 1;
    input.store.appendIngestRunStep({
      runId: run.id,
      seq,
      kind,
      tool: extra.tool ?? null,
      input: compactJson(extra.input),
      output: compactJson(extra.output),
      at: now().toISOString(),
    });
  };

  try {
    const complete = input.complete === undefined ? createAzureComplete() : input.complete;
    if (!complete) {
      record("error", { output: { error: "azure_openai_unconfigured" } });
      return finish(input.store, run, started, {
        status: "error",
        failed: 1,
        error: "azure_openai_unconfigured",
      }, now);
    }

    const session: AgentSession = {
      store: input.store,
      http: input.http ?? createHttpClient(),
      now,
      allowLocalFiles: input.allowLocalFiles ?? false,
      maxItems: input.maxItems ?? Number(process.env.LEXSOURCE_FETCH_MAX ?? 20),
      pages: new Map(),
      saved: [],
      skipped: [],
      failed: [],
      finished: false,
      defaultChannelId: input.focusChannelId,
    };
    if (input.primed) {
      session.pages.set(input.primed.url, input.primed);
    }

    try {
      const specs = mcpServersFromEnv();
      if (specs.length) mcp = await openMcpSession(specs);
    } catch (error) {
      record("error", {
        output: { error: "mcp_unavailable", detail: error instanceof Error ? error.message : "mcp" },
      });
    }
    const tools = mcp?.tools.length ? [...COLLECTION_TOOLS, ...mcp.tools] : COLLECTION_TOOLS;

    const userTask = [
      `本轮 Agent：${agent.name} (${agent.id})`,
      `渠道：\n${channelBrief(agent.id, input.store)}`,
      mcp?.tools.length ? `已连接 MCP 工具：${mcp.tools.map((tool) => tool.function.name).join(", ")}` : null,
      input.focusUrl ? `优先处理这个入口：${input.focusUrl}` : "从渠道种子开始采集。",
      input.focusChannelId ? `本轮只操作渠道 ${input.focusChannelId}。` : null,
      input.primed
        ? `已缓存页面 ${input.primed.url}\n标题：${input.primed.title}\n摘录：${excerpt(input.primed.text)}\n请 save_intel 或 skip，然后 finish。`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const messages: ChatRequest["messages"] = [
      { role: "system", content: policyFor(agent.id) },
      { role: "user", content: userTask },
    ];

    const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
    let steps = 0;
    while (steps < maxSteps && !session.finished) {
      steps += 1;
      const response = await complete({
        messages,
        tools,
        model: "agent",
      });
      if (response.content?.trim()) {
        record("thought", { output: { text: response.content.trim() } });
      }
      if (!response.tool_calls?.length) {
        session.finished = true;
        break;
      }
      messages.push({
        role: "assistant",
        content: response.content ?? "",
        tool_calls: response.tool_calls,
      });
      for (const call of response.tool_calls) {
        const args = parseArgs(call.function.arguments);
        record("action", { tool: call.function.name, input: args });
        const result =
          mcp?.has(call.function.name)
            ? await mcp.call(call.function.name, args)
            : await executeTool(session, call.function.name, args);
        record("observation", { tool: call.function.name, output: result });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result),
        });
      }
    }

    const succeeded = session.saved.length;
    const skipped = session.skipped.length;
    const failed = session.failed.length;
    const discovered = Math.max(session.pages.size, succeeded + skipped + failed);
    const status =
      failed === 0 && succeeded + skipped > 0
        ? "ok"
        : succeeded === 0 && skipped === 0
          ? "error"
          : succeeded > 0 || skipped > 0
            ? failed === 0
              ? "ok"
              : "partial"
            : "error";

    return finish(input.store, run, started, {
      status: failed > 0 && succeeded === 0 && skipped === 0 ? "error" : status,
      discovered,
      succeeded,
      skipped,
      failed,
      error: session.failed[0]?.error ?? (succeeded + skipped === 0 && !session.finished ? "agent_no_result" : null),
    }, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    record("error", { output: { error: message } });
    return finish(input.store, run, started, { status: "error", failed: 1, error: message }, now);
  } finally {
    await mcp?.close().catch(() => undefined);
    inflight.delete(lock);
  }
}

export function createAzureComplete(
  env: Record<string, string | undefined> = process.env,
): CompleteFn | null {
  const config = loadAzureOpenAIConfig(env);
  if (!config) return null;
  return async (request: ChatRequest): Promise<ChatResponse> => {
    return azureChatCompletion(config, request.messages, request.tools);
  };
}

function compactJson(value: unknown, max = 1600): unknown {
  if (value == null) return null;
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (raw.length <= max) return value;
  if (typeof value === "string") return `${value.slice(0, max)}…`;
  return { truncated: true, preview: `${raw.slice(0, max)}…` };
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function finish(
  store: IntelStore,
  run: IngestRun,
  started: Date,
  patch: Partial<Pick<IngestRun, "status" | "discovered" | "succeeded" | "skipped" | "failed" | "error">>,
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
    skipped: patch.skipped ?? 0,
    failed: patch.failed ?? 0,
    error: patch.error ?? null,
  });
}

export function newToolCall(name: string, args: Record<string, unknown>, id?: string): ToolCall {
  return {
    id: id ?? `call_${name}_${crypto.randomUUID().slice(0, 8)}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}
