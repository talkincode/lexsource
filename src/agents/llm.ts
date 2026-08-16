export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name?: string; content: string };

export type ChatRequest = {
  messages: ChatMessage[];
  tools: ToolDef[];
  model: string;
};

export type ChatResponse = {
  content?: string | null;
  tool_calls?: ToolCall[];
};

export type CompleteFn = (request: ChatRequest) => Promise<ChatResponse>;
