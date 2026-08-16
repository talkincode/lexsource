import { IntelItemSchema, type IntelItem } from "../domain/intel";
import { getSource } from "../sources/registry";
import type { RawDocument } from "../sources/types";
import type { IntelStore } from "../store/db";
import { extractIntel } from "./extract";
import { verifyIntel } from "./verify";

export type IngestInput = {
  sourceId: string;
  sourceUrl: string;
  html?: string;
  text?: string;
};

export type IngestResult =
  | { ok: true; item: IntelItem }
  | { ok: false; error: string; stage: "parse" | "extract" | "verify" | "store" };

export function ingestDocument(store: IntelStore, input: IngestInput, at = new Date()): IngestResult {
  let doc: RawDocument;
  try {
    const source = getSource(input.sourceId);
    doc = source.parse({
      html: input.html,
      text: input.text,
      sourceUrl: input.sourceUrl,
    });
    const extracted = extractIntel(doc, source.kind);
    const verified = verifyIntel(extracted, at);
    if (verified.verification.status === "failed") {
      return {
        ok: false,
        stage: "verify",
        error: verified.verification.checks
          .filter((check) => !check.ok)
          .map((check) => `${check.name}: ${check.detail}`)
          .join("; "),
      };
    }
    IntelItemSchema.parse(verified);
    const saved = store.upsert(verified);
    return { ok: true, item: saved };
  } catch (error) {
    return {
      ok: false,
      stage: "extract",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
