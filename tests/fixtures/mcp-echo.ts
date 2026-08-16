const decoder = new TextDecoder();
let buffer = "";

async function send(message: Record<string, unknown>) {
  await Bun.write(Bun.stdout, `${JSON.stringify(message)}\n`);
}

for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (parsed.method === "initialize") {
      await send({ jsonrpc: "2.0", id: parsed.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "echo", version: "0" } } });
    } else if (parsed.method === "tools/list") {
      await send({
        jsonrpc: "2.0",
        id: parsed.id,
        result: {
          tools: [
            {
              name: "browser_navigate",
              description: "open a page",
              inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
            },
          ],
        },
      });
    } else if (parsed.method === "tools/call") {
      await send({
        jsonrpc: "2.0",
        id: parsed.id,
        result: { content: [{ type: "text", text: `opened:${parsed.params?.arguments?.url ?? ""}` }] },
      });
    }
  }
}
