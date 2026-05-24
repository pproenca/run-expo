import { execFile as nodeExecFile } from "node:child_process";

import { parseCliArgs, parseJsonArgument } from "./cli.js";
import { commandAliases, commandArgs } from "./command-map.js";
import { batchStepError, truncate } from "./errors.js";
import { redactValue } from "./errors.js";
import { CliUsageError } from "./domain.js";
import type { BatchDependencies, BatchPayload, RunToolOptions, ToolTextResult } from "./domain.js";
import { toolJson, unwrapToolJson } from "./tool-json.js";

/**
 * RULE-023: batch steps run serially, share root/state by default, and can
 * bail after the first failure. The bundled CLI injects the current handler
 * registry so package execution stays in-process; the CLI subprocess adapter is
 * retained for direct module use.
 */
export async function batchCommand(
  args: Record<string, unknown>,
  deps: BatchDependencies = defaultBatchDependencies,
): Promise<ToolTextResult> {
  const steps = normalizeBatchSteps(args.steps ?? []);
  const bail = args.bail === true;
  const results: BatchPayload["steps"] = [];
  let failureIndex: number | null = null;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step) continue;
    try {
      const result = await runBatchStep(step, args, deps);
      results.push({ index, command: result.command, ok: true, data: result.data });
    } catch (error) {
      if (failureIndex === null) failureIndex = index;
      results.push({
        index,
        command: Array.isArray(step) ? step[0] ?? null : null,
        ok: false,
        error: batchStepError(error),
      });
      if (bail) break;
    }
  }

  return toolJson({
    ok: failureIndex === null,
    bail,
    failureIndex,
    steps: results,
  });
}

const defaultBatchDependencies: BatchDependencies = {
  runToolAndEmitPayload: runToolViaCli,
};

export function normalizeBatchSteps(steps: unknown): string[][] {
  if (!Array.isArray(steps)) {
    throw new CliUsageError("batch requires one or more command steps.");
  }
  return steps.map((step, index) => {
    const parsed = typeof step === "string" ? parseJsonArgument(step, `step ${index + 1}`) : step;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new CliUsageError(`batch step ${index + 1} must be a non-empty argv array.`);
    }
    return parsed.map((part) => String(part));
  });
}

export async function runBatchStep(
  step: string[],
  batchArgs: Record<string, unknown>,
  deps: BatchDependencies,
): Promise<{ command: string; data: unknown }> {
  const parsed = parseCliArgs(step);
  const { command, args, globals } = parsed;
  if (!command) throw new CliUsageError("Batch step is missing a command.");

  const aliases = commandAliases();
  const toolName = aliases[command];
  if (!toolName) throw new CliUsageError(`Unknown command: ${command}`);

  const mergedGlobals = {
    ...globals,
    json: true,
    plain: false,
    quiet: true,
    root: globals.root ?? batchArgs.root ?? null,
    stateDir: globals.stateDir ?? batchArgs.stateDir ?? null,
  };
  const effectiveArgs = commandArgs(command, args, mergedGlobals);
  const result = await deps.runToolAndEmitPayload(toolName, effectiveArgs, { command, globals: mergedGlobals, silent: true });
  return { command, data: redactValue(unwrapToolJson(result)) };
}

async function runToolViaCli(
  _toolName: string,
  args: Record<string, unknown>,
  options: RunToolOptions,
): Promise<unknown> {
  const cliPath = process.argv[1];
  if (!cliPath) {
    throw new Error("batch requires a CLI entrypoint to run steps.");
  }
  const argv = cliArgv(options.command, args, options.globals);
  const result = await execFile(process.execPath, [cliPath, ...argv], {
    timeout: 120_000,
    rejectOnError: false,
  });
  if (result.error) {
    const message = [result.error.message, result.stderr].filter(Boolean).join("\n");
    throw new Error(message || `Batch step failed: ${options.command}`);
  }
  const parsed = parseCliJson(result.stdout);
  return parsed && typeof parsed === "object" && "data" in parsed
    ? (parsed as { data: unknown }).data
    : parsed;
}

function cliArgv(command: string, args: Record<string, unknown>, globals: Record<string, unknown>): string[] {
  const argv: string[] = ["--json", "--quiet"];
  if (typeof globals.root === "string" && globals.root) argv.push("--root", globals.root);
  if (typeof globals.stateDir === "string" && globals.stateDir) argv.push("--state-dir", globals.stateDir);
  argv.push(command);
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || key === "root" || key === "stateDir") continue;
    const flag = `--${kebabCase(key)}`;
    if (value === true) {
      argv.push(flag);
    } else {
      argv.push(flag, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  return argv;
}

export function parseCliJson(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const snippet = truncate(text, 4_000);
    throw new Error(`Batch child process returned invalid JSON on stdout: ${snippet}`, { cause: error });
  }
}

function execFile(
  file: string,
  args: string[],
  options: { timeout: number; rejectOnError: false },
): Promise<{ stdout: string; stderr: string; error?: Error & { code?: number | string | null; signal?: string | null } }> {
  return new Promise((resolve) => {
    nodeExecFile(file, args, { timeout: options.timeout }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error as (Error & { code?: number | string | null; signal?: string | null }) | undefined,
      });
    });
  });
}

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}
