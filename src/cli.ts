import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ingestDocument } from "./pipeline/ingest";
import { IntelStore } from "./store/db";

const dbPath = process.env.LEXSOURCE_DB ?? "var/lexsource.db";

async function main() {
  const [command] = Bun.argv.slice(2);
  if (command !== "ingest-fixtures") {
    console.error("Usage: bun src/cli.ts ingest-fixtures");
    process.exit(1);
  }

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
    const result = ingestDocument(store, {
      sourceId: meta.sourceId,
      sourceUrl: meta.sourceUrl,
      html,
    });
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
