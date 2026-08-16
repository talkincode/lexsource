import {
  intelId,
  nowIso,
  type IntelItem,
  type LawFirmAngle,
  type MajorCase,
  type Tender,
} from "../domain/intel";
import {
  classifyCaseClass,
  classifyServiceType,
  fieldAfter,
  guessRegion,
  parseBudgetYuan,
  parseChineseDate,
} from "../domain/parse";
import { cleanPageText, cleanTitle, clipField } from "../domain/readability";
import type { RawDocument } from "../sources/types";

export function extractIntel(doc: RawDocument, kind: "tender" | "major_case"): IntelItem {
  if (kind === "tender") return extractTender(doc);
  return extractMajorCase(doc);
}

export function extractTender(doc: RawDocument): Tender {
  const text = cleanPageText(doc.text);
  const title = cleanTitle(doc.titleHint ?? firstLine(text));
  const purchaser =
    clipField(fieldAfter(/(?:采购人|招标人|采购单位)[：:]\s*(.+)/, text), 40) ?? "未知采购人";
  const projectName =
    clipField(fieldAfter(/(?:项目名称|采购项目)[：:]\s*(.+)/, text), 80) ?? title;
  const budgetField = fieldAfter(/(?:预算金额|采购预算|预算)[：:]\s*(.+)/, text);
  const { amount, text: budgetText } = parseBudgetYuan(clipField(budgetField, 48) ?? budgetField);
  const deadlineAt = parseChineseDate(
    clipField(fieldAfter(/(?:投标截止时间|递交截止时间|报名截止时间|截止时间)[：:]\s*(.+)/, text), 40),
  );
  const bidOpenAt = parseChineseDate(clipField(fieldAfter(/(?:开标时间)[：:]\s*(.+)/, text), 40));
  const publishedAt =
    parseChineseDate(clipField(fieldAfter(/(?:发布日期|公告时间|发布时间)[：:]\s*(.+)/, text), 40)) ??
    doc.fetchedAt;
  const qualification = clipField(fieldAfter(/(?:资格要求|投标人资格|申请人资格)[：:]\s*(.+)/, text), 800);
  const contact = clipField(fieldAfter(/(?:联系方式|联系人)[：:]\s*(.+)/, text), 48);

  return {
    type: "tender",
    id: intelId(doc.sourceId, doc.sourceUrl),
    sourceId: doc.sourceId,
    sourceUrl: doc.sourceUrl,
    title,
    publishedAt,
    ingestedAt: nowIso(),
    region: guessRegion(`${title}\n${text}`),
    rawText: text,
    confidence: scoreTender({ purchaser, deadlineAt, amount, qualification }),
    verification: { status: "pending", checks: [] },
    purchaser,
    projectName,
    budget: amount,
    budgetText,
    serviceType: classifyServiceType(title, text),
    qualification,
    deadlineAt,
    bidOpenAt,
    contact,
    biddable: false,
  };
}

export function extractMajorCase(doc: RawDocument): MajorCase {
  const text = cleanPageText(doc.text);
  const title = cleanTitle(doc.titleHint ?? firstLine(text));
  const summary =
    fieldAfter(/(?:裁判要点|基本案情|案情摘要)[：:]\s*([\s\S]+?)(?:\n\s*(?:裁判理由|相关法条|指导意义)|$)/, text) ??
    text.slice(0, 400);
  const holding = clipField(fieldAfter(/(?:裁判要点)[：:]\s*(.+)/, text), 400);
  const court = clipField(fieldAfter(/(?:审理法院|法院)[：:]\s*(.+)/, text), 40);
  const statutes = collectStatutes(text);
  const issues = collectIssues(text);
  const caseClass = classifyCaseClass(title, text);
  const angles = inferAngles(caseClass, text);

  const briefMarkdown = [
    `# ${title}`,
    "",
    `- 案例类型：${caseClass}`,
    court ? `- 审理法院：${court}` : null,
    `- 来源：${doc.sourceUrl}`,
    "",
    "## 摘要",
    "",
    summary.trim(),
    "",
    holding ? "## 裁判要旨\n\n" + holding.trim() : null,
    issues.length ? "## 争议焦点\n\n" + issues.map((item) => `- ${item}`).join("\n") : null,
    statutes.length ? "## 涉及法条\n\n" + statutes.map((item) => `- ${item}`).join("\n") : null,
    "",
    "## 律所可用角度",
    "",
    angles.map((angle) => `- ${angle}`).join("\n"),
  ]
    .filter((line) => line !== null)
    .join("\n");

  return {
    type: "major_case",
    id: intelId(doc.sourceId, doc.sourceUrl),
    sourceId: doc.sourceId,
    sourceUrl: doc.sourceUrl,
    title,
    publishedAt:
      parseChineseDate(fieldAfter(/(?:发布日期|发布时间)[：:]\s*(.+)/, text)) ?? doc.fetchedAt,
    ingestedAt: nowIso(),
    region: guessRegion(`${title}\n${text}`),
    rawText: text,
    confidence: summary.length > 40 ? 0.82 : 0.55,
    verification: { status: "pending", checks: [] },
    caseClass,
    court,
    summary: summary.trim(),
    issues,
    statutes,
    holding,
    stage: clipField(fieldAfter(/(?:审理程序|程序阶段)[：:]\s*(.+)/, text), 24),
    lawFirmAngles: angles,
    briefMarkdown,
  };
}

function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "未命名条目";
}

function scoreTender(input: {
  purchaser: string;
  deadlineAt: string | null;
  amount: number | null;
  qualification: string | null;
}): number {
  let score = 0.4;
  if (input.purchaser !== "未知采购人") score += 0.2;
  if (input.deadlineAt) score += 0.2;
  if (input.amount != null) score += 0.1;
  if (input.qualification) score += 0.1;
  return Number(score.toFixed(2));
}

function collectStatutes(text: string): string[] {
  const found = text.match(/《[^》]{2,40}》(?:第[一二三四五六七八九十百千0-9]+条)?/g) ?? [];
  return [...new Set(found)].slice(0, 12);
}

function collectIssues(text: string): string[] {
  const block = fieldAfter(/(?:争议焦点)[：:]\s*([\s\S]+?)(?:\n\s*(?:裁判要点|相关法条)|$)/, text);
  if (!block) return [];
  return block
    .split(/\n|；|;/)
    .map((item) => item.replace(/^[0-9一二三四五六七八九十、.\s]+/, "").trim())
    .filter((item) => item.length >= 4)
    .slice(0, 8);
}

function inferAngles(caseClass: MajorCase["caseClass"], text: string): LawFirmAngle[] {
  const angles = new Set<LawFirmAngle>(["precedent"]);
  if (caseClass === "public_impact" || /舆论|社会影响|典型意义/.test(text)) {
    angles.add("marketing");
  }
  if (/风险|合规|警示|应当注意/.test(text)) angles.add("risk");
  return [...angles];
}
