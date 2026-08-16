import { expect, test } from "bun:test";
import { IntelItemSchema, intelId, isBiddable } from "../src/domain/intel";

const verified = { status: "verified" as const, checks: [] };

test("intelId is stable for the same source pair", () => {
  const a = intelId("ccgp", "https://www.ccgp.gov.cn/a");
  const b = intelId("ccgp", "https://www.ccgp.gov.cn/a");
  const c = intelId("ccgp", "https://www.ccgp.gov.cn/b");
  expect(a).toBe(b);
  expect(a).not.toBe(c);
  expect(a.length).toBe(24);
});

test("tender schema rejects missing purchaser", () => {
  const parsed = IntelItemSchema.safeParse({
    type: "tender",
    id: "abcdefgh",
    sourceId: "ccgp",
    sourceUrl: "https://www.ccgp.gov.cn/a",
    title: "x",
    publishedAt: "2026-08-01T00:00:00.000Z",
    ingestedAt: "2026-08-01T00:00:00.000Z",
    region: "北京",
    rawText: "body",
    confidence: 0.5,
    verification: verified,
    purchaser: "",
    projectName: "p",
    budget: null,
    budgetText: null,
    serviceType: "other",
    qualification: null,
    deadlineAt: null,
    bidOpenAt: null,
    contact: null,
    biddable: false,
  });
  expect(parsed.success).toBe(false);
});

test("expired tender is not biddable", () => {
  expect(
    isBiddable(
      {
        deadlineAt: "2026-01-01T00:00:00.000Z",
        verification: verified,
      },
      new Date("2026-08-16T00:00:00.000Z"),
    ),
  ).toBe(false);
});
