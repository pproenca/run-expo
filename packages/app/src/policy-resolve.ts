import { type PolicyDocument } from "@expo98/core"
import { Fs } from "@expo98/domain"
import { Effect, Option } from "effect"
import { type CliGlobals } from "./globals.js"

/**
 * Resolve the effective `PolicyDocument` for an invocation from the global flags
 * and an optional `--action-policy <path>` JSON file (S12 → S4).
 *
 * - `--action-policy` JSON is parsed leniently into `{ allow?, actions? }`.
 * - `--allow-runtime-eval` sets the global runtime-eval escape hatch (AC-004).
 * - `--confirm-actions` tokens become the policy's `confirmations[]` (AC-008).
 *
 * The pure spine's `gate` (core) then evaluates the exact action against this
 * document. A missing/unreadable policy file yields an EMPTY allow-list (fail
 * closed) — never an error that would change a read command's exit code.
 */
export const resolvePolicy = (
  globals: CliGlobals
): Effect.Effect<PolicyDocument, never, Fs> =>
  Effect.gen(function* () {
    const base = yield* loadPolicyFile(globals.actionPolicy)
    const policy: PolicyDocument = {
      ...base,
      allowRuntimeEval: globals.allowRuntimeEval || base.allowRuntimeEval === true,
      confirmations: globals.confirmActions
    }
    return policy
  })

/** Load + lenient-parse the policy file, or `{}` when absent/unreadable. */
const loadPolicyFile = (
  path: Option.Option<string>
): Effect.Effect<PolicyDocument, never, Fs> =>
  Option.match(path, {
    onNone: () => Effect.succeed<PolicyDocument>({}),
    onSome: (p) =>
      Effect.gen(function* () {
        const fs = yield* Fs
        const raw = yield* fs.readFile(p).pipe(Effect.option)
        if (Option.isNone(raw)) {
          return {} satisfies PolicyDocument // fail closed on unreadable file
        }
        return parsePolicy(raw.value)
      })
  })

/** Parse policy JSON into the narrow allow/actions shape; tolerate junk. */
const parsePolicy = (raw: string): PolicyDocument => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof value !== "object" || value === null) {
    return {}
  }
  const obj = value as Record<string, unknown>
  const allow = Array.isArray(obj["allow"])
    ? (obj["allow"].filter((x) => typeof x === "string") as ReadonlyArray<string>)
    : undefined
  const actions =
    typeof obj["actions"] === "object" && obj["actions"] !== null
      ? (obj["actions"] as PolicyDocument["actions"])
      : undefined
  const allowRuntimeEval =
    typeof obj["allowRuntimeEval"] === "boolean" ? obj["allowRuntimeEval"] : undefined
  return {
    ...(allow !== undefined ? { allow } : {}),
    ...(actions !== undefined ? { actions } : {}),
    ...(allowRuntimeEval !== undefined ? { allowRuntimeEval } : {})
  }
}
