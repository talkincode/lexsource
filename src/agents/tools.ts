import { getChannel } from "./channels";
import type { ToolDef } from "./llm";
import { excerpt, extractLinks, htmlToDocument } from "../sources/page";
import type { FetchHtml } from "../sources/types";
import { ingestDocument } from "../pipeline/ingest";
import type { IntelStore } from "../store/db";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type CachedPage = {
  url: string;
  html: string;
  text: string;
  title: string;
  channelId: string;
};

export type AgentSession = {
  store: IntelStore;
  http: FetchHtml;
  now: () => Date;
  allowLocalFiles: boolean;
  maxItems: number;
  pages: Map<string, CachedPage>;
  saved: string[];
  skipped: Array<{ url?: string; reason: string }>;
  failed: Array<{ url?: string; error: string }>;
  finished: boolean;
  defaultChannelId?: string;
};

export const COLLECTION_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_channels",
      description: "列出本轮可用采集渠道（种子 URL 与操作提示）。增加渠道时只加种子和提示，不会给你单独的解析器。",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "抓取一个 http(s) 页面，带浏览器伪装头；渠道若绑定了 Cookie 会自动带上。返回标题、正文摘录和链接数。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          channelId: { type: "string", description: "渠道 id，如 ccgp / ggzy / spc-guiding" },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_links",
      description: "从已抓取页面中抽出链接和锚文本，供你挑选下一步打开哪些详情。",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "已 fetch 过的页面 URL" } },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_intel",
      description: "在你确认正文属于法律服务招标或所内可用案例后，把该页作为成品入库。必须提供中文理由。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          reason: { type: "string" },
        },
        required: ["url", "reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skip",
      description: "跳过无关或无法判断的页面，并记下原因。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          reason: { type: "string" },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "结束本轮采集。",
      parameters: {
        type: "object",
        properties: { summary: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
];

export async function executeTool(
  session: AgentSession,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "list_channels":
      return {
        channels: session.store.listCollectionChannels().map((channel) => ({
          id: channel.id,
          name: channel.name,
          kind: channel.kind,
          seedUrls: channel.seedUrls,
          hints: channel.hints,
          hasCookie: channel.hasCookie,
        })),
      };
    case "fetch_url":
      return fetchUrl(session, String(args.url ?? ""), typeof args.channelId === "string" ? args.channelId : undefined);
    case "extract_links":
      return linksFrom(session, String(args.url ?? ""));
    case "save_intel":
      return saveIntel(session, String(args.url ?? ""), String(args.reason ?? ""));
    case "skip": {
      const url = typeof args.url === "string" ? args.url : undefined;
      const reason = String(args.reason ?? "skipped");
      session.skipped.push({ url, reason });
      return { skipped: true, url, reason };
    }
    case "finish":
      session.finished = true;
      return { finished: true, summary: typeof args.summary === "string" ? args.summary : "" };
    default:
      return { error: `unknown_tool:${name}` };
  }
}

async function fetchUrl(session: AgentSession, url: string, channelId?: string): Promise<unknown> {
  if (!url) return { ok: false, error: "url_required" };
  const channel =
    session.store.getCollectionChannel(channelId ?? session.defaultChannelId ?? guessChannel(url) ?? "") ??
    getChannel(channelId ?? session.defaultChannelId ?? guessChannel(url) ?? "");
  const sourceId = channel?.id ?? session.defaultChannelId ?? "ccgp";

  if (session.allowLocalFiles && !/^https?:\/\//i.test(url)) {
    const html = await Bun.file(url).text();
    const sourceUrl =
      html.match(/data-source-url="([^"]+)"/)?.[1] ?? pathToFileURL(resolve(url)).href;
    return cachePage(session, sourceId, sourceUrl, html);
  }

  const fetched = await session.http(url);
  if (!fetched.ok) {
    session.failed.push({ url, error: fetched.code });
    return { ok: false, error: fetched.code, url };
  }
  return cachePage(session, sourceId, fetched.sourceUrl, fetched.html);
}

function cachePage(session: AgentSession, sourceId: string, url: string, html: string) {
  const doc = htmlToDocument({ sourceId, sourceUrl: url, html });
  const page: CachedPage = {
    url,
    html,
    text: doc.text,
    title: doc.titleHint ?? doc.text.slice(0, 80),
    channelId: sourceId,
  };
  session.pages.set(url, page);
  const links = extractLinks(html, url);
  return {
    ok: true,
    url,
    title: page.title,
    channelId: sourceId,
    linkCount: links.length,
    excerpt: excerpt(page.text),
  };
}

function linksFrom(session: AgentSession, url: string) {
  const page = session.pages.get(url);
  if (!page) return { ok: false, error: "page_not_fetched", url };
  return { ok: true, url, links: extractLinks(page.html, url) };
}

async function saveIntel(session: AgentSession, url: string, reason: string) {
  if (session.saved.length >= session.maxItems) {
    return { ok: false, error: "max_items", url };
  }
  const page = session.pages.get(url);
  if (!page) return { ok: false, error: "page_not_fetched", url };
  if (!reason.trim()) return { ok: false, error: "reason_required", url };
  const result = await ingestDocument(
    session.store,
    { sourceId: page.channelId, sourceUrl: url, html: page.html, text: page.text },
    session.now(),
    undefined,
    { decision: { accept: true, reason: reason.trim() } },
  );
  if (!result.ok) {
    if (result.stage === "relevance") {
      session.skipped.push({ url, reason: result.error });
      return { ok: false, skipped: true, error: result.error, url };
    }
    session.failed.push({ url, error: result.error });
    return { ok: false, error: result.error, stage: result.stage, url };
  }
  session.saved.push(result.item.id);
  return { ok: true, id: result.item.id, title: result.item.title, url };
}

function guessChannel(url: string): string | undefined {
  if (url.includes("wenshu.court.gov.cn")) return "wenshu";
  if (url.includes("ccgp.gov.cn")) return "ccgp";
  if (url.includes("ggzy.gov.cn")) return "ggzy";
  if (url.includes("court.gov.cn")) return "spc-guiding";
  return undefined;
}
