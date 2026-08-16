import {
  IntelItemSchema,
  isBiddable,
  type Check,
  type IntelItem,
  type Tender,
  type Verification,
} from "../domain/intel";

const BLOCKED_HOSTS = ["wenshu.court.gov.cn", "wenshu.court.gov.cn."];

export function verifyIntel(item: IntelItem, at = new Date()): IntelItem {
  const checks: Check[] = [];

  const parsed = IntelItemSchema.safeParse(item);
  checks.push({
    name: "schema",
    ok: parsed.success,
    detail: parsed.success ? "IntelItem schema 通过" : flattenZod(parsed.error),
  });

  checks.push({
    name: "source_url",
    ok: /^https?:\/\//.test(item.sourceUrl),
    detail: item.sourceUrl,
  });

  const blocked = BLOCKED_HOSTS.some((host) => item.sourceUrl.includes(host));
  checks.push({
    name: "source_allowed",
    ok: !blocked,
    detail: blocked ? "禁止以裁判文书网作为自动采集源" : "来源不在禁采名单",
  });

  if (item.type === "tender") {
    checks.push(...verifyTender(item, at));
  } else {
    checks.push({
      name: "brief",
      ok: item.briefMarkdown.includes(item.title) && item.summary.length >= 8,
      detail: item.summary.length >= 8 ? "案例 brief 已生成" : "摘要过短",
    });
    checks.push({
      name: "statutes_or_holding",
      ok: item.statutes.length > 0 || Boolean(item.holding),
      detail:
        item.statutes.length > 0 || item.holding
          ? "已提取法条或裁判要旨"
          : "缺少法条与裁判要旨，需人工复核",
    });
  }

  const verification = decide(checks);
  if (item.type === "tender") {
    return {
      ...item,
      verification,
      biddable: isBiddable({ ...item, verification }, at),
    };
  }
  return { ...item, verification };
}

function verifyTender(item: Tender, at: Date): Check[] {
  const checks: Check[] = [];
  checks.push({
    name: "purchaser",
    ok: item.purchaser !== "未知采购人",
    detail: item.purchaser,
  });
  checks.push({
    name: "deadline",
    ok: Boolean(item.deadlineAt),
    detail: item.deadlineAt ?? "未抽取到投标截止时间，不得进入可投标列表",
  });

  if (item.deadlineAt) {
    const deadline = Date.parse(item.deadlineAt);
    checks.push({
      name: "deadline_parseable",
      ok: !Number.isNaN(deadline),
      detail: item.deadlineAt,
    });
    checks.push({
      name: "deadline_future",
      ok: !Number.isNaN(deadline) && deadline > at.getTime(),
      detail:
        !Number.isNaN(deadline) && deadline > at.getTime()
          ? "截止时间未过"
          : "截止时间已过，仅作档案保留",
    });
  }

  if (item.budgetText && item.budget != null) {
    const wan = (item.budget / 10_000).toString();
    const mentioned =
      item.rawText.includes(item.budgetText) ||
      item.rawText.includes(item.budget.toString()) ||
      item.rawText.includes(wan);
    checks.push({
      name: "budget_consistent",
      ok: mentioned,
      detail: mentioned
        ? `预算 ${item.budget} 元与原文一致`
        : "预算数字未能在原文中回查到，需人工复核",
    });
  } else {
    checks.push({
      name: "budget_present",
      ok: item.budget != null,
      detail: item.budget != null ? String(item.budget) : "未抽取到预算",
    });
  }

  return checks;
}

function decide(checks: Check[]): Verification {
  const hardFailed = checks.some(
    (check) => !check.ok && (check.name === "schema" || check.name === "source_allowed"),
  );
  if (hardFailed) return { status: "failed", checks };
  const review = checks.some((check) => !check.ok);
  return { status: review ? "needs_review" : "verified", checks };
}

function flattenZod(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}
