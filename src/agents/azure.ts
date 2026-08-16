import type { ChatMessage, ChatResponse, ToolDef } from "./llm";

export type AzureOpenAIConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
};

const DEFAULT_MODEL = "DeepSeek-V4-Flash";

export function loadAzureOpenAIConfig(
  env: Record<string, string | undefined> = process.env,
  options: { readKeychain?: boolean } = {},
): AzureOpenAIConfig | null {
  const apiUrl = firstNonEmpty([
    env.LEXSOURCE_AZURE_OPENAI_API_URL,
    env.AZURE_OPENAI_API_URL,
    options.readKeychain === false ? undefined : keychain("AZURE_OPENAI_API_URL"),
    options.readKeychain === false ? undefined : keychain("AZURE_FOUNDRY_API_URL"),
  ]);
  const apiKey = firstNonEmpty([
    env.LEXSOURCE_AZURE_OPENAI_API_KEY,
    env.AZURE_OPENAI_API_KEY,
    options.readKeychain === false ? undefined : keychain("AZURE_OPENAI_API_KEY"),
  ]);
  if (!apiUrl || !apiKey) return null;
  const model =
    firstNonEmpty([
      env.LEXSOURCE_AZURE_OPENAI_MODEL,
      env.AZURE_OPENAI_MODEL,
      env.AZURE_OPENAI_DEPLOYMENT,
      deploymentFromUrl(apiUrl),
    ]) ?? DEFAULT_MODEL;
  return { apiUrl, apiKey, model };
}

export function resolveChatCompletionsUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim();
  const url = new URL(trimmed);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path.includes("/chat/completions")) return url.toString();
  if (path.includes("/deployments/")) {
    url.pathname = `${path}/chat/completions`;
    if (!url.searchParams.has("api-version")) url.searchParams.set("api-version", "2024-12-01-preview");
    return url.toString();
  }
  if (path === "/" || path === "") {
    url.pathname = "/openai/v1/chat/completions";
    return url.toString();
  }
  url.pathname = `${path}/chat/completions`;
  return url.toString();
}

export async function azureChatCompletion(
  config: AzureOpenAIConfig,
  messages: ChatMessage[],
  tools?: ToolDef[],
): Promise<ChatResponse> {
  const url = resolveChatCompletionsUrl(config.apiUrl);
  const body: Record<string, unknown> = {
    model: config.model,
    temperature: 0,
    messages: messages.map(toAzureMessage),
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": config.apiKey,
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`azure_http_${response.status}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: ChatResponse["tool_calls"];
      };
    }>;
  };
  const message = data.choices?.[0]?.message;
  return {
    content: message?.content ?? null,
    tool_calls: message?.tool_calls,
  };
}

function toAzureMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.tool_call_id,
      content: message.content,
    };
  }
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content ?? "",
      tool_calls: message.tool_calls,
    };
  }
  return { role: message.role, content: message.content };
}

function deploymentFromUrl(apiUrl: string): string | undefined {
  try {
    const path = new URL(apiUrl).pathname;
    return path.match(/\/deployments\/([^/]+)/)?.[1];
  } catch {
    return undefined;
  }
}

function firstNonEmpty(values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function keychain(service: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  const result = Bun.spawnSync(["security", "find-generic-password", "-s", service, "-w"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return undefined;
  const value = result.stdout.toString().trim();
  return value || undefined;
}
