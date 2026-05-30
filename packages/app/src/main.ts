#!/usr/bin/env node
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Args, Command } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { type CapabilityEnv, type DispatchResult, EXIT_SUCCESS, type ExitCode, exitCodeForError } from "@expo98/core"
import { Fs } from "@expo98/domain"
import { Cause, Console, Effect, Exit, Layer, Option } from "effect"
import { handlerCommands } from "./all-commands.js"
import { CLI_VERSION, coreReadCommands } from "./commands.js"
import { formatJson, formatPlain, selectMode } from "./envelope.js"
import { type CliGlobals, assertUsage, globalOptions } from "./globals.js"
import { AppLayer } from "./layers.js"
import { resolvePolicy } from "./policy-resolve.js"
import { type CommandRegistration, registerCommands, runRegistered } from "./registry.js"

/**
 * The CLI shell composition root (S12).
 *
 * Bin: `expo98` — the single published executable. The bundle/bin step
 * (esbuild → `cli/expo98.mjs`, declared as the package `bin`) is wired in
 * `scripts/build.mjs`; the bundle is the runnable artifact (the `.ts` source
 * resolves `.js`→`.ts` specifiers only under a bundler).
 */

export const CLI_NAME = "expo98"

// The assembled registry: the core READ proof-commands + the full handler /
// integration surface. Every verb funnels through core's dispatch (gate +
// capability-injection + redaction + exit-code mapping) — see registry.ts /
// all-commands.ts.
const registry = registerCommands([...coreReadCommands, ...handlerCommands])

/** Assert (and type) a runtime-non-empty array as a non-empty tuple. */
const asNonEmpty = <T>(arr: ReadonlyArray<T>): readonly [T, ...Array<T>] => {
  const [head, ...tail] = arr
  if (head === undefined) {
    throw new Error("expo98: no commands registered (expected the core read set).")
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
 * `expo98 <name> <sub-verb> [args]` without one `@effect/cli` subcommand per verb
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

/**
 * Build one `@effect/cli` subcommand for a first-token group. It carries the
 * shared global options plus a repeated positional arg list, picks the matching
 * registration by sub-verb, resolves the effective policy, runs the core command
 * THROUGH dispatch (gate + boundary), and emits the selected envelope. The
 * handler's effect is `void` (it prints); the exit code is carried out-of-band
 * via `ProgramExit` so `@effect/cli`'s ValidationError handling stays untouched.
 */
const subcommandForGroup = (name: string, group: ReadonlyArray<CommandRegistration>) => {
  const summary = group[0]?.summary ?? name
  return Command.make(
    name,
    { globals: globalOptions, args: Args.repeated(Args.text({ name: "args" })) },
    ({ globals, args }) => {
      const resolved = resolveInGroup(group, args)
      if (resolved === undefined) {
        // Unknown sub-verb for a known family ⇒ usage error (exit 2).
        return Effect.fail(new ProgramExit(2 as ExitCode))
      }
      const [reg, positionals] = resolved
      return runVerb(reg, globals, positionals)
    },
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
): Effect.Effect<void, ProgramExit, Fs | CapabilityEnv> =>
  Effect.gen(function* () {
    const fs = yield* Fs
    const policy = yield* resolvePolicy(globals)
    const result: DispatchResult<unknown> = yield* runRegistered(reg, {
      positionals,
      policy,
      fs,
    })
    yield* emit(result, globals)
    if (result.exitCode !== EXIT_SUCCESS) {
      return yield* Effect.fail(new ProgramExit(result.exitCode))
    }
  })

// The registry always carries the 5 core READ proof-commands, so the subcommand
// tuple is non-empty by construction (asserted at module load). Verb FAMILIES
// (sharing a first token) collapse into one `@effect/cli` subcommand each.
const subcommands = groupByFirstToken(registry.all).map(([name, group]) => subcommandForGroup(name, group))
const subcommandsNonEmpty = asNonEmpty(subcommands)

/** The root command: global options + every registered verb as a subcommand. */
const rootCommand = Command.make(CLI_NAME, { globals: globalOptions }, () =>
  Console.log(`${CLI_NAME} ${CLI_VERSION} — run with --help for commands.`),
).pipe(Command.withDescription("expo98 — local-first evidence CLI for Expo / RN iOS."), (self) =>
  Command.withSubcommands(self, subcommandsNonEmpty),
)

/** Emit the finalised payload on the channel the globals selected. */
const emit = (result: DispatchResult<unknown>, globals: CliGlobals): Effect.Effect<void> => {
  const mode = selectMode(globals)
  switch (mode) {
    case "plain":
      return Console.log(formatPlain(result.payload))
    case "ndjson":
      // The proof read commands return a single payload (not a progress stream),
      // so NDJSON degrades to a single redacted+truncated JSON line. Streaming
      // handlers (deferred) return a `Stream` piped via `ndjsonEnvelope`.
      return Console.log(formatJson(result.payload, result.exitCode))
    case "json":
      return Console.log(formatJson(result.payload, result.exitCode))
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
): Effect.Effect<ExitCode, never, Fs | CapabilityEnv | NodeContext.NodeContext> =>
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
 * failure to exit 1 — the N2 root cause). The `expo98` bin resolves here.
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
