import {
  toolJson,
  type ToolTextResult,
} from "../../../../core/tool-json-envelope/src/main/index.ts";
import {
  reviewOverlayAction,
  type ReviewOverlayPayload,
} from "../../../review-overlay-workflow/src/main/index.ts";

export interface AnnotateScreenArgs extends Record<string, unknown> {
  action?: unknown;
  cwd?: unknown;
  outputDir?: unknown;
  overlayDir?: unknown;
  title?: unknown;
  serve?: boolean;
  port?: unknown;
  endpointPath?: unknown;
  metroPort?: unknown;
  force?: boolean;
  confirmActions?: unknown;
}

export interface AnnotateScreenDependencies {
  reviewOverlayAction: (
    args: Record<string, unknown>,
  ) => Promise<ReviewOverlayPayload | ToolTextResult> | ReviewOverlayPayload | ToolTextResult;
}

const ANNOTATE_ACTIONS = new Set(["prepare", "read", "clear", "scaffold", "server"]);
const SCAFFOLD_CONFIRMATION = "annotate-overlay-scaffold";

export async function annotateScreen(
  args: AnnotateScreenArgs = {},
  deps: AnnotateScreenDependencies = defaultAnnotateScreenDependencies,
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireOptionalString(args.action ?? positionals[0]) ?? "prepare";
  if (!ANNOTATE_ACTIONS.has(action)) {
    throw new Error(`Unknown annotate-screen action: ${action}`);
  }

  if (
    action === "scaffold" &&
    !hasExplicitConfirmation(args.confirmActions, SCAFFOLD_CONFIRMATION)
  ) {
    return toolJson({
      available: false,
      action,
      source: "policy",
      evidenceSource: "policy",
      code: "confirmation-required",
      reason: `Refusing to mutate app files without explicit --confirm-actions ${SCAFFOLD_CONFIRMATION}.`,
      requiredConfirmation: SCAFFOLD_CONFIRMATION,
      mutation: {
        writesAppFiles: true,
        developmentOnly: true,
      },
    });
  }

  const result = await deps.reviewOverlayAction({
    ...args,
    action,
    title: args.title ?? "Codex in-app annotations",
  });
  const payload = isToolTextResult(result) ? unwrapToolJson(result) : result;
  return toolJson({
    ...(isRecord(payload) ? payload : { value: payload }),
    command: "annotate-screen",
    annotationSurface: "in-app-overlay",
    compatibility: {
      legacyBoard: "removed",
      replacement: "review-overlay",
    },
  });
}

const defaultAnnotateScreenDependencies: AnnotateScreenDependencies = {
  reviewOverlayAction,
};

export function unwrapToolJson(result: unknown): unknown {
  const text = (result as ToolTextResult | null | undefined)?.content?.[0]?.text;
  if (typeof text !== "string") return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export function hasExplicitConfirmation(value: unknown, required: string): boolean {
  if (typeof value !== "string") return false;
  return value
    .split(/[,\s]+/)
    .filter(Boolean)
    .includes(required);
}

export function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolTextResult(value: unknown): value is ToolTextResult {
  return Array.isArray((value as { content?: unknown } | null)?.content);
}
