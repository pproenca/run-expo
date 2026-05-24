import type { ToolTextResult } from "./domain.js";

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }], isError: false };
}

export function unwrapToolJson(result: unknown): unknown {
  const maybe = result as { content?: Array<{ text?: unknown }> } | null | undefined;
  const text = maybe?.content?.[0]?.text;
  if (typeof text !== "string") {
    return result;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
