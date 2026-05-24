import {
  type CapabilityEnv,
  type Command as CoreCommand,
  type CommandDescriptor,
  dispatch,
  type DispatchResult,
  NoopRecorder,
  type PolicyDocument,
  type RunRecorder,
  type SideEffect,
} from "@expo98/core"
import { type FsPort } from "@expo98/domain"
import { Effect } from "effect"

/**
 * Command registry + composition wiring (S12).
 *
 * A `CommandRegistration` couples a core command descriptor with the factory
 * that builds the typed core `Command` for a given parsed-args context, and the
 * `@effect/cli` surface metadata used to expose it. `registerCommands` accepts
 * these and yields a lookup keyed by the CLI verb path.
 *
 * Each handler/integration package exports command BUILDERS (`*Command(verb,
 * args) => Command<S, A>`). The composition root (`all-commands.ts`) wraps each
 * verb in a `CommandRegistration` and registers the whole surface via
 * `registerCommands([...coreReadCommands, ...handlerCommands])`. Per-class
 * registrations are erased into the heterogeneous array form by
 * `eraseRegistration` (see its doc for why the cast is sound).
 */

/** Args parsed for a single command invocation (positional + value flags). */
export interface CommandContext {
  /** Positional arguments after the verb (e.g. `["show"]` for `policy show`). */
  readonly positionals: ReadonlyArray<string>
  /** The effective policy document (from `--action-policy` + global flags). */
  readonly policy: PolicyDocument
  /**
   * The resolved filesystem PORT, for BENIGN reads (e.g. `redact <file>`).
   * Passing it via the context — rather than the handler's `R` — keeps a read
   * handler's `R = never` (the capability-withholding contract): `Fs` is not a
   * dangerous capability, so it is not gated, but it also never widens the
   * dangerous-capability surface a read command can name.
   */
  readonly fs: FsPort
}

/**
 * A registration: the CLI verb path, a human summary, and a factory producing
 * the typed core `Command` for a parsed context. The factory is generic over the
 * side-effect class so capability withholding is preserved end-to-end — a `read`
 * command's handler cannot name a dangerous capability (compile error).
 */
export interface CommandRegistration<S extends SideEffect = SideEffect> {
  /** Space-joined verb path, e.g. `"policy show"`, `"redact"`, `"doctor"`. */
  readonly path: string
  /** One-line help summary. */
  readonly summary: string
  /** The declared side-effect class of the command (drives the gate). */
  readonly sideEffect: S
  /** Build the typed core command for a parsed context. */
  readonly build: (ctx: CommandContext) => CoreCommand<S, unknown>
}

/** A helper that constructs a registration while pinning `S` from the descriptor. */
export const registration = <S extends SideEffect>(reg: CommandRegistration<S>): CommandRegistration<S> => reg

/**
 * Erase a per-class `CommandRegistration<S>` into the heterogeneous registry
 * form (`CommandRegistration<SideEffect>`) so device / runtime-eval / source-write
 * registrations can live in the SAME array as read ones.
 *
 * Why a cast is needed (and why it is SOUND): `Command<S, A>`'s handler `R` is
 * `CapabilityFor<S>`, which is CONTRAVARIANT in the Effect environment. A
 * `Command<"device", …>` (`R = DeviceCapability`) is therefore NOT structurally
 * assignable to `Command<SideEffect, …>` (`R = the full capability union`) — only
 * a `read` command (`R = never`) is. But the ONLY consumer of a stored
 * registration is `runRegistered`, which funnels `build(ctx)` straight into core's
 * `dispatch`, and `dispatch` PROVIDES every capability in `CapabilityEnv` on the
 * gate-pass branch. So discharging the handler against the full env is exactly
 * what happens at runtime; the cast localises that single, sound bridge here —
 * mirroring core's own localised cast in `provideCapabilityFor`. No per-command
 * builder type is weakened: each `*Command(verb)` stays fully typed at its call
 * site; only the array element type is erased.
 */
export const eraseRegistration = <S extends SideEffect>(reg: CommandRegistration<S>): CommandRegistration =>
  reg as unknown as CommandRegistration

/** The assembled registry: verb path → registration. */
export interface Registry {
  readonly get: (path: string) => CommandRegistration | undefined
  readonly paths: ReadonlyArray<string>
  readonly all: ReadonlyArray<CommandRegistration>
}

/**
 * Build a registry from the supplied registrations.
 *
 * The composition root passes the core READ proof-commands alongside every
 * handler/integration registration (see `all-commands.ts`):
 *
 *   registerCommands([...coreReadCommands, ...handlerCommands])
 *
 * Duplicate paths throw at composition time (fail fast) so a handler package
 * cannot silently shadow a core command.
 */
export const registerCommands = (registrations: ReadonlyArray<CommandRegistration>): Registry => {
  const byPath = new Map<string, CommandRegistration>()
  for (const reg of registrations) {
    if (byPath.has(reg.path)) {
      throw new Error(`Duplicate command path registered: "${reg.path}"`)
    }
    byPath.set(reg.path, reg)
  }
  return {
    get: (path) => byPath.get(path),
    paths: Array.from(byPath.keys()),
    all: Array.from(byPath.values()),
  }
}

/**
 * Run a registered command end-to-end THROUGH core's dispatch: classify → gate →
 * capability-inject-iff-allowed → run → redact + truncate → finalised result.
 *
 * This is the single execution path every CLI verb funnels through, so the gate
 * and the output boundary are applied uniformly (no per-handler bypass).
 */
export const runRegistered = (
  reg: CommandRegistration,
  ctx: CommandContext,
  recorder: RunRecorder = NoopRecorder,
): Effect.Effect<DispatchResult<unknown>, never, CapabilityEnv> => dispatch(reg.build(ctx), ctx.policy, recorder)

/** Re-export the descriptor type so handler authors import one surface. */
export type { CommandDescriptor }
