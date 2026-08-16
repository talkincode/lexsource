const CN_DATE =
  /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})\s*[时:：]\s*(\d{1,2})\s*分?)?/;
const ISO_DATE = /(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

export function parseChineseDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = input.trim();
  const cn = text.match(CN_DATE);
  if (cn) {
    const year = Number(cn[1]);
    const month = Number(cn[2]);
    const day = Number(cn[3]);
    const hour = Number(cn[4] ?? 23);
    const minute = Number(cn[5] ?? 59);
    const date = new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0));
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }
  const iso = text.match(ISO_DATE);
  if (iso) {
    const date = new Date(
      `${iso[1]}T${iso[2] ?? "23"}:${iso[3] ?? "59"}:${iso[4] ?? "00"}+08:00`,
    );
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }
  return null;
}

export function parseBudgetYuan(input: string | null | undefined): {
  amount: number | null;
  text: string | null;
} {
  if (!input) return { amount: null, text: null };
  const text = input.replace(/\s+/g, " ").trim();
  if (!text) return { amount: null, text: null };

  const wan = text.match(/([\d,.]+)\s*万元/);
  if (wan?.[1]) {
    const n = Number(wan[1].replace(/,/g, ""));
    return { amount: Number.isFinite(n) ? Math.round(n * 10_000) : null, text: `${wan[1]}万元` };
  }
  const yuan = text.match(/([\d,.]+)\s*元/);
  if (yuan?.[1]) {
    const n = Number(yuan[1].replace(/,/g, ""));
    return { amount: Number.isFinite(n) ? Math.round(n) : null, text: `${yuan[1]}元` };
  }
  const bare = text.match(/([\d,.]+)/);
  if (bare?.[1] && /万/.test(text)) {
    const n = Number(bare[1].replace(/,/g, ""));
    return { amount: Number.isFinite(n) ? Math.round(n * 10_000) : null, text: `${bare[1]}万` };
  }
  return { amount: null, text: text.length > 24 ? text.slice(0, 24) : text };
}

export function fieldAfter(label: RegExp, text: string): string | null {
  const match = text.match(label);
  if (!match) return null;
  const raw = (match[1] ?? "").replace(/\s+/g, " ").trim();
  return raw.length > 0 ? raw : null;
}

export function classifyServiceType(title: string, body: string): "general_counsel" | "special_project" | "litigation" | "other" {
  const hay = `${title}\n${body}`;
  if (/诉讼|仲裁|代理/.test(hay)) return "litigation";
  if (/法律顾问|常年法律|常法/.test(hay)) return "general_counsel";
  if (/专项|尽职调查|合规|破产|重组|并购/.test(hay)) return "special_project";
  return "other";
}

export function classifyCaseClass(title: string, body: string): "guiding" | "gazette" | "reference" | "public_impact" {
  const hay = `${title}\n${body}`;
  if (/指导性案例/.test(hay)) return "guiding";
  if (/公报案例|法院公报/.test(hay)) return "gazette";
  if (/参考性案例/.test(hay)) return "reference";
  return "public_impact";
}

export function guessRegion(text: string): string {
  const match = text.match(
    /(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|内蒙古|广西|西藏|宁夏|新疆|深圳|广州|杭州|南京|成都|武汉|西安|全国)/,
  );
  return match?.[1] ?? "全国";
}
