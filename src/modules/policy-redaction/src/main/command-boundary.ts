import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { POLICY_REASONS } from "./domain.js";
import {
  actionSideEffect,
  decideActionPolicy,
  defaultPolicySummary,
  type PolicyDocument,
} from "./policy-service.js";
import { redactJson, redactText, type JsonValue } from "./redactor.js";

export type CommandArgs = Record<string, unknown>;

export type ToolTextResult = {
  content: [{ type: "text"; text: string }];
  isError: false;
};

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }], isError: false };
}

export async function policyCommand(args: CommandArgs = {}): Promise<ToolTextResult> {
  const action = requireString(args.action ?? "show", "action");
  if (action !== "show" && action !== "check") {
    throw new Error(`Unknown policy action: ${action}`);
  }

  const policyPath = requireOptionalString(args.actionPolicy);
  const resolvedPolicyPath = policyPath ? resolve(policyPath) : null;
  const policy = resolvedPolicyPath ? await readJsonFile(resolvedPolicyPath) : null;

  if (action === "show") {
    return toolJson({
      available: true,
      action,
      source: resolvedPolicyPath,
      policy: policy ?? defaultPolicySummary(),
      limitations: [
        "No policy file means read-only commands are allowed and state-changing commands are denied by default.",
      ],
    });
  }

  const subject = requireString(args.subject, "subject");
  const name = requireString(args.name, "name");
  const policyAction = subject === "action" ? name : `${subject}.${name}`;
  const sideEffect = actionSideEffect(policyAction);
  const decision =
    sideEffect === "read"
      ? {
          checked: true,
          action: policyAction,
          sideEffect,
          allowed: true,
          source: resolvedPolicyPath,
          reason: POLICY_REASONS.READ_ALLOWED,
        }
      : decideActionPolicy({
          action: policyAction,
          sideEffect,
          policy,
          source: resolvedPolicyPath,
          allowRuntimeEval: args.allowRuntimeEval === true,
        });

  return toolJson({
    available: true,
    action: "check",
    subject,
    name,
    policyAction,
    decision,
  });
}

export async function redactCommand(args: CommandArgs = {}): Promise<ToolTextResult> {
  const file = resolve(requireString(args.file, "file"));
  const raw = await readFile(file, "utf8");
  let payload: JsonValue | string;

  try {
    payload = redactJson(JSON.parse(raw) as JsonValue);
  } catch {
    payload = redactText(raw);
  }

  const outputPath = requireOptionalString(args.outputPath);
  const resolvedOutputPath = outputPath ? resolve(outputPath) : null;
  if (resolvedOutputPath) {
    await mkdir(dirname(resolvedOutputPath), { recursive: true });
    const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    await writeFile(resolvedOutputPath, `${text}\n`, "utf8");
  }

  return toolJson({
    available: true,
    action: "redact",
    inputPath: file,
    outputPath: resolvedOutputPath,
    redacted: payload,
  });
}

async function readJsonFile(file: string): Promise<PolicyDocument> {
  return JSON.parse(await readFile(file, "utf8")) as PolicyDocument;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
