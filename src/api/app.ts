import { Hono } from "hono";
import type { IntelItem } from "../domain/intel";
import type { SubscriptionInput } from "../domain/subscription";
import { toDocx } from "../export/docx";
import { toMarkdown } from "../export/markdown";
import { toPdf } from "../export/pdf";
import type { DeliverySink } from "../notify/deliver";
import { ingestDocument } from "../pipeline/ingest";
import { notifySubscriptions, previewSubscription } from "../pipeline/notify";
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
  deliver?: DeliverySink;
};

export function createApp(env: AppEnv) {
  const app = new Hono();
  const now = env.now ?? (() => new Date());
  const fetchHtml = env.fetchHtml ?? createHttpClient();
  const onIngested = env.deliver
    ? (item: IntelItem) => notifySubscriptions({ store: env.store, item, sink: env.deliver!, now })
    : undefined;

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
        onIngested,
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
      onIngested,
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

  app.get("/api/subscriptions", (c) => c.json({ subscriptions: env.store.listSubscriptions() }));

  app.post("/api/subscriptions", async (c) => {
    const parsed = parseSubscriptionInput(await c.req.json().catch(() => null));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    if (!parsed.value.type) return c.json({ error: "type_required" }, 400);
    const subscription = env.store.createSubscription(
      { ...parsed.value, type: parsed.value.type },
      now(),
    );
    return c.json({ subscription }, 201);
  });

  app.get("/api/subscriptions/:id", (c) => {
    const subscription = env.store.getSubscription(c.req.param("id"));
    if (!subscription) return c.json({ error: "not_found" }, 404);
    return c.json({ subscription });
  });

  app.put("/api/subscriptions/:id", async (c) => {
    const current = env.store.getSubscription(c.req.param("id"));
    if (!current) return c.json({ error: "not_found" }, 404);
    const parsed = parseSubscriptionInput(await c.req.json().catch(() => null), true);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const subscription = env.store.updateSubscription(c.req.param("id"), parsed.value, now());
    return c.json({ subscription });
  });

  app.delete("/api/subscriptions/:id", (c) => {
    if (!env.store.deleteSubscription(c.req.param("id"))) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  app.post("/api/subscriptions/:id/preview", (c) => {
    const preview = previewSubscription(env.store, c.req.param("id"));
    if (!preview) return c.json({ error: "not_found" }, 404);
    return c.json(preview);
  });

  return app;
}

function parseSubscriptionInput(
  body: unknown,
  partial = false,
): { ok: true; value: Partial<SubscriptionInput> } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };
  const raw = body as Record<string, unknown>;
  const type = asEnum(typeof raw.type === "string" ? raw.type : undefined, ["tender", "major_case"]);
  if (!type && !partial) return { ok: false, error: "type_required" };
  if (raw.type != null && raw.type !== "" && !type) return { ok: false, error: "invalid_type" };

  const serviceType =
    raw.serviceType === undefined
      ? undefined
      : raw.serviceType === null || raw.serviceType === ""
        ? null
        : asEnum(typeof raw.serviceType === "string" ? raw.serviceType : undefined, [
            "general_counsel",
            "special_project",
            "litigation",
            "other",
          ]);
  if (raw.serviceType != null && raw.serviceType !== "" && serviceType === undefined) {
    return { ok: false, error: "invalid_service_type" };
  }

  const budgetMin = parseBudget(raw.budgetMin);
  const budgetMax = parseBudget(raw.budgetMax);
  if (budgetMin === "invalid" || budgetMax === "invalid") return { ok: false, error: "invalid_budget" };
  if (budgetMin != null && budgetMax != null && budgetMin > budgetMax) return { ok: false, error: "invalid_budget_range" };

  const name = raw.name === undefined ? undefined : typeof raw.name === "string" ? raw.name : null;
  const region = raw.region === undefined ? undefined : typeof raw.region === "string" ? raw.region : null;

  return {
    ok: true,
    value: {
      name,
      type,
      region,
      serviceType,
      budgetMin: raw.budgetMin === undefined ? undefined : budgetMin,
      budgetMax: raw.budgetMax === undefined ? undefined : budgetMax,
    },
  };
}

function parseBudget(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
}

function asEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
