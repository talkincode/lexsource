import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createAzureComplete } from "./agents/runtime";
import { createDeterministicCollector } from "./agents/stub";
import { ingestDocument } from "./pipeline/ingest";
import { runSourceIngest } from "./pipeline/run";
import { createHttpClient } from "./sources/http";
import { IntelStore } from "./store/db";
import type { Role } from "./domain/auth";
import { isRole } from "./domain/auth";

const dbPath = process.env.LEXSOURCE_DB ?? "var/lexsource.db";

async function main() {
  const { command, flags } = parseArgs(Bun.argv.slice(2));
  if (command === "ingest-fixtures") {
    await ingestFixtures();
    return;
  }
  if (command === "ingest") {
    await ingestTarget(flags);
    return;
  }
  if (command === "create-user") {
    await createUser(flags);
    return;
  }
  if (command === "purge-intel") {
    const store = new IntelStore(dbPath);
    const removed = store.purgeIntel();
    store.close();
    console.log(JSON.stringify({ ok: true, removed }));
    return;
  }
  console.error("Usage: bun src/cli.ts ingest-fixtures");
  console.error(
    "       bun src/cli.ts ingest --source <ccgp|ggzy|spc-guiding> --url <https://...|./file.html>",
  );
  console.error("       bun src/cli.ts create-user --username <name> --password <secret> --role <admin|lawyer>");
  console.error("       bun src/cli.ts purge-intel");
  process.exit(1);
}

async function createUser(flags: Record<string, string>) {
  const username = flags.username;
  const password = flags.password;
  const role = flags.role as Role | undefined;
  if (!username || !password || !role || !isRole(role)) {
    console.error("Usage: bun src/cli.ts create-user --username <name> --password <secret> --role <admin|lawyer>");
    process.exit(1);
  }
  const store = new IntelStore(dbPath);
  const user = await store.createUser({ username, password, role });
  store.close();
  console.log(JSON.stringify({ ok: true, id: user.id, username: user.username, role: user.role }));
}

async function ingestTarget(flags: Record<string, string>) {
  const sourceId = flags.source;
  const url = flags.url;
  if (!sourceId || !url) {
    console.error(
      "Usage: bun src/cli.ts ingest --source <ccgp|ggzy|spc-guiding> --url <https://...|./file.html>",
    );
    process.exit(1);
  }

  const store = new IntelStore(dbPath);
  const complete =
    process.env.LEXSOURCE_TEST_COLLECTOR === "1"
      ? createDeterministicCollector()
      : createAzureComplete() ?? undefined;
  const run = await runSourceIngest({
    store,
    sourceId,
    target: url,
    http: createHttpClient(),
    trigger: "cli",
    complete,
  });
  store.close();
  console.log(
    JSON.stringify({
      status: run.status,
      sourceId: run.sourceId,
      discovered: run.discovered,
      succeeded: run.succeeded,
      skipped: run.skipped,
      failed: run.failed,
      durationMs: run.durationMs,
      error: run.error,
    }),
  );
  if (run.status === "error" || run.failed > 0) process.exit(1);
}

async function ingestFixtures() {
  const store = new IntelStore(dbPath);
  const root = join(import.meta.dir, "..", "tests", "fixtures");
  const files = [
    ...(await listHtml(join(root, "tenders"))),
    ...(await listHtml(join(root, "cases"))),
  ];

  let ok = 0;
  let failed = 0;
  for (const file of files) {
    const html = await Bun.file(file).text();
    const meta = parseMeta(html);
    const result = await ingestDocument(
      store,
      {
        sourceId: meta.sourceId,
        sourceUrl: meta.sourceUrl,
        html,
      },
      new Date(),
      undefined,
      { decision: { accept: true, reason: "curated fixture" } },
    );
    if (result.ok) {
      ok += 1;
      console.log(JSON.stringify({ status: "ok", file, id: result.item.id, title: result.item.title }));
    } else {
      failed += 1;
      console.log(JSON.stringify({ status: "error", file, error: result.error }));
    }
  }
  store.close();
  console.log(JSON.stringify({ ingested: ok, failed }));
  if (failed > 0) process.exit(1);
}

function parseArgs(argv: string[]): { command: string | undefined; flags: Record<string, string> } {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token?.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > 2) {
      flags[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = "1";
    }
  }
  return { command, flags };
}

function parseMeta(html: string): { sourceId: string; sourceUrl: string } {
  const sourceId = html.match(/data-source-id="([^"]+)"/)?.[1];
  const sourceUrl = html.match(/data-source-url="([^"]+)"/)?.[1];
  if (!sourceId || !sourceUrl) throw new Error("fixture missing data-source-id/url");
  return { sourceId, sourceUrl };
}

async function listHtml(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((name) => name.endsWith(".html")).map((name) => join(dir, name));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
