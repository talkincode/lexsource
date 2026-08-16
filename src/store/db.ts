import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_AGENT_INTERVAL_MS,
  DEFAULT_INTERVAL_DAYS,
  DEFAULT_RUN_AT,
  type AgentId,
} from "../agents/catalog";
import { CHANNELS } from "../agents/channels";
import { isLegalIntelItem } from "../domain/relevance";
import {
  hashPassword,
  isRole,
  SESSION_TTL_MS,
  verifyPassword,
  type Role,
  type User,
} from "../domain/auth";
import { IntelItemSchema, type IntelItem, type IntelType } from "../domain/intel";

export type ListQuery = {
  type?: IntelType;
  region?: string;
  q?: string;
  biddable?: boolean;
  sourceId?: string;
  page?: number;
  pageSize?: number;
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
  skipped: number;
  failed: number;
  error: string | null;
};

export type RunStepKind = "thought" | "action" | "observation" | "error";

export type IngestRunStep = {
  id: string;
  runId: string;
  seq: number;
  kind: RunStepKind;
  tool: string | null;
  input: unknown;
  output: unknown;
  at: string;
};

export type StoredChannel = {
  id: string;
  name: string;
  kind: "tender" | "major_case";
  agentId: AgentId;
  region: string;
  seedUrls: string[];
  hints: string;
  enabled: boolean;
  hasCookie: boolean;
  updatedAt: string;
};

export type AgentSchedule = {
  id: AgentId;
  enabled: boolean;
  intervalDays: number;
  runAt: string;
  intervalMs: number;
  lastRunAt: string | null;
  updatedAt: string;
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
    const { clause, params } = listWhere(query);
    let sql = `SELECT payload FROM intel ${clause} ORDER BY published_at DESC, ingested_at DESC`;
    if (query.pageSize && query.pageSize > 0) {
      const size = Math.min(Math.max(Math.round(query.pageSize), 1), 50);
      const page = Math.max(Math.round(query.page ?? 1), 1);
      sql += " LIMIT ? OFFSET ?";
      params.push(size, (page - 1) * size);
    }
    return this.db
      .query<{ payload: string }, Array<string | number>>(sql)
      .all(...params)
      .map((row) => IntelItemSchema.parse(JSON.parse(row.payload)));
  }

  countList(query: ListQuery = {}): number {
    const { clause, params } = listWhere(query);
    return (
      this.db
        .query<{ n: number }, Array<string | number>>(`SELECT COUNT(*) AS n FROM intel ${clause}`)
        .get(...params)?.n ?? 0
    );
  }

  listRegions(type?: IntelType): string[] {
    const rows = type
      ? this.db.query<{ region: string }, [string]>(
          "SELECT DISTINCT region FROM intel WHERE type = ? ORDER BY region",
        ).all(type)
      : this.db.query<{ region: string }, []>("SELECT DISTINCT region FROM intel ORDER BY region").all();
    return rows.map((row) => row.region).filter(Boolean);
  }

  desk(): { tenders: IntelItem[]; cases: IntelItem[] } {
    return {
      tenders: this.list({ type: "tender", biddable: true }).filter(isLegalIntelItem),
      cases: this.list({ type: "major_case" }).filter(isLegalIntelItem),
    };
  }

  count(): number {
    return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM intel").get()?.n ?? 0;
  }

  userCount(): number {
    return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM users").get()?.n ?? 0;
  }

  async createUser(input: { username: string; password: string; role: Role }, at = new Date()): Promise<User> {
    const username = input.username.trim();
    if (!username) throw new Error("username_required");
    if (input.password.length < 8) throw new Error("password_too_short");
    if (!isRole(input.role)) throw new Error("invalid_role");
    if (this.getUserByUsername(username)) throw new Error("username_taken");
    const user: User = {
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      username,
      role: input.role,
      createdAt: at.toISOString(),
    };
    const passwordHash = await hashPassword(input.password);
    this.db
      .query(
        `INSERT INTO users (id, username, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(user.id, user.username, passwordHash, user.role, user.createdAt);
    return user;
  }

  listUsers(): User[] {
    return this.db
      .query<UserRow, []>("SELECT * FROM users ORDER BY created_at ASC")
      .all()
      .map((row) => publicUserRow(row));
  }

  getUser(id: string): User | null {
    const row = this.db.query<UserRow, [string]>("SELECT * FROM users WHERE id = ?").get(id);
    return row ? publicUserRow(row) : null;
  }

  adminCount(): number {
    return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get()?.n ?? 0;
  }

  async updateUserPassword(id: string, password: string): Promise<User | null> {
    if (password.length < 8) throw new Error("password_too_short");
    const current = this.getUser(id);
    if (!current) return null;
    const passwordHash = await hashPassword(password);
    this.db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
    return current;
  }

  deleteSessionsForUser(userId: string): void {
    this.db.query("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  deleteUser(id: string): boolean {
    const current = this.getUser(id);
    if (!current) return false;
    if (current.role === "admin" && this.adminCount() <= 1) throw new Error("last_admin");
    this.deleteSessionsForUser(id);
    const result = this.db.query("DELETE FROM users WHERE id = ?").run(id);
    return result.changes > 0;
  }

  getUserByUsername(username: string): (User & { passwordHash: string }) | null {
    const row = this.db
      .query<UserRow, [string]>("SELECT * FROM users WHERE username = ?")
      .get(username);
    return row ? rowToUser(row) : null;
  }

  async authenticate(username: string, password: string): Promise<User | null> {
    const found = this.getUserByUsername(username);
    if (!found) return null;
    const ok = await verifyPassword(password, found.passwordHash);
    if (!ok) return null;
    return { id: found.id, username: found.username, role: found.role, createdAt: found.createdAt };
  }

  createSession(userId: string, at = new Date(), ttlMs = SESSION_TTL_MS): string {
    const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const expiresAt = new Date(at.getTime() + ttlMs).toISOString();
    this.db
      .query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(token, userId, expiresAt);
    return token;
  }

  getSessionUser(token: string, at = new Date()): User | null {
    if (!token) return null;
    const row = this.db
      .query<UserRow & { expires_at: string }, [string]>(
        `SELECT u.*, s.expires_at FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ?`,
      )
      .get(token);
    if (!row) return null;
    if (Date.parse(row.expires_at) <= at.getTime()) {
      this.deleteSession(token);
      return null;
    }
    return {
      id: row.id,
      username: row.username,
      role: row.role as Role,
      createdAt: row.created_at,
    };
  }

  deleteSession(token: string): void {
    this.db.query("DELETE FROM sessions WHERE token = ?").run(token);
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
      skipped: 0,
      failed: 0,
      error: null,
    };
    this.db
      .query(
        `INSERT INTO ingest_runs (id, source_id, trigger, status, started_at, finished_at, duration_ms, discovered, succeeded, skipped, failed, error)
         VALUES ($id, $source_id, $trigger, $status, $started_at, $finished_at, $duration_ms, $discovered, $succeeded, $skipped, $failed, $error)`,
      )
      .run(runBinds(run));
    return run;
  }

  finishIngestRun(
    id: string,
    patch: Pick<IngestRun, "status" | "finishedAt" | "durationMs" | "discovered" | "succeeded" | "skipped" | "failed" | "error">,
  ): IngestRun {
    const current = this.getIngestRun(id);
    if (!current) throw new Error(`ingest run not found: ${id}`);
    const run: IngestRun = { ...current, ...patch };
    this.db
      .query(
        `UPDATE ingest_runs SET
           status=$status, finished_at=$finished_at, duration_ms=$duration_ms,
           discovered=$discovered, succeeded=$succeeded, skipped=$skipped, failed=$failed, error=$error
         WHERE id=$id`,
      )
      .run({
        $id: run.id,
        $status: run.status,
        $finished_at: run.finishedAt,
        $duration_ms: run.durationMs,
        $discovered: run.discovered,
        $succeeded: run.succeeded,
        $skipped: run.skipped,
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

  appendIngestRunStep(input: Omit<IngestRunStep, "id">): IngestRunStep {
    const step: IngestRunStep = {
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      runId: input.runId,
      seq: input.seq,
      kind: input.kind,
      tool: input.tool,
      input: input.input ?? null,
      output: input.output ?? null,
      at: input.at,
    };
    this.db
      .query(
        `INSERT INTO ingest_run_steps (id, run_id, seq, kind, tool, payload, at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        step.id,
        step.runId,
        step.seq,
        step.kind,
        step.tool,
        JSON.stringify({ input: step.input, output: step.output }),
        step.at,
      );
    return step;
  }

  listIngestRunSteps(runId: string): IngestRunStep[] {
    return this.db
      .query<IngestRunStepRow, [string]>(
        "SELECT * FROM ingest_run_steps WHERE run_id = ? ORDER BY seq ASC",
      )
      .all(runId)
      .map(rowToStep);
  }

  latestIngestRunStep(runId: string): IngestRunStep | null {
    const row = this.db
      .query<IngestRunStepRow, [string]>(
        "SELECT * FROM ingest_run_steps WHERE run_id = ? ORDER BY seq DESC LIMIT 1",
      )
      .get(runId);
    return row ? rowToStep(row) : null;
  }

  getAgentSchedule(id: AgentId): AgentSchedule {
    const row = this.db
      .query<AgentScheduleRow, [string]>("SELECT * FROM agent_schedules WHERE id = ?")
      .get(id);
    if (row) return rowToSchedule(row);
    return {
      id,
      enabled: true,
      intervalDays: DEFAULT_INTERVAL_DAYS,
      runAt: DEFAULT_RUN_AT,
      intervalMs: DEFAULT_AGENT_INTERVAL_MS,
      lastRunAt: null,
      updatedAt: new Date(0).toISOString(),
    };
  }

  listAgentSchedules(): AgentSchedule[] {
    return this.db
      .query<AgentScheduleRow, []>("SELECT * FROM agent_schedules ORDER BY id")
      .all()
      .map(rowToSchedule);
  }

  updateAgentSchedule(
    id: AgentId,
    patch: { enabled?: boolean; intervalDays?: number; runAt?: string },
    at = new Date(),
  ): AgentSchedule {
    const current = this.getAgentSchedule(id);
    const next: AgentSchedule = {
      ...current,
      enabled: patch.enabled ?? current.enabled,
      intervalDays: patch.intervalDays ?? current.intervalDays,
      runAt: patch.runAt ?? current.runAt,
      intervalMs: (patch.intervalDays ?? current.intervalDays) * 86_400_000,
      updatedAt: at.toISOString(),
    };
    this.writeAgentSchedule(next);
    return next;
  }

  listCollectionChannels(): StoredChannel[] {
    return this.db
      .query<ChannelRow, []>("SELECT * FROM collection_channels ORDER BY kind, id")
      .all()
      .map(rowToChannel);
  }

  getCollectionChannel(id: string): StoredChannel | null {
    const row = this.db.query<ChannelRow, [string]>("SELECT * FROM collection_channels WHERE id = ?").get(id);
    return row ? rowToChannel(row) : null;
  }

  getCollectionChannelCookie(id: string): string | null {
    const row = this.db.query<{ cookie: string | null }, [string]>(
      "SELECT cookie FROM collection_channels WHERE id = ?",
    ).get(id);
    const cookie = row?.cookie?.trim();
    return cookie ? cookie : null;
  }

  cookieForUrl(url: string): string | null {
    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
    const rows = this.db.query<ChannelRow, []>("SELECT * FROM collection_channels WHERE cookie IS NOT NULL AND cookie != ''").all();
    for (const row of rows) {
      const seeds: string[] = JSON.parse(row.seed_urls);
      if (seeds.some((seed) => hostMatches(seed, host)) || hostMatchesHint(row.id, host)) {
        return row.cookie?.trim() || null;
      }
    }
    return null;
  }

  upsertCollectionChannel(
    input: {
      id: string;
      name: string;
      kind: "tender" | "major_case";
      agentId: AgentId;
      region?: string;
      seedUrls: string[];
      hints?: string;
      enabled?: boolean;
    },
    at = new Date(),
  ): StoredChannel {
    const id = input.id.trim();
    if (!id) throw new Error("channel_id_required");
    const current = this.getCollectionChannel(id);
    this.db
      .query(
        `INSERT INTO collection_channels (id, name, kind, agent_id, region, seed_urls, hints, cookie, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           kind=excluded.kind,
           agent_id=excluded.agent_id,
           region=excluded.region,
           seed_urls=excluded.seed_urls,
           hints=excluded.hints,
           enabled=excluded.enabled,
           updated_at=excluded.updated_at`,
      )
      .run(
        id,
        input.name.trim(),
        input.kind,
        input.agentId,
        input.region?.trim() || "全国",
        JSON.stringify(input.seedUrls),
        input.hints?.trim() || "",
        current ? this.getCollectionChannelCookie(id) : null,
        (input.enabled ?? current?.enabled ?? true) ? 1 : 0,
        at.toISOString(),
      );
    const saved = this.getCollectionChannel(id);
    if (!saved) throw new Error("channel_write_failed");
    return saved;
  }

  setCollectionChannelCookie(id: string, cookie: string, at = new Date()): StoredChannel | null {
    if (!this.getCollectionChannel(id)) return null;
    this.db
      .query("UPDATE collection_channels SET cookie = ?, updated_at = ? WHERE id = ?")
      .run(cookie.trim(), at.toISOString(), id);
    return this.getCollectionChannel(id);
  }

  clearCollectionChannelCookie(id: string, at = new Date()): StoredChannel | null {
    if (!this.getCollectionChannel(id)) return null;
    this.db.query("UPDATE collection_channels SET cookie = NULL, updated_at = ? WHERE id = ?").run(at.toISOString(), id);
    return this.getCollectionChannel(id);
  }

  deleteCollectionChannel(id: string): boolean {
    if (CHANNELS.some((channel) => channel.id === id)) throw new Error("builtin_channel");
    const result = this.db.query("DELETE FROM collection_channels WHERE id = ?").run(id);
    return result.changes > 0;
  }

  purgeIntel(): number {
    const n = this.count();
    this.db.exec("DELETE FROM intel");
    return n;
  }

  touchAgentRun(id: AgentId, at = new Date()): AgentSchedule {
    const next: AgentSchedule = {
      ...this.getAgentSchedule(id),
      lastRunAt: at.toISOString(),
      updatedAt: at.toISOString(),
    };
    this.writeAgentSchedule(next);
    return next;
  }

  private writeAgentSchedule(next: AgentSchedule): void {
    this.db
      .query(
        `INSERT INTO agent_schedules (id, enabled, interval_ms, interval_days, run_at, last_run_at, updated_at)
         VALUES ($id, $enabled, $interval_ms, $interval_days, $run_at, $last_run_at, $updated_at)
         ON CONFLICT(id) DO UPDATE SET
           enabled=excluded.enabled,
           interval_ms=excluded.interval_ms,
           interval_days=excluded.interval_days,
           run_at=excluded.run_at,
           last_run_at=excluded.last_run_at,
           updated_at=excluded.updated_at`,
      )
      .run({
        $id: next.id,
        $enabled: next.enabled ? 1 : 0,
        $interval_ms: next.intervalMs,
        $interval_days: next.intervalDays,
        $run_at: next.runAt,
        $last_run_at: next.lastRunAt,
        $updated_at: next.updatedAt,
      });
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
        skipped INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS ingest_runs_started_idx ON ingest_runs(started_at);
      CREATE INDEX IF NOT EXISTS ingest_runs_source_idx ON ingest_runs(source_id);
      CREATE TABLE IF NOT EXISTS ingest_run_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        tool TEXT,
        payload TEXT NOT NULL,
        at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES ingest_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS ingest_run_steps_run_idx ON ingest_run_steps(run_id, seq);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS agent_schedules (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        interval_ms INTEGER NOT NULL,
        interval_days INTEGER NOT NULL DEFAULT 1,
        run_at TEXT NOT NULL DEFAULT '08:00',
        last_run_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collection_channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        region TEXT NOT NULL,
        seed_urls TEXT NOT NULL,
        hints TEXT NOT NULL DEFAULT '',
        cookie TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
    `);
    ensureColumn(this.db, "ingest_runs", "skipped", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(this.db, "agent_schedules", "interval_days", "INTEGER NOT NULL DEFAULT 1");
    ensureColumn(this.db, "agent_schedules", "run_at", "TEXT NOT NULL DEFAULT '08:00'");
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT OR IGNORE INTO agent_schedules (id, enabled, interval_ms, interval_days, run_at, last_run_at, updated_at)
         VALUES (?, 1, ?, ?, ?, NULL, ?)`,
      )
      .run("tender", DEFAULT_AGENT_INTERVAL_MS, DEFAULT_INTERVAL_DAYS, DEFAULT_RUN_AT, now);
    this.db
      .query(
        `INSERT OR IGNORE INTO agent_schedules (id, enabled, interval_ms, interval_days, run_at, last_run_at, updated_at)
         VALUES (?, 1, ?, ?, ?, NULL, ?)`,
      )
      .run("case", DEFAULT_AGENT_INTERVAL_MS, DEFAULT_INTERVAL_DAYS, DEFAULT_RUN_AT, now);
    for (const channel of CHANNELS) {
      this.db
        .query(
          `INSERT OR IGNORE INTO collection_channels
           (id, name, kind, agent_id, region, seed_urls, hints, cookie, enabled, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`,
        )
        .run(
          channel.id,
          channel.name,
          channel.kind,
          channel.agentId,
          channel.region,
          JSON.stringify(channel.seedUrls),
          channel.hints,
          now,
        );
    }
  }
}

function ensureColumn(db: Database, table: string, column: string, ddl: string): void {
  const cols = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all();
  if (!cols.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
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
  skipped: number | null;
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
    $skipped: run.skipped,
    $failed: run.failed,
    $error: run.error,
  };
}

type IngestRunStepRow = {
  id: string;
  run_id: string;
  seq: number;
  kind: string;
  tool: string | null;
  payload: string;
  at: string;
};

function rowToStep(row: IngestRunStepRow): IngestRunStep {
  const payload = parseStepPayload(row.payload);
  return {
    id: row.id,
    runId: row.run_id,
    seq: row.seq,
    kind: row.kind as RunStepKind,
    tool: row.tool,
    input: payload.input,
    output: payload.output,
    at: row.at,
  };
}

function parseStepPayload(raw: string): { input: unknown; output: unknown } {
  try {
    const parsed = JSON.parse(raw) as { input?: unknown; output?: unknown };
    return { input: parsed.input ?? null, output: parsed.output ?? null };
  } catch {
    return { input: null, output: raw };
  }
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
    skipped: row.skipped ?? 0,
    failed: row.failed,
    error: row.error,
  };
}

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  created_at: string;
};

function rowToUser(row: UserRow): User & { passwordHash: string } {
  return {
    id: row.id,
    username: row.username,
    role: row.role as Role,
    createdAt: row.created_at,
    passwordHash: row.password_hash,
  };
}

function publicUserRow(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role as Role,
    createdAt: row.created_at,
  };
}

type AgentScheduleRow = {
  id: string;
  enabled: number;
  interval_ms: number;
  interval_days: number | null;
  run_at: string | null;
  last_run_at: string | null;
  updated_at: string;
};

function rowToSchedule(row: AgentScheduleRow): AgentSchedule {
  const intervalDays = row.interval_days && row.interval_days > 0 ? row.interval_days : DEFAULT_INTERVAL_DAYS;
  const runAt = row.run_at && parseRunAtSafe(row.run_at) ? row.run_at : DEFAULT_RUN_AT;
  return {
    id: row.id as AgentId,
    enabled: row.enabled === 1,
    intervalDays,
    runAt,
    intervalMs: intervalDays * 86_400_000,
    lastRunAt: row.last_run_at,
    updatedAt: row.updated_at,
  };
}

function parseRunAtSafe(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

type ChannelRow = {
  id: string;
  name: string;
  kind: string;
  agent_id: string;
  region: string;
  seed_urls: string;
  hints: string;
  cookie: string | null;
  enabled: number;
  updated_at: string;
};

function rowToChannel(row: ChannelRow): StoredChannel {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "major_case" ? "major_case" : "tender",
    agentId: row.agent_id as AgentId,
    region: row.region,
    seedUrls: JSON.parse(row.seed_urls) as string[],
    hints: row.hints,
    enabled: row.enabled === 1,
    hasCookie: Boolean(row.cookie && row.cookie.trim()),
    updatedAt: row.updated_at,
  };
}

function hostMatches(seed: string, host: string): boolean {
  try {
    const seedHost = new URL(seed).hostname.toLowerCase();
    return host === seedHost || host.endsWith(`.${seedHost}`);
  } catch {
    return false;
  }
}

function hostMatchesHint(channelId: string, host: string): boolean {
  if (channelId === "ccgp") return host.includes("ccgp.gov.cn");
  if (channelId === "ggzy") return host.includes("ggzy.gov.cn");
  if (channelId === "spc-guiding") return host.includes("court.gov.cn") && !host.includes("wenshu");
  if (channelId === "wenshu") return host.includes("wenshu.court.gov.cn");
  return false;
}

function listWhere(query: ListQuery): { clause: string; params: Array<string | number> } {
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
  return {
    clause: where.length ? `WHERE ${where.join(" AND ")}` : "",
    params,
  };
}
