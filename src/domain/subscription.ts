import { z } from "zod";
import { IntelTypeSchema, ServiceTypeSchema, type IntelItem, type IntelType, type ServiceType } from "./intel";

export const SubscriptionSchema = z
  .object({
    id: z.string().min(8),
    name: z.string().min(1),
    type: IntelTypeSchema,
    region: z.string().min(1).nullable(),
    serviceType: ServiceTypeSchema.nullable(),
    budgetMin: z.number().nonnegative().nullable(),
    budgetMax: z.number().nonnegative().nullable(),
    createdAt: z.string().min(4),
    updatedAt: z.string().min(4),
  })
  .refine((sub) => sub.budgetMin == null || sub.budgetMax == null || sub.budgetMin <= sub.budgetMax, {
    message: "budgetMin must be <= budgetMax",
  });

export type Subscription = z.infer<typeof SubscriptionSchema>;

export type SubscriptionInput = {
  name?: string | null;
  type: IntelType;
  region?: string | null;
  serviceType?: ServiceType | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
};

export function subscriptionName(input: SubscriptionInput): string {
  const named = input.name?.trim();
  if (named) return named;
  const bits = [input.type, input.region ?? "*", input.serviceType ?? "*"];
  return bits.join(" · ");
}

export function matchesSubscription(item: IntelItem, sub: Subscription): boolean {
  if (item.type !== sub.type) return false;
  if (sub.region && !regionMatches(item.region, sub.region)) return false;
  if (item.type === "tender") {
    if (sub.serviceType && item.serviceType !== sub.serviceType) return false;
    if (!budgetMatches(item.budget, sub.budgetMin, sub.budgetMax)) return false;
  }
  return true;
}

export function shouldDeliver(item: IntelItem): boolean {
  if (item.type === "tender" && !item.biddable) return false;
  return true;
}

function regionMatches(itemRegion: string, rule: string): boolean {
  return itemRegion.includes(rule) || rule.includes(itemRegion);
}

function budgetMatches(budget: number | null, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true;
  if (budget == null) return false;
  if (min != null && budget < min) return false;
  if (max != null && budget > max) return false;
  return true;
}
