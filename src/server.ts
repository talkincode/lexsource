import { createApp } from "./api/app";
import { IntelStore } from "./store/db";

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.LEXSOURCE_DB ?? "var/lexsource.db";
const store = new IntelStore(dbPath);
const app = createApp({ store });

export default {
  port,
  fetch: app.fetch,
};

console.error(`LexSource listening on http://127.0.0.1:${port}`);
