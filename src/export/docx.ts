import { Document, Packer, Paragraph, TextRun } from "docx";
import type { IntelItem } from "../domain/intel";
import { toMarkdown } from "./markdown";

export async function toDocx(item: IntelItem): Promise<Uint8Array> {
  const markdown = toMarkdown(item);
  const paragraphs = markdown.split("\n").map((line) => {
    if (line.startsWith("# ")) {
      return new Paragraph({
        children: [new TextRun({ text: line.slice(2), bold: true, size: 36, font: "Songti SC" })],
        spacing: { after: 240 },
      });
    }
    if (line.startsWith("## ")) {
      return new Paragraph({
        children: [new TextRun({ text: line.slice(3), bold: true, size: 28, font: "Songti SC" })],
        spacing: { before: 240, after: 120 },
      });
    }
    return new Paragraph({
      children: [new TextRun({ text: line.length ? line : " ", size: 22, font: "Songti SC" })],
      spacing: { after: 80 },
    });
  });

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
