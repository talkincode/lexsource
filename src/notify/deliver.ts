import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IntelType } from "../domain/intel";

export type DeliveryEvent = {
  subscriptionId: string;
  itemId: string;
  type: IntelType;
  title: string;
  sourceUrl: string;
  region: string;
  deliveredAt: string;
};

export type DeliverySink = {
  deliver(event: DeliveryEvent): void;
};

export type MemorySink = DeliverySink & { events: DeliveryEvent[] };

export function createMemorySink(): MemorySink {
  const events: DeliveryEvent[] = [];
  return {
    events,
    deliver(event) {
      events.push(event);
    },
  };
}

export function createFileSink(path: string): DeliverySink {
  return {
    deliver(event) {
      mkdirSync(dirname(path), { recursive: true });
      const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
      writeFileSync(path, `${previous}${JSON.stringify(event)}\n`, "utf8");
    },
  };
}

export function createWebhookSink(url: string, post: typeof fetch = fetch): DeliverySink {
  return {
    deliver(event) {
      void post(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
    },
  };
}

export function composeSinks(...sinks: DeliverySink[]): DeliverySink {
  return {
    deliver(event) {
      for (const sink of sinks) sink.deliver(event);
    },
  };
}

export function defaultSink(env: Record<string, string | undefined> = process.env): DeliverySink {
  const outbox = env.LEXSOURCE_OUTBOX ?? "var/outbox.jsonl";
  const sinks: DeliverySink[] = [createFileSink(outbox)];
  const webhook = env.LEXSOURCE_WEBHOOK_URL?.trim();
  if (webhook) sinks.push(createWebhookSink(webhook));
  return composeSinks(...sinks);
}
