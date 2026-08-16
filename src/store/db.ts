import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { IntelItemSchema, type IntelItem, type IntelType, type ServiceType } from "../domain/intel";
import {
  SubscriptionSchema,
  subscriptionName,
  type Subscription,
  type SubscriptionInput,
} from "../domain/subscription";

export type ListQuery = {
  type?: IntelType;
  region?: string;
  q?: string;
  biddable?: boolean;
  sourceId?: string;
};

export type IngestTrigger = "cli" | "api" | "schedule";
export type IngestRunStatus = "running" | "ok" | "partial" | "error";

export type IngestRun = {
  id: string;
  sourceId: string;
  trigger: IngestTrigger;
  status: IngestRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  discovered: number;
  succeeded: number;
  failed: number;
  error: string | null;
};

export class IntelStore {
  private readonly db: Database;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  upsert(item: IntelItem): IntelItem {
    const parsed = IntelItemSchema.parse(item);
    this.db
      .query(
        `INSERT INTO intel (id, type, source_id, source_url, title, region, published_at, ingested_at, biddable, verification, payload)
         VALUES ($id, $type, $source_id, $source_url, $title, $region, $published_at, $ingested_at, $biddable, $verification, $payload)
         ON CONFLICT(id) DO UPDATE SET
           type=excluded.type,
           source_id=excluded.source_id,
           source_url=excluded.source_url,
           title=excluded.title,
           region=excluded.region,
           published_at=excluded.published_at,
           ingested_at=excluded.ingested_at,
           biddable=excluded.biddable,
           verification=excluded.verification,
           payload=excluded.payload`,
      )
      .run({
        $id: parsed.id,
        $type: parsed.type,
        $source_id: parsed.sourceId,
        $source_url: parsed.sourceUrl,
        $title: parsed.title,
        $region: parsed.region,
        $published_at: parsed.publishedAt,
        $ingested_at: parsed.ingestedAt,
        $biddable: parsed.type === "tender" && parsed.biddable ? 1 : 0,
        $verification: parsed.verification.status,
        $payload: JSON.stringify(parsed),
      });
    return parsed;
  }

  get(id: string): IntelItem | null {
    const row = this.db.query<{ payload: string }, [string]>(
      "SELECT payload FROM intel WHERE id = ?",
    ).get(id);
    return row ? IntelItemSchema.parse(JSON.parse(row.payload)) : null;
  }

  list(query: ListQuery = {}): IntelItem[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query.type) {
      where.push("type = ?");
      params.push(query.type);
    }
    if (query.region) {
      where.push("region = ?");
      params.push(query.region);
    }
    if (query.sourceId) {
      where.push("source_id = ?");
      params.push(query.sourceId);
    }
    if (query.biddable === true) {
      where.push("biddable = 1");
    }
    if (query.q) {
      where.push("(title LIKE ? OR payload LIKE ?)");
      params.push(`%${query.q}%`, `%${query.q}%`);
    }
    const sql = `SELECT payload FROM intel ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY published_at DESC, ingested_at DESC`;
    return this.db
      .query<{ payload: string }, Array<string | number>>(sql)
      .all(...params)
      .map((row) => IntelItemSchema.parse(JSON.parse(row.payload)));
  }

  count(): number {
    return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM intel").get()?.n ?? 0;
  }

  startIngestRun(input: { sourceId: string; trigger: IngestTrigger; startedAt: string }): IngestRun {
    const run: IngestRun = {
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      sourceId: input.sourceId,
      trigger: input.trigger,
      status: "running",
      startedAt: input.startedAt,
      finishedAt: null,
      durationMs: null,
      discovered: 0,
      succeeded: 0,
      failed: 0,
      error: null,
    };
    this.db
      .query(
        `INSERT INTO ingest_runs (id, source_id, trigger, status, started_at, finished_at, duration_ms, discovered, succeeded, failed, error)
         VALUES ($id, $source_id, $trigger, $status, $started_at, $finished_at, $duration_ms, $discovered, $succeeded, $failed, $error)`,
      )
      .run(runBinds(run));
    return run;
  }

  finishIngestRun(
    id: string,
    patch: Pick<IngestRun, "status" | "finishedAt" | "durationMs" | "discovered" | "succeeded" | "failed" | "error">,
  ): IngestRun {
    const current = this.getIngestRun(id);
    if (!current) throw new Error(`ingest run not found: ${id}`);
    const run: IngestRun = { ...current, ...patch };
    this.db
      .query(
        `UPDATE ingest_runs SET
           status=$status, finished_at=$finished_at, duration_ms=$duration_ms,
           discovered=$discovered, succeeded=$succeeded, failed=$failed, error=$error
         WHERE id=$id`,
      )
      .run({
        $id: run.id,
        $status: run.status,
        $finished_at: run.finishedAt,
        $duration_ms: run.durationMs,
        $discovered: run.discovered,
        $succeeded: run.succeeded,
        $failed: run.failed,
        $error: run.error,
      });
    return run;
  }

  getIngestRun(id: string): IngestRun | null {
    const row = this.db
      .query<IngestRunRow, [string]>("SELECT * FROM ingest_runs WHERE id = ?")
      .get(id);
    return row ? rowToRun(row) : null;
  }

  createSubscription(input: SubscriptionInput, at = new Date()): Subscription {
    const now = at.toISOString();
    const sub = SubscriptionSchema.parse({
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      name: subscriptionName(input),
      type: input.type,
      region: emptyToNull(input.region),
      serviceType: input.serviceType ?? null,
      budgetMin: input.budgetMin ?? null,
      budgetMax: input.budgetMax ?? null,
      createdAt: now,
      updatedAt: now,
    });
    this.db
      .query(
        `INSERT INTO subscriptions (id, name, type, region, service_type, budget_min, budget_max, created_at, updated_at)
         VALUES ($id, $name, $type, $region, $service_type, $budget_min, $budget_max, $created_at, $updated_at)`,
      )
      .run(subscriptionBinds(sub));
    return sub;
  }

  updateSubscription(id: string, input: Partial<SubscriptionInput>, at = new Date()): Subscription | null {
    const current = this.getSubscription(id);
    if (!current) return null;
    const merged: SubscriptionInput = {
      name: input.name === undefined ? current.name : input.name,
      type: input.type ?? current.type,
      region: input.region === undefined ? current.region : input.region,
      serviceType: input.serviceType === undefined ? current.serviceType : input.serviceType,
      budgetMin: input.budgetMin === undefined ? current.budgetMin : input.budgetMin,
      budgetMax: input.budgetMax === undefined ? current.budgetMax : input.budgetMax,
    };
    const sub = SubscriptionSchema.parse({
      ...current,
      name: subscriptionName({ ...merged, name: merged.name || current.name }),
      type: merged.type,
      region: emptyToNull(merged.region),
      serviceType: merged.serviceType ?? null,
      budgetMin: merged.budgetMin ?? null,
      budgetMax: merged.budgetMax ?? null,
      updatedAt: at.toISOString(),
    });
    this.db
      .query(
        `UPDATE subscriptions SET
           name=$name, type=$type, region=$region, service_type=$service_type,
           budget_min=$budget_min, budget_max=$budget_max, updated_at=$updated_at
         WHERE id=$id`,
      )
      .run(subscriptionBinds(sub));
    return sub;
  }

  deleteSubscription(id: string): boolean {
    const result = this.db.query("DELETE FROM subscriptions WHERE id = ?").run(id);
    return result.changes > 0;
  }

  getSubscription(id: string): Subscription | null {
    const row = this.db
      .query<SubscriptionRow, [string]>("SELECT * FROM subscriptions WHERE id = ?")
      .get(id);
    return row ? rowToSubscription(row) : null;
  }

  listSubscriptions(): Subscription[] {
    return this.db
      .query<SubscriptionRow, []>("SELECT * FROM subscriptions ORDER BY created_at DESC")
      .all()
      .map(rowToSubscription);
  }

  hasDelivery(subscriptionId: string, itemId: string): boolean {
    const row = this.db
      .query<{ n: number }, [string, string]>(
        "SELECT COUNT(*) AS n FROM subscription_deliveries WHERE subscription_id = ? AND item_id = ?",
      )
      .get(subscriptionId, itemId);
    return (row?.n ?? 0) > 0;
  }

  recordDelivery(subscriptionId: string, itemId: string, deliveredAt: string): boolean {
    const result = this.db
      .query(
        `INSERT OR IGNORE INTO subscription_deliveries (subscription_id, item_id, delivered_at)
         VALUES (?, ?, ?)`,
      )
      .run(subscriptionId, itemId, deliveredAt);
    return result.changes > 0;
  }

  listIngestRuns(query: { sourceId?: string; limit?: number } = {}): IngestRun[] {
    const limit = query.limit ?? 50;
    if (query.sourceId) {
      return this.db
        .query<IngestRunRow, [string, number]>(
          "SELECT * FROM ingest_runs WHERE source_id = ? ORDER BY started_at DESC LIMIT ?",
        )
        .all(query.sourceId, limit)
        .map(rowToRun);
    }
    return this.db
      .query<IngestRunRow, [number]>("SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT ?")
      .all(limit)
      .map(rowToRun);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS intel (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        title TEXT NOT NULL,
        region TEXT NOT NULL,
        published_at TEXT NOT NULL,
        ingested_at TEXT NOT NULL,
        biddable INTEGER NOT NULL DEFAULT 0,
        verification TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS intel_type_idx ON intel(type);
      CREATE INDEX IF NOT EXISTS intel_region_idx ON intel(region);
      CREATE INDEX IF NOT EXISTS intel_biddable_idx ON intel(biddable);
      CREATE TABLE IF NOT EXISTS ingest_runs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        discovered INTEGER NOT NULL DEFAULT 0,
        succeeded INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS ingest_runs_started_idx ON ingest_runs(started_at);
      CREATE INDEX IF NOT EXISTS ingest_runs_source_idx ON ingest_runs(source_id);
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        region TEXT,
        service_type TEXT,
        budget_min REAL,
        budget_max REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subscription_deliveries (
        subscription_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        delivered_at TEXT NOT NULL,
        PRIMARY KEY (subscription_id, item_id),
        FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
      );
    `);
  }
}

type IngestRunRow = {
  id: string;
  source_id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  discovered: number;
  succeeded: number;
  failed: number;
  error: string | null;
};

function runBinds(run: IngestRun) {
  return {
    $id: run.id,
    $source_id: run.sourceId,
    $trigger: run.trigger,
    $status: run.status,
    $started_at: run.startedAt,
    $finished_at: run.finishedAt,
    $duration_ms: run.durationMs,
    $discovered: run.discovered,
    $succeeded: run.succeeded,
    $failed: run.failed,
    $error: run.error,
  };
}

type SubscriptionRow = {
  id: string;
  name: string;
  type: string;
  region: string | null;
  service_type: string | null;
  budget_min: number | null;
  budget_max: number | null;
  created_at: string;
  updated_at: string;
};

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function subscriptionBinds(sub: Subscription) {
  return {
    $id: sub.id,
    $name: sub.name,
    $type: sub.type,
    $region: sub.region,
    $service_type: sub.serviceType,
    $budget_min: sub.budgetMin,
    $budget_max: sub.budgetMax,
    $created_at: sub.createdAt,
    $updated_at: sub.updatedAt,
  };
}

function rowToSubscription(row: SubscriptionRow): Subscription {
  return SubscriptionSchema.parse({
    id: row.id,
    name: row.name,
    type: row.type as IntelType,
    region: row.region,
    serviceType: row.service_type as ServiceType | null,
    budgetMin: row.budget_min,
    budgetMax: row.budget_max,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function rowToRun(row: IngestRunRow): IngestRun {
  return {
    id: row.id,
    sourceId: row.source_id,
    trigger: row.trigger as IngestTrigger,
    status: row.status as IngestRunStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    discovered: row.discovered,
    succeeded: row.succeeded,
    failed: row.failed,
    error: row.error,
  };
}
