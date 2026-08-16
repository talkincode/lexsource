export type SourceKind = "tender" | "major_case";

export type RawDocument = {
  sourceId: string;
  sourceUrl: string;
  fetchedAt: string;
  titleHint?: string;
  html?: string;
  text: string;
};

export type FetchErrorCode =
  | "blocked_host"
  | "invalid_url"
  | "http_error"
  | "timeout"
  | "network"
  | "empty_body";

export type FetchResult =
  | {
      ok: true;
      sourceUrl: string;
      html: string;
      status: number;
      fetchedAt: string;
      contentType: string | null;
    }
  | {
      ok: false;
      code: FetchErrorCode;
      message: string;
      sourceUrl: string;
      status?: number;
    };

export type FetchHtml = (url: string) => Promise<FetchResult>;

export type HttpClientOptions = {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  minIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  cookieFor?: (url: string) => string | null | undefined;
};

export type SourceAdapter = {
  id: string;
  name: string;
  kind: SourceKind;
  region: string;
  description: string;
  seedUrl?: string;
  parse(input: { html?: string; text?: string; sourceUrl: string }): RawDocument;
  discover?(html: string, listingUrl: string): string[];
};
