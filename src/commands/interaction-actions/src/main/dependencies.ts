import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { join as joinPath } from "node:path";

import { traceInteraction } from "../../../interaction-trace-expression/src/main/index.ts";
import { defaultRefActionDependencies } from "../../../ref-actions-wait/src/main/defaults.ts";
import { planRefAction, refPoint, scrollPlan } from "../../../ref-actions-wait/src/main/index.ts";
import { automationTakeScreenshot } from "../../../screenshot-capture/src/main/index.ts";
import { asRecord, createRefActionAdapter, optionalString } from "./shared.js";
import type { ActionPolicyDecision, ExecOptions, ExecResult, InteractionDependencies, IosDevice } from "./types.js";
import { MAX_OUTPUT } from "./types.js";

export const defaultInteractionDependencies: InteractionDependencies = {
  commandPath: defaultCommandPath,
  execFile: defaultExecFile,
  resolveIosDevice: defaultResolveIosDevice,
  ...createRefActionAdapter(defaultRefActionDependencies, { planRefAction, refPoint, scrollPlan }),
  policyDecision: defaultPolicyDecision,
  captureScreenshot: (args) => automationTakeScreenshot(args),
  traceInteraction: (args) => traceInteraction(args),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
  tmpdir: osTmpdir,
  mkdir: (path, options) => fs.mkdir(path, options),
  joinPath,
};

async function defaultCommandPath(command: string): Promise<string | null> {
  const result = await defaultExecFile("which", [command], { timeout: 5_000, rejectOnError: false });
  return result.error ? null : optionalString(result.stdout);
}

function defaultExecFile(file: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  if (options.input !== undefined) {
    return defaultSpawnFile(file, args, options);
  }
  return new Promise((resolve, reject) => {
    nodeExecFile(file, args, { timeout: options.timeout, maxBuffer: options.maxBuffer ?? MAX_OUTPUT }, (error, stdout, stderr) => {
      if (error && options.rejectOnError !== false) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : null,
      });
    });
  });
}

function defaultSpawnFile(file: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = options.timeout ? setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      const error = { message: `${file} timed out after ${options.timeout}ms`, code: "ETIMEDOUT", signal: null };
      if (options.rejectOnError !== false) {
        reject(Object.assign(new Error(error.message), { stdout, stderr, code: error.code }));
      } else {
        resolve({ stdout, stderr, error });
      }
    }, options.timeout) : null;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (options.rejectOnError !== false) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve({ stdout, stderr, error: { message: error.message, code: null, signal: null } });
      }
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      const error = code === 0 ? null : { message: `${file} exited with code ${code}`, code, signal };
      if (error && options.rejectOnError !== false) {
        reject(Object.assign(new Error(error.message), { stdout, stderr, code, signal }));
      } else {
        resolve({ stdout, stderr, error });
      }
    });
    child.stdin.end(options.input);
  });
}

async function defaultResolveIosDevice(requested: string | undefined): Promise<IosDevice> {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const { stdout } = await defaultExecFile("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(String(stdout ?? "{}")) as { devices?: Record<string, unknown[]> };
  const devices = Object.entries(parsed.devices ?? {}).flatMap(([runtime, runtimeDevices]) =>
    (Array.isArray(runtimeDevices) ? runtimeDevices : []).map((device) => {
      const record = asRecord(device);
      return {
        udid: String(record.udid ?? ""),
        name: String(record.name ?? ""),
        state: optionalString(record.state) ?? undefined,
        runtime,
        isAvailable: record.isAvailable === undefined ? undefined : Boolean(record.isAvailable),
      };
    }),
  ).filter((device) => device.udid && device.name);

  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find((device) => device.name.toLowerCase().includes(requested.toLowerCase()));
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }

  const booted = devices.find((device) => device.state === "Booted");
  if (booted) return booted;
  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}

async function defaultPolicyDecision(
  args: Record<string, unknown>,
  action: string,
  sideEffect: "device",
): Promise<ActionPolicyDecision> {
  const policyPath = optionalString(args.actionPolicy);
  if (!policyPath) {
    return {
      checked: true,
      action,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation.",
    };
  }

  const policy = JSON.parse(await fs.readFile(policyPath, "utf8")) as {
    allow?: unknown;
    actions?: Record<string, unknown>;
  };
  const allowed = (Array.isArray(policy.allow) && policy.allow.includes(action))
    || policy.actions?.[action] === true
    || policy.actions?.[action] === "allow";
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: policyPath,
    reason: allowed ? "Action allowed by policy." : "Action policy did not allow this operation.",
  };
}
