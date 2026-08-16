import { IntelItemSchema, type IntelItem } from "../domain/intel";
import { getChannel } from "../agents/channels";
import { htmlToDocument } from "../sources/page";
import type { IntelStore } from "../store/db";
import { extractIntel } from "./extract";
import { verifyIntel } from "./verify";

export type IngestInput = {
  sourceId: string;
  sourceUrl: string;
  html?: string;
  text?: string;
};

export type IngestStage = "parse" | "extract" | "relevance" | "verify" | "store";

export type IngestResult =
  | { ok: true; item: IntelItem }
  | { ok: false; error: string; stage: IngestStage };

export type AfterIngest = (item: IntelItem) => void;

export type IngestOptions = {
  decision?: { accept: boolean; reason: string };
};

export async function ingestDocument(
  store: IntelStore,
  input: IngestInput,
  at = new Date(),
  afterIngest?: AfterIngest,
  options: IngestOptions = {},
): Promise<IngestResult> {
  try {
    const channel = getChannel(input.sourceId);
    if (!channel) {
      return { ok: false, stage: "extract", error: `Unknown source: ${input.sourceId}` };
    }
    const doc = htmlToDocument({
      sourceId: channel.id,
      sourceUrl: input.sourceUrl,
      html: input.html,
      text: input.text,
    });
    const extracted = extractIntel(doc, channel.kind);
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
    if (!options.decision?.accept) {
      return {
        ok: false,
        stage: "relevance",
        error: options.decision?.reason ?? "agent_did_not_accept",
      };
    }
    const reviewed: IntelItem = {
      ...verified,
      verification: {
        ...verified.verification,
        checks: [
          { name: "agent_review", ok: true, detail: options.decision.reason },
          ...verified.verification.checks,
        ],
      },
    };
    IntelItemSchema.parse(reviewed);
    const saved = store.upsert(reviewed);
    afterIngest?.(saved);
    return { ok: true, item: saved };
  } catch (error) {
    return {
      ok: false,
      stage: "extract",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
