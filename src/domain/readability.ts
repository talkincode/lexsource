import { parseBudgetYuan } from "./parse";
import type { IntelItem, MajorCase, Tender } from "./intel";

const NEXT_LABEL =
  /(?:采购人|招标人|采购单位|项目名称|采购项目|预算金额|采购预算|投标截止时间|递交截止时间|报名截止时间|截止时间|开标时间|发布日期|公告时间|发布时间|资格要求|投标人资格|申请人资格|联系方式|联系人|服务地点|项目编号|代理机构)[：:]/;

const NEXT_SECTION = /[一二三四五六七八九十]{1,3}、/;

const CHROME_LINE =
  /^(首页|网站地图|登录|注册|English|繁體|收藏本站|无障碍|分享到|打印本页|关闭窗口|当前位置|您现在的位置|版权所有|京ICP|沪ICP|联系我们|网站声明|返回顶部|更多|查看更多|上一篇|下一篇|相关链接|友情链接)$/;

export function clipField(raw: string | null | undefined, max = 80): string | null {
  if (!raw) return null;
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const rest = text.slice(1);
  const labelAt = rest.search(NEXT_LABEL);
  const sectionAt = rest.search(NEXT_SECTION);
  const cuts = [labelAt, sectionAt].filter((n) => n >= 0);
  if (cuts.length) text = text.slice(0, Math.min(...cuts) + 1).trim();
  text = text.replace(/[，,；;：:\s]+$/g, "").trim();
  if (text.length > max) {
    const comma = text.lastIndexOf("，", max);
    text = text.slice(0, comma > 12 ? comma : max).trim();
  }
  return text || null;
}

export function formatYuan(amount: number): string {
  if (amount >= 10_000 && amount % 10_000 === 0) return `${amount / 10_000}万元`;
  if (amount >= 10_000) return `${trimDecimal(amount / 10_000)}万元`;
  return `${amount}元`;
}

export function shortBudgetText(amount: number | null, budgetText: string | null): string | null {
  if (amount != null) return formatYuan(amount);
  const parsed = parseBudgetYuan(clipField(budgetText, 48) ?? budgetText);
  if (parsed.amount != null) return formatYuan(parsed.amount);
  if (parsed.text && parsed.text.length <= 24) return parsed.text;
  return null;
}

export function cleanTitle(title: string): string {
  return title
    .replace(/\s+/g, " ")
    .replace(/(项目|公告|公示)其他$/u, "$1")
    .trim();
}

export function cleanPageText(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && !CHROME_LINE.test(line) && !/^[\|／/>]+$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function announcementSections(text: string): Array<{ title: string; body: string }> {
  const cleaned = cleanPageText(text);
  if (!cleaned) return [];
  const chunks = cleaned.split(/(?=[一二三四五六七八九十]{1,3}、)/);
  const sections: Array<{ title: string; body: string }> = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([一二三四五六七八九十]{1,3}、[^\n。]{0,20})[。\s]*(.*)$/s);
    if (match) {
      sections.push({ title: match[1]!.trim(), body: (match[2] ?? "").trim() });
    } else {
      sections.push({ title: "公告内容", body: trimmed });
    }
  }
  return sections.filter((section) => section.body.length >= 4 || section.title !== "公告内容");
}

export function presentIntel(item: IntelItem): IntelItem {
  if (item.type === "tender") return presentTender(item);
  return presentCase(item);
}

function presentTender(item: Tender): Tender {
  return {
    ...item,
    title: cleanTitle(item.title),
    purchaser: clipField(item.purchaser, 40) ?? item.purchaser,
    projectName: clipField(item.projectName, 80) ?? item.title,
    budgetText: shortBudgetText(item.budget, item.budgetText),
    contact: clipField(item.contact, 48),
    qualification: clipField(item.qualification, 800),
    rawText: cleanPageText(item.rawText),
  };
}

function presentCase(item: MajorCase): MajorCase {
  return {
    ...item,
    title: cleanTitle(item.title),
    court: clipField(item.court, 40),
    stage: clipField(item.stage, 24),
    rawText: cleanPageText(item.rawText),
  };
}

function trimDecimal(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}
