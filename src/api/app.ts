import { Hono } from "hono";
import { toDocx } from "../export/docx";
import { toMarkdown } from "../export/markdown";
import { toPdf } from "../export/pdf";
import { ingestDocument } from "../pipeline/ingest";
import { RunInProgressError, isLocalHtmlTarget, runSourceIngest } from "../pipeline/run";
import { createHttpClient } from "../sources/http";
import { getSource, listSources } from "../sources/registry";
import type { FetchHtml } from "../sources/types";
import type { IntelStore, ListQuery } from "../store/db";
import { dashboardHtml } from "../web/dashboard";

export type AppEnv = {
  store: IntelStore;
  now?: () => Date;
  fetchHtml?: FetchHtml;
};

export function createApp(env: AppEnv) {
  const app = new Hono();
  const now = env.now ?? (() => new Date());
  const fetchHtml = env.fetchHtml ?? createHttpClient();

  app.get("/", (c) => c.html(dashboardHtml()));

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      name: "lexsource",
      items: env.store.count(),
    }),
  );

  app.get("/api/sources", (c) => c.json({ sources: listSources() }));

  app.get("/api/ingest-runs", (c) => {
    const sourceId = c.req.query("sourceId") || undefined;
    return c.json({ runs: env.store.listIngestRuns({ sourceId, limit: 50 }) });
  });

  app.post("/api/sources/:id/run", async (c) => {
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
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.sourceId !== "string" || typeof body.sourceUrl !== "string") {
      return c.json({ error: "sourceId and sourceUrl are required" }, 400);
    }
    const result = ingestDocument(
      env.store,
      {
        sourceId: body.sourceId,
        sourceUrl: body.sourceUrl,
        html: typeof body.html === "string" ? body.html : undefined,
        text: typeof body.text === "string" ? body.text : undefined,
      },
      now(),
    );
    if (!result.ok) return c.json(result, 422);
    return c.json(result, 201);
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

  return app;
}

function asEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
