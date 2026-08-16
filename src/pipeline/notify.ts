import type { IntelItem } from "../domain/intel";
import { matchesSubscription, shouldDeliver } from "../domain/subscription";
import type { DeliveryEvent, DeliverySink } from "../notify/deliver";
import type { IntelStore } from "../store/db";

export type NotifyInput = {
  store: IntelStore;
  item: IntelItem;
  sink: DeliverySink;
  now?: () => Date;
};

export function notifySubscriptions(input: NotifyInput): DeliveryEvent[] {
  const now = input.now ?? (() => new Date());
  const deliveredAt = now().toISOString();
  const delivered: DeliveryEvent[] = [];

  for (const sub of input.store.listSubscriptions()) {
    if (!matchesSubscription(input.item, sub)) continue;
    if (!shouldDeliver(input.item)) continue;
    if (input.store.hasDelivery(sub.id, input.item.id)) continue;

    const event: DeliveryEvent = {
      subscriptionId: sub.id,
      itemId: input.item.id,
      type: input.item.type,
      title: input.item.title,
      sourceUrl: input.item.sourceUrl,
      region: input.item.region,
      deliveredAt,
    };

    try {
      input.sink.deliver(event);
      input.store.recordDelivery(sub.id, input.item.id, deliveredAt);
      delivered.push(event);
    } catch {
      // Leave undelivered so a later ingest or preview retry can recover.
    }
  }

  return delivered;
}

export function previewSubscription(store: IntelStore, subscriptionId: string) {
  const subscription = store.getSubscription(subscriptionId);
  if (!subscription) return null;

  const items = store.list({ type: subscription.type });
  const matched = items.filter((item) => matchesSubscription(item, subscription));
  const deliverable = matched.filter(shouldDeliver);
  const withheld = matched
    .filter((item) => !shouldDeliver(item))
    .map((item) => ({
      id: item.id,
      title: item.title,
      reason: item.type === "tender" && !item.biddable ? "not_biddable" : "not_deliverable",
    }));

  return { subscription, items: deliverable, withheld };
}
