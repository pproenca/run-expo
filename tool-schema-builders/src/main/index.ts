export type JsonSchema =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | EnumSchema
  | ObjectSchema;

export interface StringSchema {
  type: "string";
  description: string;
}

export interface NumberSchema {
  type: string;
  description: string;
  [key: string]: unknown;
}

export interface BooleanSchema {
  type: "boolean";
  description: string;
}

export interface EnumSchema {
  type: "string";
  enum: readonly unknown[];
  description: string;
}

export interface ObjectSchema {
  type: "object";
  properties: Record<string, JsonSchema>;
  required: readonly string[];
  additionalProperties: false;
}

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

export function stringSchema(description: string): StringSchema {
  return { type: "string", description };
}

export function numberSchema(description: string, extra: Record<string, unknown> = {}): NumberSchema {
  return { type: "number", description, ...extra };
}

export function booleanSchema(description: string): BooleanSchema {
  return { type: "boolean", description };
}

export function enumSchema(values: readonly unknown[], description: string): EnumSchema {
  return { type: "string", enum: values, description };
}

export function objectSchema(
  properties: Record<string, JsonSchema>,
  required: readonly string[] = [],
): ObjectSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export function toolText(text: string, isError = false): ToolTextResult {
  return { content: [{ type: "text", text }], isError };
}

export function toolJson(value: unknown): ToolTextResult {
  return toolText(`${JSON.stringify(value, null, 2)}\n`);
}

export function unwrapToolJson(result: unknown): unknown {
  const text = (result as { content?: Array<{ text?: unknown }> } | null | undefined)?.content?.[0]?.text;
  if (typeof text !== "string") return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
