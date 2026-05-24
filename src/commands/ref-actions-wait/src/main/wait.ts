import { clampNumber, normalizeFinderText, requireString, toolJson } from "./common.js";
import { defaultRefActionDependencies } from "./defaults.js";
import type {
  RefActionDependencies,
  RefCache,
  RefRecord,
  ToolTextResult,
  WaitEvaluation,
  WaitPredicate,
} from "./domain.js";

/**
 * RULE-019: cached-ref waits poll at a bounded interval until a final match,
 * final validation failure, or timeout.
 */
export async function waitCommand(
  args: Record<string, unknown>,
  deps: RefActionDependencies = defaultRefActionDependencies,
): Promise<ToolTextResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const started = now();
  const timeoutMs = clampNumber(args.timeoutMs ?? 5000, 0, 60000);
  const intervalMs = Math.min(Math.max(Math.floor(timeoutMs / 10), 25), 250);
  const predicate = waitPredicate(args);

  if (!predicate) {
    const ms = clampNumber(args.ms ?? 0, 0, 60000);
    if (ms > 0) await sleep(ms);
    return toolJson({
      matched: true,
      predicate: { kind: "sleep", ms },
      elapsedMs: now() - started,
    });
  }

  if (
    predicate.kind === "metro-ready" ||
    predicate.kind === "app-ready" ||
    predicate.kind === "fn"
  ) {
    if (!deps.waitRuntimePredicate) {
      return toolJson({
        matched: false,
        available: false,
        reason: "Runtime wait predicates require a runtime adapter.",
        predicate,
        timeoutMs,
        elapsedMs: now() - started,
      });
    }
    const runtimeResult = await deps.waitRuntimePredicate(predicate, args, {
      started,
      timeoutMs,
      intervalMs,
    });
    return toolJson(runtimeResult);
  }

  let lastCache: RefCache | null = null;
  do {
    lastCache = await deps.readLatestRefCache(args);
    if (!lastCache) {
      return toolJson({
        matched: false,
        reason: "No snapshot exists for the current session.",
        predicate,
        lastEvidence: null,
      });
    }
    const result = evaluateWaitPredicate(lastCache, predicate);
    if (result.final || result.matched) {
      const payload = result.payload?.matched
        ? { ...result.payload, elapsedMs: now() - started }
        : result.payload;
      return toolJson(payload);
    }
    if (now() - started >= timeoutMs) break;
    await sleep(Math.min(intervalMs, timeoutMs - (now() - started)));
  } while (now() - started <= timeoutMs);

  return toolJson(timeoutWaitPayload(predicate, lastCache, timeoutMs, now() - started));
}

export function waitPredicate(args: Record<string, unknown> = {}): WaitPredicate | null {
  if (args.metroReady === true) return { kind: "metro-ready" };
  if (args.appReady === true) return { kind: "app-ready" };
  if (args.fn !== undefined) return { kind: "fn", expression: requireString(args.fn, "fn") };
  if (args.route !== undefined) return { kind: "route", route: requireString(args.route, "route") };
  if (args.noSpinner === true) return { kind: "no-spinner" };
  if (args.text !== undefined) return { kind: "text", text: requireString(args.text, "text") };
  if (args.ref !== undefined || args.state !== undefined) {
    return {
      kind: "ref-state",
      ref: requireString(args.ref, "ref"),
      state: requireString(args.state ?? "visible", "state").toLowerCase(),
    };
  }
  return null;
}

export function evaluateWaitPredicate(cache: RefCache, predicate: WaitPredicate): WaitEvaluation {
  if (predicate.kind === "text") {
    const expected = normalizeFinderText(predicate.text);
    const ref = cache.refs.find(
      (record) =>
        !record.stale &&
        normalizeFinderText([record.text, record.label].filter(Boolean).join(" ")).includes(
          expected,
        ),
    );
    if (!ref) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, ref, lastEvidence: waitEvidence(cache) } as Record<
        string,
        unknown
      >,
    };
  }

  if (predicate.kind === "ref-state") {
    if (!/^@e\d+$/.test(predicate.ref)) {
      return {
        matched: false,
        final: true,
        payload: { matched: false, reason: "Ref must look like @e1.", ref: predicate.ref },
      };
    }
    if (!["visible", "hidden"].includes(predicate.state)) {
      throw new Error(`Unknown wait state: ${predicate.state}`);
    }
    const ref = cache.refs.find((record) => record.ref === predicate.ref);
    if (!ref) {
      return {
        matched: false,
        final: true,
        payload: {
          matched: false,
          reason: "Ref not found in the latest snapshot.",
          ref: predicate.ref,
        },
      };
    }
    if (ref.stale) {
      return {
        matched: false,
        final: true,
        payload: {
          matched: false,
          reason: "Ref is stale. Capture a new snapshot before waiting on it.",
          ref: predicate.ref,
        },
      };
    }
    const visible = refHasVisibleEvidence(ref);
    const matched = predicate.state === "visible" ? visible : !visible;
    if (!matched) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, ref, lastEvidence: waitEvidence(cache) } as Record<
        string,
        unknown
      >,
    };
  }

  if (predicate.kind === "route") {
    const expected = normalizeFinderText(predicate.route);
    const ref = cache.refs.find(
      (record) =>
        !record.stale &&
        normalizeFinderText([record.text, record.label].filter(Boolean).join(" ")).includes(
          expected,
        ),
    );
    if (!ref) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, ref, lastEvidence: waitEvidence(cache) } as Record<
        string,
        unknown
      >,
    };
  }

  if (predicate.kind === "no-spinner") {
    const spinner = cache.refs.find((record) =>
      /spinner|loading|progress/i.test(
        [record.role, record.label, record.text].filter(Boolean).join(" "),
      ),
    );
    if (spinner) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, lastEvidence: waitEvidence(cache) } as Record<
        string,
        unknown
      >,
    };
  }

  throw new Error(`Unknown wait predicate: ${predicate.kind}`);
}

export function timeoutWaitPayload(
  predicate: WaitPredicate,
  cache: RefCache | null,
  timeoutMs: number,
  elapsedMs: number,
): Record<string, unknown> {
  const refState = predicate as { ref?: unknown; state?: unknown };
  const label = predicate.kind === "text" ? "text" : `${refState.ref} to become ${refState.state}`;
  return {
    matched: false,
    reason: `Timed out waiting for ${label}.`,
    predicate,
    timeoutMs,
    elapsedMs,
    lastEvidence: waitEvidence(cache, { includeSampleRefs: true }),
  };
}

export function waitEvidence(
  cache: RefCache | null,
  options: { includeSampleRefs?: boolean } = {},
): Record<string, unknown> | null {
  if (!cache) return null;
  return {
    snapshotId: cache.snapshotId ?? null,
    targetId: cache.targetId ?? null,
    refCount: cache.refs?.length ?? 0,
    ...(options.includeSampleRefs
      ? { sampleRefs: (cache.refs ?? []).slice(0, 5).map((record) => waitSampleRef(record)) }
      : {}),
  };
}

export function refHasVisibleEvidence(record: Partial<RefRecord> | null | undefined): boolean {
  return Boolean(
    record?.box || normalizeFinderText(record?.text) || normalizeFinderText(record?.label),
  );
}

function waitSampleRef(record: RefRecord): Record<string, unknown> {
  return {
    ref: record.ref,
    role: record.role ?? null,
    label: record.label ?? null,
    text: record.text ?? null,
    stale: record.stale === true,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
