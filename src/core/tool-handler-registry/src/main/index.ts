import { TOOL_HANDLER_BINDINGS } from "../../../command-surface/src/main/index.ts";

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;
export type ToolHandlerImplementations = Record<string, unknown>;
export type { ToolHandlerBinding } from "../../../command-surface/src/main/index.ts";
export { TOOL_HANDLER_BINDINGS };

export function toolNames(): string[] {
  return TOOL_HANDLER_BINDINGS.map(([toolName]) => toolName);
}

export function handlerSymbols(): string[] {
  return TOOL_HANDLER_BINDINGS.map(([, handlerSymbol]) => handlerSymbol);
}

export function handlerSymbolByTool(toolName: string): string | null {
  return TOOL_HANDLER_BINDINGS.find(([candidate]) => candidate === toolName)?.[1] ?? null;
}

export function toolsForHandlerSymbol(handlerSymbol: string): string[] {
  return TOOL_HANDLER_BINDINGS.filter(([, candidate]) => candidate === handlerSymbol).map(
    ([toolName]) => toolName,
  );
}

export function bindHandlers(
  implementations: ToolHandlerImplementations,
): Record<string, ToolHandler> {
  const missing = handlerSymbols().filter(
    (handlerSymbol) => implementations[handlerSymbol] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(`Missing handler implementations: ${missing.join(", ")}`);
  }
  const nonFunctions = handlerSymbols().filter(
    (handlerSymbol) => typeof implementations[handlerSymbol] !== "function",
  );
  if (nonFunctions.length > 0) {
    throw new Error(`Handler implementations must be functions: ${nonFunctions.join(", ")}`);
  }
  return Object.fromEntries(
    TOOL_HANDLER_BINDINGS.map(([toolName, handlerSymbol]) => [
      toolName,
      implementations[handlerSymbol] as ToolHandler,
    ]),
  );
}
