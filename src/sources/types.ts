export type SourceKind = "tender" | "major_case";

export type RawDocument = {
  sourceId: string;
  sourceUrl: string;
  fetchedAt: string;
  titleHint?: string;
  html?: string;
  text: string;
};

export type SourceAdapter = {
  id: string;
  name: string;
  kind: SourceKind;
  region: string;
  description: string;
  parse(input: { html?: string; text?: string; sourceUrl: string }): RawDocument;
};
