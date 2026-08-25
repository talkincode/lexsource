/**
 * 将 REVIEW.md 转为可在 Word / WPS 打开的 docx。
 * bun 交付/build-docx.ts
 */
import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, ShadingType } from "docx";

const SONG = { ascii: "Times New Roman", eastAsia: "宋体", hAnsi: "Times New Roman" };
const HEI = { ascii: "Arial", eastAsia: "黑体", hAnsi: "Arial" };

function runs(text: string, opts: { bold?: boolean; font?: typeof SONG; size?: number; color?: string } = {}) {
  const font = opts.font ?? SONG;
  const size = opts.size ?? 24;
  const parts: TextRun[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      parts.push(new TextRun({ text: text.slice(last, m.index), font, size, bold: opts.bold, color: opts.color }));
    }
    parts.push(new TextRun({ text: m[1], font, size, bold: true, color: opts.color }));
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(new TextRun({ text: text.slice(last), font, size, bold: opts.bold, color: opts.color }));
  }
  if (parts.length === 0) parts.push(new TextRun({ text: " ", font, size }));
  return parts;
}

function para(text: string, kind: "h1" | "h2" | "h3" | "body" | "label" | "quote" | "meta") {
  if (kind === "h1") {
    return new Paragraph({
      children: runs(text, { font: HEI, size: 32, bold: true }),
      spacing: { before: 360, after: 200 },
      alignment: AlignmentType.CENTER,
    });
  }
  if (kind === "h2") {
    return new Paragraph({
      children: runs(text, { font: HEI, size: 28, bold: true }),
      spacing: { before: 320, after: 140 },
    });
  }
  if (kind === "h3") {
    return new Paragraph({
      children: runs(text, { font: HEI, size: 24, bold: true }),
      spacing: { before: 240, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1F4E79" } },
    });
  }
  if (kind === "label") {
    return new Paragraph({
      children: runs(text, { font: HEI, size: 22, bold: true, color: "1F4E79" }),
      spacing: { before: 160, after: 60 },
    });
  }
  if (kind === "quote") {
    return new Paragraph({
      children: runs(text, { font: SONG, size: 24 }),
      spacing: { after: 80 },
      indent: { left: 360 },
      shading: { type: ShadingType.CLEAR, fill: "F4F7FB" },
    });
  }
  if (kind === "meta") {
    return new Paragraph({
      children: runs(text, { font: SONG, size: 22, color: "666666" }),
      spacing: { after: 80 },
    });
  }
  return new Paragraph({
    children: runs(text.length ? text : " ", { font: SONG, size: 24 }),
    spacing: { after: 80 },
    alignment: AlignmentType.LEFT,
  });
}

function markdownToParagraphs(md: string): Paragraph[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Paragraph[] = [];
  let inQuote = false;
  let quoteBuf: string[] = [];

  const flushQuote = () => {
    if (!quoteBuf.length) return;
    for (const q of quoteBuf) out.push(para(q, "quote"));
    quoteBuf = [];
    inQuote = false;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith(">")) {
      inQuote = true;
      quoteBuf.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (inQuote) flushQuote();

    if (line.startsWith("# ")) {
      out.push(para(line.slice(2), "h1"));
      continue;
    }
    if (line.startsWith("## ")) {
      out.push(para(line.slice(3), "h2"));
      continue;
    }
    if (line.startsWith("### ")) {
      out.push(para(line.slice(4), "h3"));
      continue;
    }
    if (line === "---") {
      out.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: " ", size: 8 })] }));
      continue;
    }
    if (/^\*\*原文规定：\*\*/.test(line) || line === "**原文规定：**") {
      out.push(para("原文规定", "label"));
      continue;
    }
    if (/^\*\*风险点：\*\*/.test(line) || line === "**风险点：**") {
      out.push(para("风险点", "label"));
      continue;
    }
    if (/^\*\*修改后条文：\*\*/.test(line) || line === "**修改后条文：**") {
      out.push(para("修改后条文", "label"));
      continue;
    }
    if (line.startsWith("|") && line.includes("|")) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.every((c) => /^[-:]+$/.test(c))) continue;
      out.push(para(cells.join("  ｜  "), "body"));
      continue;
    }
    if (!line) {
      out.push(para(" ", "body"));
      continue;
    }
    out.push(para(line, "body"));
  }
  flushQuote();
  return out;
}

const md = await Bun.file("/workspace/REVIEW.md").text();
const children = markdownToParagraphs(md);

const doc = new Document({
  styles: {
    default: {
      document: {
        styles: [
          {
            id: "Normal",
            run: { font: "宋体", size: 24 },
          },
        ],
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
        },
      },
      children,
    },
  ],
});

const buf = await Packer.toBuffer(doc);
const files = [
  "/workspace/交付/xiugai.docx",
  "/workspace/交付/承包协议书与内部合作协议对照修改稿.docx",
  "/workspace/deliverables/desheng-clause-redline.docx",
];
for (const p of files) {
  await Bun.write(p, buf);
  console.log("wrote", p, buf.byteLength);
}
