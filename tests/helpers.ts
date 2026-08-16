import { createApp, type AppEnv } from "../src/api/app";
import { createDeterministicCollector } from "../src/agents/stub";
import { IntelStore } from "../src/store/db";

export { createDeterministicCollector };

export const at = new Date("2026-08-16T08:00:00.000Z");

export async function seedUsers(store: IntelStore) {
  await store.createUser({ username: "admin", password: "admin-pass", role: "admin" }, at);
  await store.createUser({ username: "lawyer", password: "lawyer-pass", role: "lawyer" }, at);
}

export function cookieHeader(setCookie: string | null): string {
  if (!setCookie) return "";
  return setCookie.split(";")[0] ?? "";
}

export async function login(
  app: ReturnType<typeof createApp>,
  username: string,
  password: string,
) {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { res, cookie: cookieHeader(res.headers.get("set-cookie")) };
}

export async function authedApp(role: "admin" | "lawyer" = "admin", extra: Partial<AppEnv> = {}) {
  const store = extra.store ?? new IntelStore(":memory:");
  if (store.userCount() === 0) await seedUsers(store);
  const app = createApp({
    store,
    now: extra.now ?? (() => at),
    fetchHtml: extra.fetchHtml,
    complete: extra.complete ?? createDeterministicCollector(),
  });
  const creds =
    role === "admin"
      ? { username: "admin", password: "admin-pass" }
      : { username: "lawyer", password: "lawyer-pass" };
  const { res, cookie } = await login(app, creds.username, creds.password);
  return { app, store, cookie, login: res, headers: { cookie } };
}

export async function fixture(name: string) {
  return Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();
}
