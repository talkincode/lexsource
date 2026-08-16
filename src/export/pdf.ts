import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { IntelItem } from "../domain/intel";
import { toMarkdown } from "./markdown";

export async function toPdf(item: IntelItem): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Courier);
  const pageSize: [number, number] = [595.28, 841.89];
  let page = pdf.addPage(pageSize);
  const margin = 48;
  const fontSize = 10;
  const lineHeight = 14;
  let y = page.getHeight() - margin;
  const maxWidth = page.getWidth() - margin * 2;

  const lines = wrapText(toMarkdown(item), font, fontSize, maxWidth);
  for (const line of lines) {
    if (y < margin) {
      page = pdf.addPage(pageSize);
      y = page.getHeight() - margin;
    }
    page.drawText(line.length ? asciiSafe(line) : " ", {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0.12, 0.1, 0.08),
    });
    y -= lineHeight;
  }
  return pdf.save();
}

function wrapText(
  text: string,
  font: { widthOfTextAtSize(text: string, size: number): number },
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const safe = asciiSafe(raw);
    if (!safe) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of safe.split(/(\s+)/)) {
      const next = current + word;
      if (font.widthOfTextAtSize(next, size) > maxWidth && current.trim()) {
        lines.push(current.trimEnd());
        current = word.trimStart();
      } else {
        current = next;
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

function asciiSafe(text: string): string {
  return text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (ch) => {
    const code = ch.codePointAt(0);
    return code ? `\\u${code.toString(16)}` : "?";
  });
}
