import {
  CASE_CLASS_LABEL,
  SERVICE_TYPE_LABEL,
  type IntelItem,
} from "../domain/intel";

export function toMarkdown(item: IntelItem): string {
  if (item.type === "major_case") return item.briefMarkdown.trim() + "\n";

  const lines = [
    `# ${item.title}`,
    "",
    `- 类型：招标情报`,
    `- 采购人：${item.purchaser}`,
    `- 项目：${item.projectName}`,
    `- 地域：${item.region}`,
    `- 服务类型：${SERVICE_TYPE_LABEL[item.serviceType]}`,
    `- 预算：${item.budgetText ?? (item.budget != null ? `${item.budget} 元` : "未披露")}`,
    `- 截止时间：${item.deadlineAt ?? "未抽取"}`,
    `- 开标时间：${item.bidOpenAt ?? "未披露"}`,
    `- 可投标：${item.biddable ? "是" : "否"}`,
    `- 验证状态：${item.verification.status}`,
    `- 来源：${item.sourceUrl}`,
    item.qualification ? `- 资格要求：${item.qualification}` : null,
    item.contact ? `- 联系方式：${item.contact}` : null,
    "",
    "## 验证检查",
    "",
    ...item.verification.checks.map((check) => `- [${check.ok ? "x" : " "}] ${check.name} — ${check.detail}`),
    "",
    "## 原文摘录",
    "",
    item.rawText.trim(),
    "",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

export function toCaseLabel(item: IntelItem): string {
  return item.type === "major_case" ? CASE_CLASS_LABEL[item.caseClass] : SERVICE_TYPE_LABEL[item.serviceType];
}
