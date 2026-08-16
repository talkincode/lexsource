import { nowIso } from "../domain/intel";
import type { FetchHtml, FetchResult, HttpClientOptions } from "./types";

export const DEFAULT_USER_AGENT =
  "LexSource/0.1 (+https://github.com/talkincode/lexsource; law-firm intel; polite)";

const BLOCKED_HOSTS = ["wenshu.court.gov.cn"];

export function isBlockedHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}

export function recordedFetch(
  recordings: Record<string, { status?: number; body: string; contentType?: string }>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const rec = recordings[url];
    if (!rec) {
      return new Response("", { status: 404, statusText: "not_recorded" });
    }
    return new Response(rec.body, {
      status: rec.status ?? 200,
      headers: { "content-type": rec.contentType ?? "text/html; charset=utf-8" },
    });
  }) as typeof fetch;
}

export function createHttpClient(options: HttpClientOptions = {}): FetchHtml {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const minIntervalMs = options.minIntervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const lastByHost = new Map<string, number>();

  return async function fetchHtml(url: string): Promise<FetchResult> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, code: "invalid_url", message: "invalid_url", sourceUrl: stripQuery(url) };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, code: "invalid_url", message: "url_must_be_http", sourceUrl: stripQuery(url) };
    }

    if (isBlockedHost(url)) {
      return {
        ok: false,
        code: "blocked_host",
        message: "blocked_host",
        sourceUrl: stripQuery(url),
      };
    }

    const host = parsed.hostname.toLowerCase();
    const last = lastByHost.get(host);
    if (last != null && minIntervalMs > 0) {
      const wait = last + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
    }
    lastByHost.set(host, now());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: {
          "user-agent": userAgent,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (response.status >= 400) {
        return {
          ok: false,
          code: "http_error",
          message: `http_error:${response.status}`,
          sourceUrl: stripQuery(url),
          status: response.status,
        };
      }
      const html = await response.text();
      if (!html.trim()) {
        return {
          ok: false,
          code: "empty_body",
          message: "empty_body",
          sourceUrl: stripQuery(url),
          status: response.status,
        };
      }
      return {
        ok: true,
        sourceUrl: url,
        html,
        status: response.status,
        fetchedAt: nowIso(new Date(now())),
        contentType: response.headers.get("content-type"),
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const aborted = controller.signal.aborted || name === "AbortError" || name === "TimeoutError";
      return {
        ok: false,
        code: aborted ? "timeout" : "network",
        message: aborted ? "timeout" : sanitizeMessage(error),
        sourceUrl: stripQuery(url),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function stripQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function sanitizeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\?[^\s]*/g, "").slice(0, 180);
}
