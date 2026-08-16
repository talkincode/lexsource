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
    `);
  }
}
