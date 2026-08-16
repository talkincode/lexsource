export function isReviewedLegalIntel(item: {
  type: string;
  verification: { checks: Array<{ name: string; ok: boolean }> };
}): boolean {
  return item.verification.checks.some((check) => check.name === "agent_review" && check.ok);
}
