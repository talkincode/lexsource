import { createApp } from "./api/app";
import { loadAzureOpenAIConfig } from "./agents/azure";
import { createAzureComplete, runCollectionAgent } from "./agents/runtime";
import { startScheduler, schedulerEnabledFromEnv } from "./agents/scheduler";
import { ensureBootstrapUsers } from "./auth/bootstrap";
import { createHttpClient } from "./sources/http";
import { IntelStore } from "./store/db";

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.LEXSOURCE_DB ?? "var/lexsource.db";
const store = new IntelStore(dbPath);
const fetchHtml = createHttpClient({
  cookieFor: (url) => store.cookieForUrl(url),
});
const azure = loadAzureOpenAIConfig();
const complete = createAzureComplete();
const app = createApp({ store, fetchHtml, complete: complete ?? undefined });

await ensureBootstrapUsers(store);

const scheduler = startScheduler({
  store,
  enabled: schedulerEnabledFromEnv(),
  run: (agentId) =>
    runCollectionAgent({
      store,
      agentId,
      http: fetchHtml,
      complete: complete ?? undefined,
      trigger: "schedule",
    }),
});

export default {
  port,
  fetch: app.fetch,
};

console.error(`LexSource listening on http://127.0.0.1:${port}`);
if (azure) {
  console.error(`LexSource agent: Azure OpenAI (${azure.model}) with collection tools`);
} else {
  console.error("LexSource agent missing Azure OpenAI URL/Key; collection will not keep intel.");
}
if (scheduler.running()) {
  console.error("LexSource collection agents on schedule (tender + case)");
} else {
  console.error("LexSource scheduler off (set LEXSOURCE_SCHEDULER_ENABLED=0 to disable)");
}
if (store.userCount() === 0) {
  console.error("No users. Set LEXSOURCE_ADMIN_PASSWORD (and optional LEXSOURCE_LAWYER_PASSWORD) then restart.");
}
