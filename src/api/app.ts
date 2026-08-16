import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import {
  AGENT_CATALOG,
  getAgent,
  parseIntervalDays,
  parseRunAt,
  type AgentId,
} from "../agents/catalog";
import type { CompleteFn } from "../agents/llm";
import { buildDeskOps } from "../agents/ops";
import { createAzureComplete, runCollectionAgent } from "../agents/runtime";
import { getChannel } from "../agents/channels";
import { SESSION_COOKIE, SESSION_TTL_MS, isRole, publicUser, type User } from "../domain/auth";
import { toDocx } from "../export/docx";
import { toMarkdown } from "../export/markdown";
import { toPdf } from "../export/pdf";
import { ingestDocument } from "../pipeline/ingest";
import { intelId } from "../domain/intel";
import { htmlToDocument } from "../sources/page";
import { RunInProgressError, isLocalHtmlTarget, runSourceIngest } from "../pipeline/run";
import { createHttpClient } from "../sources/http";
import { getSource, listSources } from "../sources/registry";
import type { FetchHtml } from "../sources/types";
import type { IntelStore, ListQuery } from "../store/db";
import { dashboardHtml } from "../web/dashboard";
import { loginHtml } from "../web/login";
import { settingsHtml } from "../web/settings";

export type AppEnv = {
  store: IntelStore;
  now?: () => Date;
  fetchHtml?: FetchHtml;
  complete?: CompleteFn;
};

type Vars = { user: User };

export function createApp(env: AppEnv) {
  const app = new Hono<{ Variables: Vars }>();
  const now = env.now ?? (() => new Date());
  const fetchHtml = env.fetchHtml ?? createHttpClient();
  const complete = env.complete ?? createAzureComplete() ?? undefined;

  app.get("/", (c) => {
    const user = userFromCookie(c, env.store, now());
    if (!user) return c.html(loginHtml());
    return c.html(dashboardHtml(user));
  });

  app.get("/settings", (c) => {
    const user = userFromCookie(c, env.store, now());
    if (!user) return c.html(loginHtml());
    return c.html(settingsHtml(user));
  });

  app.get("/api/health", (c) => {
    const user = userFromCookie(c, env.store, now());
    if (!user) return c.json({ ok: true, name: "lexsource" });
    return c.json({
      ok: true,
      name: "lexsource",
      items: env.store.count(),
      user: publicUser(user),
    });
  });

  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json().catch(() => null);
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!username || !password) return c.json({ error: "username_and_password_required" }, 400);
    const user = await env.store.authenticate(username, password);
    if (!user) return c.json({ error: "invalid_credentials" }, 401);
    const token = env.store.createSession(user.id, now());
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return c.json({ user: publicUser(user) });
  });

  app.post("/api/auth/logout", (c) => {
    const token = sessionToken(c);
    if (token) env.store.deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.use("/api/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/api/auth/login" || path === "/api/auth/logout" || path === "/api/health") {
      return next();
    }
    const user = userFromCookie(c, env.store, now());
    if (!user) return c.json({ error: "unauthorized" }, 401);
    c.set("user", user);
    await next();
  });

  app.get("/api/auth/me", (c) => c.json({ user: publicUser(c.get("user")) }));

  app.put("/api/auth/password", async (c) => {
    const user = c.get("user");
    const body = await c.req.json().catch(() => null);
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword || !newPassword) return c.json({ error: "current_and_new_password_required" }, 400);
    const ok = await env.store.authenticate(user.username, currentPassword);
    if (!ok) return c.json({ error: "invalid_current_password" }, 401);
    try {
      await env.store.updateUserPassword(user.id, newPassword);
    } catch (error) {
      if (error instanceof Error && error.message === "password_too_short") {
        return c.json({ error: "password_too_short" }, 400);
      }
      throw error;
    }
    return c.json({ ok: true });
  });

  app.get("/api/users", (c) => {
    if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
    return c.json({ users: env.store.listUsers().map(publicUser) });
  });

  app.post("/api/users", async (c) => {
    if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json().catch(() => null);
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const role = typeof body?.role === "string" ? body.role : "";
    if (!username || !password || !isRole(role)) return c.json({ error: "username_password_role_required" }, 400);
    try {
      const user = await env.store.createUser({ username, password, role }, now());
      return c.json({ user: publicUser(user) }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "username_taken") return c.json({ error: "username_taken" }, 409);
      if (message === "password_too_short") return c.json({ error: "password_too_short" }, 400);
      throw error;
    }
  });

  app.put("/api/users/:id/password", async (c) => {
    if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json().catch(() => null);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!password) return c.json({ error: "password_required" }, 400);
    try {
      const user = await env.store.updateUserPassword(c.req.param("id"), password);
      if (!user) return c.json({ error: "not_found" }, 404);
      env.store.deleteSessionsForUser(user.id);
      return c.json({ ok: true, user: publicUser(user) });
    } catch (error) {
      if (error instanceof Error && error.message === "password_too_short") {
        return c.json({ error: "password_too_short" }, 400);
      }
      throw error;
    }
  });

  app.delete("/api/users/:id", (c) => {
    const actor = c.get("user");
    if (actor.role !== "admin") return c.json({ error: "forbidden" }, 403);
    const id = c.req.param("id");
    if (id === actor.id) return c.json({ error: "cannot_delete_self" }, 400);
    try {
      const deleted = env.store.deleteUser(id);
      if (!deleted) return c.json({ error: "not_found" }, 404);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message === "last_admin") {
        return c.json({ error: "last_admin" }, 400);
      }
      throw error;
    }
  });

  app.get("/api/desk", (c) => {
    const desk = env.store.desk();
    const ops = buildDeskOps(env.store, Boolean(complete), now());
    return c.json({
      ...desk,
      agents: ops.agents,
      runs: env.store.listIngestRuns({ limit: 20 }),
      ops,
    });
  });

  app.get("/api/agents", (c) =>
    c.json({
      agents: AGENT_CATALOG.map((agent) => ({
        ...agent,
        schedule: env.store.getAgentSchedule(agent.id),
      })),
    }),
  );

  app.put("/api/agents/:id/schedule", async (c) => {
    if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "unknown_agent" }, 404);
    const body = await c.req.json().catch(() => null);
    const enabled = typeof body?.enabled === "boolean" ? body.enabled : undefined;
    const intervalDays = body?.intervalDays != null ? parseIntervalDays(body.intervalDays) : undefined;
    if (body?.intervalDays != null && intervalDays === undefined) {
      return c.json({ error: "invalid_interval_days" }, 400);
    }
    const runAtRaw = typeof body?.runAt === "string" ? body.runAt.trim() : undefined;
    if (runAtRaw != null && parseRunAt(runAtRaw) == null) {
      return c.json({ error: "invalid_run_at" }, 400);
    }
    const schedule = env.store.updateAgentSchedule(
      agent.id as AgentId,
      { enabled, intervalDays, runAt: runAtRaw },
      now(),
    );
    return c.json({ agent: { ...agent, schedule } });
  });

  app.post("/api/agents/:id/run", async (c) => {
    if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
    const agent = getAgent(c.req.param("id"));
    if (!agent) return c.json({ error: "unknown_agent" }, 404);
    const runs = [];
    try {
      const run = await runCollectionAgent({
        store: env.store,
        agentId: agent.id,
        http: fetchHtml,
        complete,
        trigger: "api",
        now,
      });
      runs.push(run);
    } catch (error) {
      if (error instanceof RunInProgressError) {
        return c.json({ error: "run_in_progress", sourceId: error.sourceId }, 409);
      }
      throw error;
    }
    env.store.touchAgentRun(agent.id, now());
    return c.json({ ok: runs.every((run) => run.status !== "error"), runs });
  });

  app.get("/api/sources", (c) => c.json({ sources: listSources() }));

  app.get("/api/ingest-runs", (c) => {
    const sourceId = c.req.query("sourceId") || undefined;
    return c.json({ runs: env.store.listIngestRuns({ sourceId, limit: 50 }) });
  });

  app.get("/api/ingest-runs/:id", (c) => {
    const run = env.store.getIngestRun(c.req.param("id"));
    if (!run) return c.json({ error: "not_found" }, 404);
    return c.json({ run, steps: env.store.listIngestRunSteps(run.id) });
  });

  app.post("/api/sources/:id/run", async (c) => {
    if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
    const sourceId = c.req.param("id");
    try {
      getSource(sourceId);
    } catch {
      return c.json({ error: "unknown_source" }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const url = typeof body?.url === "string" ? body.url.trim() : undefined;
    if (url && isLocalHtmlTarget(url)) {
      return c.json({ error: "url_must_be_http" }, 400);
    }

    try {
      const run = await runSourceIngest({
        store: env.store,
        sourceId,
        target: url,
        http: fetchHtml,
        trigger: "api",
        now,
        complete,
      });
      return c.json({ ok: run.status !== "error", run });
    } catch (error) {
      if (error instanceof RunInProgressError) {
        return c.json({ error: "run_in_progress", sourceId }, 409);
      }
      throw error;
    }
  });

  app.get("/api/intel", (c) => {
    const query: ListQuery = {
      type: asEnum(c.req.query("type"), ["tender", "major_case"]),
      region: c.req.query("region") || undefined,
      q: c.req.query("q") || undefined,
      sourceId: c.req.query("sourceId") || undefined,
      biddable: c.req.query("biddable") === "1" ? true : undefined,
    };
    return c.json({ items: env.store.list(query) });
  });

  app.get("/api/intel/:id", (c) => {
    const item = env.store.get(c.req.param("id"));
    if (!item) return c.json({ error: "not_found" }, 404);
    return c.json({ item });
  });

  app.post("/api/intel/ingest", async (c) => {
    if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.sourceId !== "string" || typeof body.sourceUrl !== "string") {
      return c.json({ error: "sourceId and sourceUrl are required" }, 400);
    }
    const channel = getChannel(body.sourceId);
    if (!channel) return c.json({ error: "unknown_source" }, 404);
    const html = typeof body.html === "string" ? body.html : undefined;
    const text = typeof body.text === "string" ? body.text : undefined;
    if (!html && !text) return c.json({ error: "html_or_text_required" }, 400);
    const doc = htmlToDocument({
      sourceId: channel.id,
      sourceUrl: body.sourceUrl,
      html,
      text,
    });
    const run = await runCollectionAgent({
      store: env.store,
      agentId: channel.agentId,
      http: fetchHtml,
      complete,
      trigger: "api",
      now,
      focusChannelId: channel.id,
      focusUrl: body.sourceUrl,
      primed: {
        url: body.sourceUrl,
        html: html ?? "",
        text: doc.text,
        title: doc.titleHint ?? doc.text.slice(0, 80),
        channelId: channel.id,
      },
    });
    const item = env.store.get(intelId(channel.id, body.sourceUrl));
    if (!item) {
      return c.json({ ok: false, stage: "relevance", error: run.error ?? "agent_did_not_accept" }, 422);
    }
    return c.json({ ok: true, item }, 201);
  });

  app.get("/api/intel/:id/export.md", (c) => {
    const item = env.store.get(c.req.param("id"));
    if (!item) return c.json({ error: "not_found" }, 404);
    return c.text(toMarkdown(item), 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${item.id}.md"`,
    });
  });

  app.get("/api/intel/:id/export.docx", async (c) => {
    const item = env.store.get(c.req.param("id"));
    if (!item) return c.json({ error: "not_found" }, 404);
    const bytes = await toDocx(item);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${item.id}.docx"`,
      },
    });
  });

  app.get("/api/intel/:id/export.pdf", async (c) => {
    const item = env.store.get(c.req.param("id"));
    if (!item) return c.json({ error: "not_found" }, 404);
    const bytes = await toPdf(item);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${item.id}.pdf"`,
      },
    });
  });

  app.all("/api/subscriptions", (c) => c.json({ error: "gone", message: "subscription_retired" }, 410));
  app.all("/api/subscriptions/:id", (c) => c.json({ error: "gone", message: "subscription_retired" }, 410));
  app.all("/api/subscriptions/:id/:action", (c) => c.json({ error: "gone", message: "subscription_retired" }, 410));

  return app;
}

function sessionToken(c: { req: { header: (name: string) => string | undefined } }): string | undefined {
  const header = c.req.header("cookie") ?? "";
  return header.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
}

function userFromCookie(
  c: { req: { header: (name: string) => string | undefined } },
  store: IntelStore,
  at: Date,
): User | null {
  const token = sessionToken(c);
  return token ? store.getSessionUser(token, at) : null;
}

function asEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
