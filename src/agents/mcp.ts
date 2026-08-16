import type { ToolDef } from "./llm";

export type McpServerSpec = {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpSession = {
  tools: ToolDef[];
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
  has: (name: string) => boolean;
};

type JsonRpc = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

export function mcpServersFromEnv(env: Record<string, string | undefined> = process.env): McpServerSpec[] {
  const raw = env.LEXSOURCE_MCP_SERVERS?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as McpServerSpec[];
      return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.command) : [];
    } catch {
      return [];
    }
  }
  if (env.LEXSOURCE_MCP_PLAYWRIGHT === "1") {
    return [{ id: "playwright", command: "npx", args: ["-y", "@playwright/mcp@latest"] }];
  }
  return [];
}

export async function openMcpSession(
  specs: McpServerSpec[],
  spawnFn: typeof Bun.spawn = Bun.spawn,
): Promise<McpSession> {
  const sessions = await Promise.all(specs.map((spec) => startOne(spec, spawnFn)));
  const tools: ToolDef[] = [];
  const routes = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  for (const session of sessions) {
    for (const tool of session.tools) {
      const name = tool.function.name;
      tools.push(tool);
      routes.set(name, (args) => session.call(name, args));
    }
  }
  return {
    tools,
    has: (name) => routes.has(name),
    call: async (name, args) => {
      const fn = routes.get(name);
      if (!fn) return { error: `unknown_mcp_tool:${name}` };
      return fn(args);
    },
    close: async () => {
      await Promise.all(sessions.map((session) => session.close()));
    },
  };
}

async function startOne(
  spec: McpServerSpec,
  spawnFn: typeof Bun.spawn,
): Promise<McpSession> {
  const proc = spawnFn({
    cmd: [spec.command, ...(spec.args ?? [])],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...spec.env },
  });
  let nextId = 1;
  const pending = new Map<number, (value: JsonRpc) => void>();
  const reader = readJsonLines(proc.stdout, (message) => {
    if (message.id != null && pending.has(message.id)) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });

  const callRpc = async (method: string, params?: unknown) => {
    const id = nextId++;
    const wait = new Promise<JsonRpc>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`mcp_timeout:${spec.id}:${method}`));
      }, 30_000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    proc.stdin.write(payload);
    const reply = await wait;
    if (reply.error) throw new Error(reply.error.message ?? `mcp_error:${method}`);
    return reply.result;
  };

  await callRpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "lexsource", version: "0.2.3" },
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const listed = (await callRpc("tools/list", {})) as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
  const tools: ToolDef[] = (listed.tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: `[MCP:${spec.id}] ${tool.description ?? tool.name}`,
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  }));

  return {
    tools,
    has: (name) => tools.some((tool) => tool.function.name === name),
    call: async (name, args) => {
      const result = await callRpc("tools/call", { name, arguments: args });
      return result ?? { ok: true };
    },
    close: async () => {
      try {
        proc.stdin.end();
      } catch {
        // already closed
      }
      proc.kill();
      await reader.catch(() => undefined);
    },
  };
}

async function readJsonLines(
  stdout: ReadableStream<Uint8Array>,
  onMessage: (message: JsonRpc) => void,
): Promise<void> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        onMessage(JSON.parse(trimmed) as JsonRpc);
      } catch {
        // ignore non-JSON chatter
      }
    }
  }
}
