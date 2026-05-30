#!/usr/bin/env node
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Args, Command } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import {
  type CapabilityEnv,
  type CommandDescriptor,
  type DispatchResult,
  EXIT_SUCCESS,
  type ExitCode,
  exitCodeForError,
  Id,
  redact,
  type RunRecorder,
} from "@expo98/core"
import {
  Fs,
  type FinishedRunRecord,
  makePersistence,
  type RunningRunRecord,
  type RunId,
  type FsPort,
  defaultClock,
} from "@expo98/domain"
import { summarizeRunRecordPayload } from "@expo98/handlers-artifacts"
import { Cause, Console, Effect, Exit, Layer, Option } from "effect"
import { handlerCommands } from "./all-commands.js"
import { CLI_VERSION, coreReadCommands } from "./commands.js"
import { formatJson, formatNdjson, formatPlain, selectMode } from "./envelope.js"
import { type CliGlobals, assertUsage, globalOptions, mergeGlobals } from "./globals.js"
import { AppLayer } from "./layers.js"
import { resolvePolicy } from "./policy-resolve.js"
import { type CommandRegistration, registerCommands, runRegistered } from "./registry.js"

/**
 * The CLI shell composition root (S12).
 *
 * Bin: `run-expo` — the single published executable. The bundle/bin step
 * (esbuild → `cli/run-expo.mjs`, declared as the package `bin`) is wired in
 * `scripts/build.mjs`; the bundle is the runnable artifact (the `.ts` source
 * resolves `.js`→`.ts` specifiers only under a bundler).
 */

export const CLI_NAME = "run-expo"

// The assembled registry: the core READ proof-commands + the full handler /
// integration surface. Every verb funnels through core's dispatch (gate +
// capability-injection + redaction + exit-code mapping) — see registry.ts /
// all-commands.ts.
const registry = registerCommands([...coreReadCommands, ...handlerCommands])

/** Assert (and type) a runtime-non-empty array as a non-empty tuple. */
const asNonEmpty = <T>(arr: ReadonlyArray<T>): readonly [T, ...Array<T>] => {
  const [head, ...tail] = arr
  if (head === undefined) {
    throw new Error("run-expo: no commands registered (expected the core read set).")
  }
  return [head, ...tail]
}

/**
 * True when this module is the process entry point (vs imported by a test).
 *
 * Prefer Node's `import.meta.main` (Node ≥ 24): it is symlink-safe. The older
 * `import.meta.url === file://${argv[1]}` comparison is UNRELIABLE — under
 * macOS, `process.argv[1]` is the literal path (`/tmp/x.mjs`) while
 * `import.meta.url` resolves symlinks (`file:///private/tmp/x.mjs`), so they
 * diverge and the entry guard mis-fires (bundle silently no-ops). Fall back to a
 * realpath-normalised comparison only when `import.meta.main` is absent.
 */
const isEntryModule = (): boolean => {
  const meta = import.meta as ImportMeta & { main?: boolean }
  if (typeof meta.main === "boolean") {
    return meta.main
  }
  const entry = process.argv[1]
  if (entry === undefined) {
    return false
  }
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entry)
  } catch {
    return false
  }
}

/**
 * Group every registration by its FIRST verb token (e.g. `trace start` /
 * `trace read` → group `"trace"`). Each group becomes ONE `@effect/cli`
 * subcommand named by that token; the subcommand routes on the leading
 * positionals (the sub-verb) to the matching registration. This keeps the verb
 * FAMILIES (trace/inspector/navigation/lifecycle/…) addressable as
 * `run-expo <name> <sub-verb> [args]` without one `@effect/cli` subcommand per verb
 * (which would collide on the shared first token).
 */
const groupByFirstToken = (
  regs: ReadonlyArray<CommandRegistration>,
): ReadonlyArray<readonly [string, ReadonlyArray<CommandRegistration>]> => {
  const groups = new Map<string, Array<CommandRegistration>>()
  for (const reg of regs) {
    const name = reg.path.split(" ")[0] ?? reg.path
    const bucket = groups.get(name)
    if (bucket === undefined) {
      groups.set(name, [reg])
    } else {
      bucket.push(reg)
    }
  }
  return Array.from(groups.entries())
}

/**
 * Resolve the registration a user invoked within a first-token group, by
 * longest sub-verb prefix match against the supplied positionals. Returns the
 * matched registration plus the positionals AFTER its sub-verb literals (so
 * `build` sees only the args after the full verb path). Falls back to a bare
 * (sub-verb-less) registration in the group when nothing matches.
 */
const resolveInGroup = (
  group: ReadonlyArray<CommandRegistration>,
  args: ReadonlyArray<string>,
): readonly [CommandRegistration, ReadonlyArray<string>] | undefined => {
  // Longest sub-verb path first, so `live-backlog generate` wins over a bare
  // `live-backlog`.
  const sorted = [...group].sort((a, b) => b.path.split(" ").length - a.path.split(" ").length)
  for (const reg of sorted) {
    const subVerbs = reg.path.split(" ").slice(1)
    if (subVerbs.every((v, i) => args[i] === v)) {
      return [reg, args.slice(subVerbs.length)]
    }
  }
  return undefined
}

/** Resolve a CLI path or descriptor action to the descriptor owned by registry. */
const resolvePolicyDescriptor = (
  actionOrPath: string,
  ctx: Omit<Parameters<CommandRegistration["build"]>[0], "resolvePolicyDescriptor">,
): CommandDescriptor | undefined => {
  for (const candidate of registry.all) {
    if (candidate.path === actionOrPath) {
      return candidate.build(ctx).descriptor
    }
    const descriptor = candidate.build(ctx).descriptor
    if (descriptor.action === actionOrPath) {
      return descriptor
    }
  }
  return undefined
}

/**
 * The root command BASE — its NAME + global options, WITHOUT the subcommands
 * attached yet. Every subcommand handler references this value as a `@effect/cli`
 * config tag (`yield* rootBase`) to read the globals parsed in the ROOT scope,
 * i.e. the flags written BEFORE the subcommand. Splitting the base out (rather
 * than reading off the fully-assembled `rootCommand`) avoids a definition cycle:
 * the subcommands need the parent's tag, and the parent needs the subcommands.
 */
const rootBase = Command.make(CLI_NAME, { globals: globalOptions }, () =>
  Console.log(`${CLI_NAME} ${CLI_VERSION} — run with --help for commands.`),
).pipe(Command.withDescription("run-expo — local-first evidence CLI for Expo / RN iOS."))

/**
 * Build one `@effect/cli` subcommand for a first-token group. It carries the
 * shared global options plus a repeated positional arg list, picks the matching
 * registration by sub-verb, resolves the effective policy, runs the core command
 * THROUGH dispatch (gate + boundary), and emits the selected envelope. The
 * handler's effect is `void` (it prints); the exit code is carried out-of-band
 * via `ProgramExit` so `@effect/cli`'s ValidationError handling stays untouched.
 *
 * A `@effect/cli` flag binds to whichever scope it textually sits in, so the
 * handler MERGES the root-scope globals (`yield* rootBase`, flags before the
 * verb) with its own subcommand-scope globals (flags after the verb). Without
 * this merge, `--action-policy <file>` in the DOCUMENTED pre-verb position is
 * dropped and the gate fail-closed DENIES a granted action — the user-visible
 * "taps don't work when they should" bug.
 */
const subcommandForGroup = (name: string, group: ReadonlyArray<CommandRegistration>) => {
  const summary = group[0]?.summary ?? name
  return Command.make(
    name,
    { globals: globalOptions, args: Args.repeated(Args.text({ name: "args" })) },
    ({ globals, args }) =>
      Effect.gen(function* () {
        const { globals: rootGlobals } = yield* rootBase
        const effective = mergeGlobals(rootGlobals, globals)
        const resolved = resolveInGroup(group, args)
        if (resolved === undefined) {
          // Unknown sub-verb for a known family ⇒ usage error (exit 2).
          yield* emitUsageError(`Unknown subcommand: ${[name, ...args].join(" ")}`, effective)
          return yield* Effect.fail(new ProgramExit(2 as ExitCode))
        }
        const [reg, positionals] = resolved
        return yield* runVerb(reg, effective, positionals)
      }),
  ).pipe(Command.withDescription(summary))
}

/**
 * Carries the resolved non-zero POSIX exit code out of an otherwise-successful
 * `@effect/cli` run, via the error channel — so a command that finished but maps
 * to exit 1/2 surfaces a non-zero exit WITHOUT calling `process.exit` inside the
 * Effect (keeping the program testable). A zero exit takes the success path.
 */
class ProgramExit {
  readonly _tag = "ProgramExit" as const
  constructor(readonly code: ExitCode) {}
}

/** Run a single registered verb and emit its envelope. */
const runVerb = (
  reg: CommandRegistration,
  globals: CliGlobals,
  positionals: ReadonlyArray<string>,
): Effect.Effect<void, ProgramExit, Fs | Id | CapabilityEnv> =>
  Effect.gen(function* () {
    const fs = yield* Fs
    const id = yield* Id
    const policy = yield* resolvePolicy(globals)
    const baseContext = {
      positionals,
      policy,
      fs,
      root: Option.getOrElse(globals.root, () => process.cwd()),
      artifactsRoot: Option.getOrElse(globals.stateDir, () => Option.getOrElse(globals.root, () => process.cwd())),
    }
    const recorder = makeRunRecorder(reg, globals, positionals, baseContext, fs, id)
    const result: DispatchResult<unknown> = yield* runRegistered(
      reg,
      {
        ...baseContext,
        resolvePolicyDescriptor: (actionOrPath) => resolvePolicyDescriptor(actionOrPath, baseContext),
      },
      recorder,
    )
    yield* emit(result, globals)
    if (result.exitCode !== EXIT_SUCCESS) {
      return yield* Effect.fail(new ProgramExit(result.exitCode))
    }
  })

const makeRunRecorder = (
  reg: CommandRegistration,
  globals: CliGlobals,
  positionals: ReadonlyArray<string>,
  ctx: {
    readonly root: string
    readonly artifactsRoot: string
  },
  fs: FsPort,
  id: { readonly now: Effect.Effect<string>; readonly generateId: (prefix: string) => Effect.Effect<string> },
): RunRecorder => {
  if (!globals.record && Option.isNone(globals.stateDir)) {
    return {
      start: () => Effect.void,
      finish: () => Effect.void,
    }
  }
  const persistence = makePersistence(fs, defaultClock)
  let running: RunningRunRecord | null = null
  return {
    start: (descriptor) =>
      Effect.gen(function* () {
        const startedAt = yield* id.now
        const runId = (yield* id.generateId("run")) as RunId
        const redactedArgs = redact([reg.path, ...positionals])
        running = {
          schemaVersion: 1,
          runId,
          cli: { name: CLI_NAME, version: CLI_VERSION },
          command: descriptor.action,
          args: Array.isArray(redactedArgs) ? redactedArgs : [],
          root: ctx.root,
          stateDir: ctx.artifactsRoot,
          startedAt,
          finishedAt: null,
          status: "running",
          exitCode: null,
          summary: null,
          error: null,
        }
        yield* persistence.runStart(ctx.artifactsRoot, running)
      }),
    finish: (outcome) =>
      Effect.gen(function* () {
        if (running === null) return
        const finishedAt = yield* id.now
        const finished: FinishedRunRecord = {
          ...running,
          finishedAt,
          status: outcome.status,
          exitCode: outcome.exitCode,
          summary: summarizeRunRecordPayload(outcome.summary),
          error: outcome.status === "failed" ? `exit ${outcome.exitCode}` : null,
        }
        yield* persistence.runFinish(ctx.artifactsRoot, finished)
      }),
  }
}

// The registry always carries the 5 core READ proof-commands, so the subcommand
// tuple is non-empty by construction (asserted at module load). Verb FAMILIES
// (sharing a first token) collapse into one `@effect/cli` subcommand each.
const subcommands = groupByFirstToken(registry.all).map(([name, group]) => subcommandForGroup(name, group))
const subcommandsNonEmpty = asNonEmpty(subcommands)

/** The root command: `rootBase` (global options) + every registered verb. */
const rootCommand = Command.withSubcommands(rootBase, subcommandsNonEmpty)

/** Emit the finalised payload on the channel the globals selected. */
const emit = (result: DispatchResult<unknown>, globals: CliGlobals): Effect.Effect<void> => {
  const mode = selectMode(globals)
  switch (mode) {
    case "plain":
      return Console.log(formatPlain(result.payload))
    case "ndjson":
      return Console.log(formatNdjson(result.payload))
    case "json":
      return Console.log(formatJson(result.payload, result.exitCode))
  }
}

const emitUsageError = (message: string, globals: CliGlobals): Effect.Effect<void> => {
  switch (selectMode(globals)) {
    case "plain":
      return Console.error(String(redact(message)))
    case "ndjson":
      return Console.error(formatNdjson({ ok: false, error: message }))
    case "json":
      return Console.error(formatJson({ ok: false, error: message }, 2 as ExitCode))
  }
}

/**
 * Run the CLI over an explicit argv (the TESTABLE entry — no `process.exit`).
 *
 * `argv` is the FULL process argv form (`[node, script, ...userArgs]`) because
 * `@effect/cli`'s `Command.run` drops the first two tokens. The pre-parse guard
 * (AC-015/016) runs over the USER slice (`argv.slice(2)`) FIRST; a usage error
 * short-circuits to exit 2 without booting the command. Returns the POSIX exit
 * code.
 */
export const runProgram = (
  argv: ReadonlyArray<string>,
): Effect.Effect<ExitCode, never, Fs | Id | CapabilityEnv | NodeContext.NodeContext> =>
  Effect.gen(function* () {
    const userArgs = argv.slice(2)

    // ── N2 fix: AC-015/016 enforced BEFORE @effect/cli parses. ──
    const usage = yield* Effect.exit(assertUsage(userArgs))
    if (Exit.isFailure(usage)) {
      const error = failureValue(usage.cause)
      const code = exitCodeForError(error) // CliUsageError ⇒ 2
      yield* Console.error(formatJson({ ok: false, error: messageOf(error) }, code))
      return code
    }

    const run = Command.run(rootCommand, {
      name: CLI_NAME,
      version: CLI_VERSION,
    })

    // @effect/cli fails with ValidationError on its own checks; ProgramExit
    // carries a non-zero exit code out of a successful run. Map both here.
    const exit = yield* Effect.exit(run(argv))
    if (Exit.isSuccess(exit)) {
      return EXIT_SUCCESS
    }
    return resolveFailureExit(exit.cause)
  })

/** Map a failed @effect/cli/program Cause to the contractual POSIX exit code. */
const resolveFailureExit = (cause: Cause.Cause<unknown>): ExitCode => {
  const failure = Cause.failureOption(cause)
  if (Option.isSome(failure)) {
    const value = failure.value
    if (value instanceof ProgramExit) {
      return value.code
    }
    // @effect/cli ValidationError (missing value, unknown command, …) ⇒ usage.
    if (isValidationError(value)) {
      return 2
    }
    return exitCodeForError(value)
  }
  // A defect (die) or interruption ⇒ runtime failure.
  return 1
}

const isValidationError = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  // ValidationError tags from @effect/cli (e.g. MissingValue, MissingFlag, …).
  [
    "MissingValue",
    "MissingFlag",
    "MissingSubcommand",
    "InvalidValue",
    "InvalidArgument",
    "CommandMismatch",
    "MultipleValuesDetected",
    "UnclusteredFlag",
    "CorrectedFlag",
    "NoBuiltInMatch",
  ].includes(String((value as { _tag: unknown })._tag))

const failureValue = (cause: Cause.Cause<unknown>): unknown => Option.getOrElse(Cause.failureOption(cause), () => cause)

const messageOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof (error as { message: unknown }).message === "string"
    ? (error as { message: string }).message
    : String(error)

/**
 * The real process entry: run over `process.argv`, apply the POSIX exit code via
 * a custom `NodeRuntime` teardown (NOT `defaultTeardown`, which maps every
 * failure to exit 1 — the N2 root cause). The `run-expo` bin resolves here.
 */
export const main = (): void => {
  const program = runProgram(process.argv).pipe(Effect.provide(AppLayer))
  NodeRuntime.runMain(
    program.pipe(
      Effect.tap((code) =>
        Effect.sync(() => {
          process.exitCode = code
        }),
      ),
    ),
    { disablePrettyLogger: true },
  )
}

// Execute ONLY when invoked as the process entry (not when imported by a test).
// `process.argv[1]` is the script path; compare against this module's URL.
if (isEntryModule()) {
  main()
}
