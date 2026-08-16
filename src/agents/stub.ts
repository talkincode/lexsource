import type { CompleteFn } from "./llm";
import { newToolCall } from "./runtime";

const LEGAL_HINT =
  /法律顾问|常年法律|律师事务所|专项法律|诉讼代理|指导性案例|裁判要旨|独立保函|legal counsel|law firm/i;

export function createDeterministicCollector(): CompleteFn {
  const pending: string[] = [];
  const fetched = new Set<string>();

  return async (request) => {
    const user = request.messages.find((message) => message.role === "user")?.content ?? "";
    const lastTool = [...request.messages].reverse().find((message) => message.role === "tool");
    const lastPayload = lastTool ? parseJson(lastTool.content) : null;
    const lastName = lastTool && "name" in lastTool ? lastTool.name : lastToolName(request, lastTool?.tool_call_id);

    if (user.includes("已缓存页面")) {
      if (!lastTool) {
        const url = user.match(/已缓存页面\s+(\S+)/)?.[1] ?? "";
        if (LEGAL_HINT.test(user)) {
          return calls(newToolCall("save_intel", { url, reason: "正文属于法律服务或权威案例。" }));
        }
        return calls(newToolCall("skip", { url, reason: "正文不是法律服务。" }));
      }
      return calls(newToolCall("finish", { summary: "primed page handled" }));
    }

    if (!lastTool) {
      pending.length = 0;
      fetched.clear();
      const focus = user.match(/优先处理这个入口：(\S+)/)?.[1];
      if (focus) return calls(newToolCall("fetch_url", { url: focus }));
      return calls(newToolCall("list_channels", {}));
    }

    if (lastName === "list_channels") {
      const channels = Array.isArray(lastPayload?.channels) ? lastPayload.channels : [];
      const wantCase = /案件采集|\(case\)/.test(user);
      const typed = (channels as Array<{ id?: string; kind?: string; seedUrls?: string[] }>).filter((channel) =>
        wantCase ? channel.kind === "major_case" : channel.kind === "tender",
      );
      const first = typed[0] ?? (channels[0] as { id?: string; seedUrls?: string[] } | undefined);
      const url = first?.seedUrls?.[0];
      if (!url) return calls(newToolCall("finish", { summary: "no seeds" }));
      return calls(newToolCall("fetch_url", { url, channelId: first?.id }));
    }

    if (lastName === "fetch_url") {
      const url = String(lastPayload?.url ?? "");
      if (url) fetched.add(url);
      if (!lastPayload?.ok) {
        const nextFailed = pending.shift();
        if (nextFailed) return calls(newToolCall("fetch_url", { url: nextFailed }));
        return calls(newToolCall("finish", { summary: "fetch failed" }));
      }
      if (Number(lastPayload.linkCount) > 0) {
        return calls(newToolCall("extract_links", { url }));
      }
      const hay = `${lastPayload.title ?? ""}\n${lastPayload.excerpt ?? ""}`;
      if (LEGAL_HINT.test(hay)) {
        return calls(newToolCall("save_intel", { url, reason: "正文属于法律服务或权威案例。" }));
      }
      return calls(newToolCall("skip", { url, reason: "正文不是法律服务。" }));
    }

    if (lastName === "extract_links") {
      const links = Array.isArray(lastPayload?.links) ? lastPayload.links : [];
      for (const link of links as Array<{ url?: string }>) {
        if (link.url && !fetched.has(link.url) && !pending.includes(link.url)) pending.push(link.url);
      }
      const next = pending.shift();
      if (!next) return calls(newToolCall("finish", { summary: "no links" }));
      return calls(newToolCall("fetch_url", { url: next }));
    }

    if (lastName === "save_intel" || lastName === "skip") {
      const next = pending.shift();
      if (!next) return calls(newToolCall("finish", { summary: "done" }));
      return calls(newToolCall("fetch_url", { url: next }));
    }

    return calls(newToolCall("finish", { summary: "stop" }));
  };
}

function calls(call: ReturnType<typeof newToolCall>) {
  return { tool_calls: [call] };
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function lastToolName(
  request: { messages: Array<{ role: string; tool_calls?: Array<{ id: string; function: { name: string } }> }> },
  toolCallId?: string,
) {
  if (!toolCallId) return undefined;
  for (const message of request.messages) {
    if (message.role !== "assistant" || !message.tool_calls) continue;
    const found = message.tool_calls.find((call) => call.id === toolCallId);
    if (found) return found.function.name;
  }
  return undefined;
}
