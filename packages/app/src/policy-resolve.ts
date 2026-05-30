import { type PolicyDocument } from "@expo98/core"
import { Fs } from "@expo98/domain"
import { Effect, Option, Schema } from "effect"
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
export const resolvePolicy = (globals: CliGlobals): Effect.Effect<PolicyDocument, never, Fs> =>
  Effect.gen(function* () {
    const base = yield* loadPolicyFile(globals.actionPolicy)
    const policy: PolicyDocument = {
      ...base,
      allowRuntimeEval: globals.allowRuntimeEval || base.allowRuntimeEval === true,
      confirmations: globals.confirmActions,
    }
    return policy
  })

/** Load + lenient-parse the policy file, or `{}` when absent/unreadable. */
const loadPolicyFile = (path: Option.Option<string>): Effect.Effect<PolicyDocument, never, Fs> =>
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
      }),
  })

const PolicyFile = Schema.Struct({
  allow: Schema.optional(Schema.Array(Schema.String)),
  actions: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Union(Schema.Literal("allow"), Schema.Literal("deny"), Schema.Boolean),
    }),
  ),
  allowRuntimeEval: Schema.optional(Schema.Boolean),
})

const decodePolicyFile = Schema.decodeUnknownOption(Schema.parseJson(PolicyFile))

/** Parse policy JSON into the narrow allow/actions shape; tolerate junk by failing closed. */
const parsePolicy = (raw: string): PolicyDocument =>
  Option.getOrElse(decodePolicyFile(raw), () => ({}) satisfies PolicyDocument)
