import { expect, test } from "bun:test";
import { createHttpClient, DEFAULT_USER_AGENT, recordedFetch } from "../src/sources/http";
import { discoverCcgp } from "../src/sources/ccgp";
import { discoverGgzy } from "../src/sources/ggzy";

const detail = "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm";

test("fetch sends a polite user-agent and keeps the raw html", async () => {
  const seen: string[] = [];
  const html = "<html><body>原文必须保留</body></html>";
  const http = createHttpClient({
    minIntervalMs: 0,
    fetchImpl: async (input, init) => {
      seen.push(String(init?.headers && new Headers(init.headers).get("user-agent")));
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  const result = await http(detail);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.html).toBe(html);
  expect(seen[0]).toBe(DEFAULT_USER_AGENT);
});

test("fetch uses browser-like headers and can send a bound cookie", async () => {
  const seen: Record<string, string | null> = {};
  const http = createHttpClient({
    minIntervalMs: 0,
    cookieFor: (url) => (url.includes("wenshu") ? "session=abc" : null),
    fetchImpl: async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.ua = headers.get("user-agent");
      seen.sec = headers.get("sec-fetch-mode");
      seen.cookie = headers.get("cookie");
      return new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  const result = await http("https://wenshu.court.gov.cn/website/wenshu/181107ANFZ0BXSK4/index.html");
  expect(result.ok).toBe(true);
  expect(seen.ua).toContain("Chrome/");
  expect(seen.sec).toBe("navigate");
  expect(seen.cookie).toBe("session=abc");
});

test("fetch rate-limits by host", async () => {
  const sleeps: number[] = [];
  let t = 0;
  const http = createHttpClient({
    minIntervalMs: 1000,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    fetchImpl: recordedFetch({
      "https://www.ccgp.gov.cn/a.htm": { body: "<html>a</html>" },
      "https://www.ccgp.gov.cn/b.htm": { body: "<html>b</html>" },
    }),
  });
  await http("https://www.ccgp.gov.cn/a.htm");
  t = 200;
  await http("https://www.ccgp.gov.cn/b.htm");
  expect(sleeps).toEqual([800]);
});

test("fetch maps http errors, empty bodies, invalid urls and timeouts", async () => {
  const http503 = createHttpClient({
    minIntervalMs: 0,
    fetchImpl: recordedFetch({ "https://www.ccgp.gov.cn/x.htm": { status: 503, body: "busy" } }),
  });
  const empty = createHttpClient({
    minIntervalMs: 0,
    fetchImpl: recordedFetch({ "https://www.ccgp.gov.cn/empty.htm": { body: "   " } }),
  });
  const timed = createHttpClient({
    minIntervalMs: 0,
    timeoutMs: 15,
    fetchImpl: (_input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
  });

  expect(await http503("https://www.ccgp.gov.cn/x.htm")).toMatchObject({
    ok: false,
    code: "http_error",
    status: 503,
  });
  expect(await empty("https://www.ccgp.gov.cn/empty.htm")).toMatchObject({
    ok: false,
    code: "empty_body",
  });
  expect(await createHttpClient({ minIntervalMs: 0 })("not-a-url")).toMatchObject({
    ok: false,
    code: "invalid_url",
  });
  expect(await timed(detail)).toMatchObject({ ok: false, code: "timeout" });
});

test("ccgp and ggzy discover detail urls from listing fixtures", async () => {
  const ccgpList = await Bun.file(new URL("./fixtures/listings/ccgp-list.html", import.meta.url)).text();
  const ggzyList = await Bun.file(new URL("./fixtures/listings/ggzy-list.html", import.meta.url)).text();
  expect(discoverCcgp(ccgpList, "https://www.ccgp.gov.cn/cggg/zygg/gkzb/")).toEqual([
    "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
    "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260802_missing.htm",
  ]);
  expect(discoverGgzy(ggzyList, "https://www.ggzy.gov.cn/")).toEqual([
    "https://www.ggzy.gov.cn/deal/202601/expired-legal.htm",
  ]);
});
