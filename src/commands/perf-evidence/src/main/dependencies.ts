import { execFile as nodeExecFile } from "node:child_process";
import { readFile, stat as fsStat, writeFile as fsWriteFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateHermesExpression as sharedEvaluateHermesExpression } from "../../../../platform/hermes-cdp-client/src/main/index.ts";
import { metroStatusPayload, metroTargets } from "../../../metro-probes/src/main/index.ts";
import type {
  PerfDependencies,
  PerfExecResult,
  PerfFileStat,
  PerfHermesEvaluation,
  PerfMetroStatus,
  PerfMetroTarget,
  PerfProjectSummary,
} from "./types.js";

export async function projectCwd(cwd: unknown, deps: PerfDependencies): Promise<string> {
  if (deps.normalizeProjectCwd) {
    return Promise.resolve(deps.normalizeProjectCwd(cwd, { allowMissingPackageJson: true })).catch(
      () => resolve(String(cwd ?? process.cwd())),
    );
  }
  return resolve(String(cwd ?? process.cwd()));
}

export async function projectSummary(
  cwd: string,
  deps: PerfDependencies,
): Promise<PerfProjectSummary> {
  return deps.expoProjectRuntimeSummary
    ? deps.expoProjectRuntimeSummary(cwd)
    : { projectRoot: cwd };
}

export async function metroStatus(
  args: { metroPort: number },
  deps: PerfDependencies,
): Promise<PerfMetroStatus> {
  return deps.metroStatusPayload
    ? deps.metroStatusPayload(args)
    : (metroStatusPayload(args) as unknown as Promise<PerfMetroStatus>);
}

export async function listMetroTargets(
  metroPort: number,
  deps: PerfDependencies,
): Promise<PerfMetroTarget[]> {
  return deps.metroTargets
    ? deps.metroTargets(metroPort)
    : (metroTargets(metroPort) as unknown as Promise<PerfMetroTarget[]>);
}

export async function evaluateHermes(
  url: string,
  expression: string,
  deps: PerfDependencies,
): Promise<PerfHermesEvaluation> {
  return deps.evaluateHermesExpression
    ? deps.evaluateHermesExpression(url, expression, { timeoutMs: 5000 })
    : (sharedEvaluateHermesExpression(url, expression, {
        timeoutMs: 5000,
      }) as Promise<PerfHermesEvaluation>);
}

export async function findUpFile(
  cwd: string,
  name: string,
  deps: PerfDependencies,
): Promise<string | null> {
  return deps.findUp ? deps.findUp(cwd, name) : null;
}

export async function readJson(file: string, deps: PerfDependencies): Promise<unknown> {
  if (deps.readJsonFile) return deps.readJsonFile(file);
  return JSON.parse(await readFile(file, "utf8"));
}

export async function writeJsonFile(
  file: string,
  value: unknown,
  deps: PerfDependencies,
): Promise<void> {
  await (deps.writeFile ?? fsWriteFile)(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function exists(path: string, deps: PerfDependencies): Promise<boolean> {
  return deps.pathExists
    ? deps.pathExists(path)
    : fsStat(path).then(
        () => true,
        () => false,
      );
}

export async function fileStat(path: string, deps: PerfDependencies): Promise<PerfFileStat | null> {
  return deps.stat ? deps.stat(path) : fsStat(path).catch(() => null);
}

export function execFile(
  file: string,
  argv: string[],
  options: { timeout: number },
): Promise<PerfExecResult> {
  return new Promise((resolveExec) => {
    nodeExecFile(
      file,
      argv,
      { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolveExec({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error ? { message: error.message, code: error.code, signal: error.signal } : null,
        });
      },
    );
  });
}
