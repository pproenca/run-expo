import { Options } from "@effect/cli"
import { CliUsageError } from "@expo98/core"
import { Effect, Option } from "effect"

/**
 * Global flags → `CliGlobals` (S12 CLI Shell).
 *
 * Contract source: AI_NATIVE_SPEC §3.1, interfaces.md §1.2, rules-gwt AC-015/016.
 *
 * ── ARCHITECTURE FINDING N2 (the @effect/cli risk) ──────────────────────────
 * `@effect/cli`'s flag/exit semantics DO NOT match the contractual AC-015/016:
 *
 *   1. AC-015 (`--json` + `--plain` mutually exclusive → exit 2): `@effect/cli`
 *      models the two as INDEPENDENT booleans, so it raises NO error — both are
 *      individually valid, the conflict is invisible to it.
 *   2. AC-016 (a value flag with no value → exit 2): `@effect/cli` DOES detect
 *      this (`ValidationError.MissingValue`), BUT `@effect/platform`'s
 *      `defaultTeardown` maps EVERY failure cause to exit code **1**
 *      (`Exit.isFailure(exit) && !isInterruptedOnly ? 1 : 0`) — never 2.
 *
 * Empirically verified by reading the installed sources:
 *   - `@effect/platform/dist/cjs/Runtime.js` `defaultTeardown` → `… ? 1 : 0`.
 *   - `@effect/cli` `Options.boolean` produces two independent flags.
 *
 * DECISION: a thin, PURE pre-parse guard (`assertUsage`) runs FIRST, over the
 * user-facing argv slice. It detects both AC-015 and AC-016 and fails with
 * `CliUsageError`, which `exitCodeForError` (core) maps to exit 2. The CLI shell
 * also installs a custom `NodeRuntime` teardown that honours `exitCodeForError`
 * so a `CliUsageError` surfaced from anywhere becomes exit 2, not 1.
 *
 * This keeps `@effect/cli` for declarative help/version/parsing while making the
 * AC-015/016 contract exact. The guard is fully unit-testable without booting
 * the CLI.
 */

/** The parsed global-flag struct shared by every command (non-persisted). */
export interface CliGlobals {
  /** `{ ok, data }` machine envelope on stdout. */
  readonly json: boolean
  /** Stable line-oriented output (mutually exclusive with `--json`). */
  readonly plain: boolean
  /** Streaming NDJSON progress (one redacted JSON event per line). */
  readonly ndjson: boolean
  /** Suppress non-essential human output. */
  readonly quiet: boolean
  /** Default project root + state-root base. */
  readonly root: Option.Option<string>
  /** Run-record / state persistence dir — treated LITERALLY (legacy quirk dropped). */
  readonly stateDir: Option.Option<string>
  /** JSON policy file permitting gated actions. */
  readonly actionPolicy: Option.Option<string>
  /** Truncate stdout payloads to this many chars. */
  readonly maxOutput: Option.Option<number>
  /** Permit gated Hermes `Runtime.evaluate` predicates. */
  readonly allowRuntimeEval: boolean
  /** Comma-split confirmation tokens (e.g. `bridge-install`). */
  readonly confirmActions: ReadonlyArray<string>
  /** Persist a run record (observational only). */
  readonly record: boolean
  /** Wrap stdout data in an untrusted-output boundary. */
  readonly contentBoundaries: boolean
  /** Emit debug fields. */
  readonly debug: boolean
  /** Disable ANSI color. */
  readonly noColor: boolean
  /** Never prompt (the never-prompt guarantee). */
  readonly noInput: boolean
}

// ── The value flags whose absent value must yield exit 2 (AC-016). ──────────
// Long names and their accepted forms. `--allow-runtime-eval` and `--confirm-
// actions` are value flags here too (the spec lists them under value flags).
export const VALUE_FLAGS = [
  "--root",
  "--state-dir",
  "--action-policy",
  "--max-output",
  "--allow-runtime-eval",
  "--confirm-actions",
] as const

export type ValueFlag = (typeof VALUE_FLAGS)[number]

const isFlagLike = (token: string): boolean => token.startsWith("-")

/**
 * AC-015 + AC-016 — the pure pre-parse usage guard (N2 fix).
 *
 * Operates on the USER-FACING argv slice (i.e. `process.argv.slice(2)` — the
 * tokens after `node <script>`). Throwing is modelled as a failed Effect with
 * `CliUsageError`, so the shell maps it to exit 2 via `exitCodeForError`.
 *
 * - AC-015: both `--json` and `--plain` present ⇒ usage error.
 * - AC-016: a value flag immediately followed by EOF or another flag (i.e. no
 *   value) ⇒ usage error. `--flag=value` forms always carry their value, so
 *   they pass. `--json`/`--plain` etc. are NOT value flags and are exempt.
 */
export const assertUsage = (argv: ReadonlyArray<string>): Effect.Effect<void, CliUsageError> =>
  Effect.suspend(() => {
    const hasJson = argv.includes("--json")
    const hasPlain = argv.includes("--plain")
    if (hasJson && hasPlain) {
      return Effect.fail(new CliUsageError({ message: "--json and --plain are mutually exclusive." }))
    }

    for (let i = 0; i < argv.length; i++) {
      const token = argv[i]
      if (token === undefined) {
        continue
      }
      // `--flag=value` carries its value inline — always satisfied.
      const eq = token.indexOf("=")
      const name = eq === -1 ? token : token.slice(0, eq)
      if (!isValueFlag(name)) {
        continue
      }
      if (eq !== -1) {
        // `--root=` (empty after `=`) still counts as "no value".
        if (token.slice(eq + 1).length === 0) {
          return Effect.fail(requiresValue(name))
        }
        continue
      }
      // Space-separated form: the next token must exist and not be a flag.
      const next = argv[i + 1]
      if (next === undefined || isFlagLike(next)) {
        return Effect.fail(requiresValue(name))
      }
    }
    return Effect.void
  })

const isValueFlag = (name: string): name is ValueFlag => (VALUE_FLAGS as ReadonlyArray<string>).includes(name)

const requiresValue = (name: string): CliUsageError => new CliUsageError({ message: `${name} requires a value.` })

/**
 * Fold the globals parsed in the ROOT scope (flags written BEFORE the subcommand)
 * with those parsed in the SUBCOMMAND scope (flags written AFTER it) into one
 * effective struct, so every global flag is position-independent.
 *
 * `@effect/cli` binds a global flag to whichever command scope it textually sits
 * in: `run-expo --action-policy p <verb>` parses it into the ROOT command, while
 * `run-expo <verb> --action-policy p` parses it into the SUBCOMMAND. The shell
 * previously read only the subcommand scope, so a flag in the other position was
 * silently dropped — notably `--action-policy` in the DOCUMENTED pre-verb spot,
 * which then fail-closed DENIED gated actions whose policy file actually granted
 * them. Folding both scopes restores the "global flags work anywhere" contract:
 * booleans OR together, single-value flags prefer the subcommand scope (closer to
 * the verb) and fall back to root, and list flags concatenate (de-duped).
 */
export const mergeGlobals = (root: CliGlobals, sub: CliGlobals): CliGlobals => ({
  json: root.json || sub.json,
  plain: root.plain || sub.plain,
  ndjson: root.ndjson || sub.ndjson,
  quiet: root.quiet || sub.quiet,
  root: Option.orElse(sub.root, () => root.root),
  stateDir: Option.orElse(sub.stateDir, () => root.stateDir),
  actionPolicy: Option.orElse(sub.actionPolicy, () => root.actionPolicy),
  maxOutput: Option.orElse(sub.maxOutput, () => root.maxOutput),
  allowRuntimeEval: root.allowRuntimeEval || sub.allowRuntimeEval,
  confirmActions: Array.from(new Set([...root.confirmActions, ...sub.confirmActions])),
  record: root.record || sub.record,
  contentBoundaries: root.contentBoundaries || sub.contentBoundaries,
  debug: root.debug || sub.debug,
  noColor: root.noColor || sub.noColor,
  noInput: root.noInput || sub.noInput,
})

// ──────────────────────────────────────────────────────────────────────────
// @effect/cli Options — declarative parsing of the global flags. The guard
// above is the AUTHORITY for AC-015/016; these Options drive --help/--version,
// shell completion, and produce the typed CliGlobals struct on a valid argv.
// ──────────────────────────────────────────────────────────────────────────

const boolFlag = (name: string): Options.Options<boolean> => Options.boolean(name).pipe(Options.withDefault(false))

/** The composed global Options, producing a `CliGlobals` struct. */
export const globalOptions: Options.Options<CliGlobals> = Options.all({
  json: boolFlag("json"),
  plain: boolFlag("plain"),
  ndjson: boolFlag("ndjson"),
  quiet: boolFlag("quiet"),
  root: Options.optional(Options.text("root")),
  stateDir: Options.optional(Options.text("state-dir")),
  actionPolicy: Options.optional(Options.text("action-policy")),
  maxOutput: Options.optional(Options.integer("max-output")),
  allowRuntimeEval: Options.boolean("allow-runtime-eval").pipe(Options.withDefault(false)),
  confirmActions: Options.text("confirm-actions").pipe(
    Options.map((csv) =>
      csv
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
    Options.withDefault<ReadonlyArray<string>>([]),
  ),
  record: boolFlag("record"),
  contentBoundaries: boolFlag("content-boundaries"),
  debug: boolFlag("debug"),
  noColor: boolFlag("no-color"),
  noInput: boolFlag("no-input"),
})
