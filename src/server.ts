import { createApp } from "./api/app";
import { pollerConfigFromEnv, startPoller } from "./pipeline/poller";
import { runSourceIngest } from "./pipeline/run";
import { createHttpClient } from "./sources/http";
import { IntelStore } from "./store/db";

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.LEXSOURCE_DB ?? "var/lexsource.db";
const store = new IntelStore(dbPath);
const fetchHtml = createHttpClient();
const app = createApp({ store, fetchHtml });
const poller = startPoller({
  ...pollerConfigFromEnv(),
  run: (sourceId) =>
    runSourceIngest({
      store,
      sourceId,
      http: fetchHtml,
      trigger: "schedule",
    }),
});

export default {
  port,
  fetch: app.fetch,
};

console.error(`LexSource listening on http://127.0.0.1:${port}`);
if (poller.running()) {
  console.error(`LexSource poller on every ${poller.intervalMs}ms for ${poller.sources.join(",")}`);
} else {
  console.error("LexSource poller off (set LEXSOURCE_POLL_ENABLED=1 to enable)");
}
