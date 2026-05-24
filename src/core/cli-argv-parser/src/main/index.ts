import {
  CliUsageError,
  EXIT_INVALID_USAGE,
} from "../../../cli-error-classification/src/main/index.ts";

export { CliUsageError, EXIT_INVALID_USAGE };

export interface ParsedCliArgs {
  globals: CliGlobals;
  command: string | null;
  args: CliArgs;
}

export interface CliArgs extends Record<string, unknown> {
  _: unknown[];
}

export interface CliGlobals extends Record<string, unknown> {
  json: boolean;
  plain: boolean;
  quiet: boolean;
  verbose: boolean;
  debug: boolean;
  noColor: boolean;
  noInput: boolean;
  record: boolean;
  version: boolean;
  help: boolean;
  root: string | null;
  stateDir: string | null;
  actionPolicy: string | null;
  maxOutput: string | null;
  contentBoundaries: boolean;
  allowRuntimeEval: string | null;
  confirmActions: string | null;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args: CliArgs = { _: [] };
  const globals = defaultGlobals();
  let command: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (token === "--") {
      args._.push(...argv.slice(index + 1));
      break;
    }

    if (token === "--help" || token === "-h") {
      globals.help = true;
      continue;
    }

    if (token === "--version") {
      globals.version = true;
      continue;
    }

    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const rawKey = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const globalKey = normalizeGlobalFlag(rawKey);

      if (globalKey) {
        if (globalFlagTakesValue(rawKey)) {
          const value = eq === -1 ? argv[index + 1] : token.slice(eq + 1);
          if (value === undefined || value.startsWith("--")) {
            throw new CliUsageError(`--${rawKey} requires a value.`);
          }
          if (eq === -1) index += 1;
          globals[globalKey] = String(value);
        } else {
          globals[globalKey] = true;
        }
        continue;
      }

      if (!command) {
        throw new CliUsageError(`Global flag or command expected before --${rawKey}.`);
      }

      const key = toCamel(rawKey);
      const schemaValue = eq === -1 ? argv[index + 1] : token.slice(eq + 1);
      if (eq === -1 && (schemaValue === undefined || schemaValue.startsWith("--"))) {
        args[key] = true;
      } else {
        if (eq === -1) index += 1;
        args[key] = coerceCliValue(String(schemaValue));
      }
      continue;
    }

    if (!command) {
      command = token;
      continue;
    }

    args._.push(token);
  }

  return { globals, command, args };
}

export function defaultGlobals(): CliGlobals {
  return {
    json: false,
    plain: false,
    quiet: false,
    verbose: false,
    debug: false,
    noColor: false,
    noInput: false,
    record: false,
    version: false,
    help: false,
    root: null,
    stateDir: null,
    actionPolicy: null,
    maxOutput: null,
    contentBoundaries: false,
    allowRuntimeEval: null,
    confirmActions: null,
  };
}

export function normalizeGlobalFlag(rawKey: string): keyof CliGlobals | null {
  switch (rawKey) {
    case "json":
    case "plain":
    case "quiet":
    case "verbose":
    case "debug":
    case "record":
      return rawKey;
    case "content-boundaries":
      return "contentBoundaries";
    case "root":
      return "root";
    case "state-dir":
      return "stateDir";
    case "action-policy":
      return "actionPolicy";
    case "max-output":
      return "maxOutput";
    case "allow-runtime-eval":
      return "allowRuntimeEval";
    case "confirm-actions":
      return "confirmActions";
    case "no-color":
      return "noColor";
    case "no-input":
      return "noInput";
    default:
      return null;
  }
}

export function globalFlagTakesValue(rawKey: string): boolean {
  return (
    rawKey === "root" ||
    rawKey === "state-dir" ||
    rawKey === "action-policy" ||
    rawKey === "max-output" ||
    rawKey === "allow-runtime-eval" ||
    rawKey === "confirm-actions"
  );
}

export function coerceCliValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function parseJsonArgument(value: string, flag: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${flag} must be valid JSON: ${formatError(error)}`);
  }
}

export function pickDefined(object: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

export function toCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

export function formatError(error: unknown): string {
  if (!error) return "Unknown error";
  const record = error as { message?: unknown };
  return String(record.message ?? error);
}
