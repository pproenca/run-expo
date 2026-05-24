import { parseCliArgs, parseJsonArgument } from "./cli.js";
import { commandAliases, commandArgs } from "./command-map.js";
import { batchStepError } from "./errors.js";
import { redactValue } from "./errors.js";
import { CliUsageError } from "./domain.js";
import type { BatchDependencies, BatchPayload, ToolTextResult } from "./domain.js";
import { toolJson, unwrapToolJson } from "./tool-json.js";

/**
 * RULE-023: batch steps run serially, share root/state by default, and can
 * bail after the first failure.
 */
export async function batchCommand(
  args: Record<string, unknown>,
  deps: BatchDependencies,
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
  const result = await deps.runTool(toolName, effectiveArgs, { command, globals: mergedGlobals, silent: true });
  return { command, data: redactValue(unwrapToolJson(result)) };
}
