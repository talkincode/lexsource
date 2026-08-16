import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { IntelItemSchema, type IntelItem, type IntelType } from "../domain/intel";

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
