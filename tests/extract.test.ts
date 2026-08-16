import { expect, test } from "bun:test";
import { extractMajorCase, extractTender } from "../src/pipeline/extract";
import { parseBudgetYuan } from "../src/domain/parse";
import { presentIntel, shortBudgetText } from "../src/domain/readability";
import { htmlToDocument } from "../src/sources/page";
import { parseCcgp } from "../src/sources/ccgp";
import { spcAdapter } from "../src/sources/spc";

const now = new Date("2026-08-16T08:00:00.000Z");

test("extracts a CCGP legal-counsel tender from fixture html", async () => {
  const html = await Bun.file(new URL("./fixtures/tenders/ccgp-legal-counsel.html", import.meta.url)).text();
  const doc = parseCcgp({
    html,
    sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
  });
  doc.fetchedAt = now.toISOString();
  const item = extractTender(doc);
  expect(item.purchaser).toBe("某市司法局");
  expect(item.serviceType).toBe("general_counsel");
  expect(item.budget).toBe(865000);
  expect(item.deadlineAt).toContain("2026-12-20");
  expect(item.region).toBe("北京");
  expect(item.qualification).toContain("律师事务所");
});

test("extracts an SPC guiding case brief", async () => {
  const html = await Bun.file(new URL("./fixtures/cases/spc-guiding.html", import.meta.url)).text();
  const doc = spcAdapter.parse({
    html,
    sourceUrl: "https://www.court.gov.cn/zixun/xiangqing/20260801.html",
  });
  const item = extractMajorCase(doc);
  expect(item.caseClass).toBe("guiding");
  expect(item.holding).toContain("独立保函");
  expect(item.statutes.some((s) => s.includes("民法典"))).toBe(true);
  expect(item.lawFirmAngles).toContain("precedent");
  expect(item.briefMarkdown).toContain("裁判要旨");
});

test("run-on announcement does not pour the whole body into budget or purchaser", () => {
  const text =
    "项目名称：海口边检总站法律顾问服务项目采购人：中华人民共和国海口出入境边防检查总站预算金额：99000.00元，高于此预算的报价将被视为无效报价。四、采购内容：选聘总站常年法律顾问单位投标截止时间：2026年8月20日 17时00分资格要求：投标人应当具备律师事务所执业许可证联系人：李警官 0898-66195621";
  const item = extractTender({
    sourceId: "ccgp",
    sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260814_haikou.htm",
    fetchedAt: now.toISOString(),
    titleHint: "海口边检总站法律顾问服务项目其他",
    text,
  });
  expect(item.title).toBe("海口边检总站法律顾问服务项目");
  expect(item.purchaser).toBe("中华人民共和国海口出入境边防检查总站");
  expect(item.budget).toBe(99000);
  expect(item.budgetText).toBe("99000.00元");
  expect(item.budgetText?.includes("采购内容")).toBe(false);
  expect(item.contact).toContain("李警官");
  expect(item.qualification).toContain("律师事务所");
  expect(item.qualification?.includes("联系人")).toBe(false);
});

test("budget parser keeps only the amount phrase", () => {
  const parsed = parseBudgetYuan("99000.00元，高于此预算的报价将被视为无效报价。四、采购内容：选聘顾问");
  expect(parsed.amount).toBe(99000);
  expect(parsed.text).toBe("99000.00元");
});

test("presentIntel repairs already-stored polluted budget text", () => {
  const presented = presentIntel({
    type: "tender",
    id: "abc123456789",
    sourceId: "ccgp",
    sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260814.htm",
    title: "法律顾问服务项目其他",
    publishedAt: now.toISOString(),
    ingestedAt: now.toISOString(),
    region: "海南",
    rawText: "首页\n预算金额：99000.00元，高于此预算的报价将被视为无效报价。四、采购内容：选聘顾问\n版权所有",
    confidence: 0.8,
    verification: { status: "verified", checks: [] },
    purchaser: "海口边检总站预算金额：99000.00元后面还有一长串",
    projectName: "法律顾问服务项目",
    budget: 99000,
    budgetText: "99000.00元，高于此预算的报价将被视为无效报价。四、采购内容：选聘总站常年法律顾问单位",
    serviceType: "general_counsel",
    qualification: "律师事务所",
    deadlineAt: "2026-08-20T09:00:00.000Z",
    bidOpenAt: null,
    contact: "李警官",
    biddable: true,
    suggestions: [],
  });
  expect(presented.type).toBe("tender");
  if (presented.type !== "tender") return;
  expect(presented.title).toBe("法律顾问服务项目");
  expect(presented.purchaser).toBe("海口边检总站");
  expect(presented.budgetText).toBe("9.9万元");
  expect(presented.rawText.includes("首页")).toBe(false);
  expect(shortBudgetText(99000, presented.budgetText)).toBe("9.9万元");
});

test("htmlToDocument drops nav chrome", () => {
  const doc = htmlToDocument({
    sourceId: "ccgp",
    sourceUrl: "https://www.ccgp.gov.cn/cggg/zygg/gkzb/202608/t20260801_000001.htm",
    html: `<html><body><nav>首页 登录 网站地图</nav><h1>法律顾问招标</h1><div class="vF_detail_content">采购人：某市司法局</div><footer>版权所有</footer></body></html>`,
  });
  expect(doc.titleHint).toBe("法律顾问招标");
  expect(doc.text).toContain("某市司法局");
  expect(doc.text.includes("网站地图")).toBe(false);
});
