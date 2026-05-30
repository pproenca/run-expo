import { Context, Effect } from "effect"
import { SubprocessFailed, SubprocessTimeout, ToolNotFound, type ConfinedPath } from "./errors.js"

/**
 * The three DANGEROUS capabilities. Each is a `Context.Tag`.
 *
 * THE CRUX (architecture §1 thesis): these tags are the ONLY way a handler can
 * perform a side effect of the corresponding class. The dispatcher provides them
 * into a handler's `R` environment ONLY AFTER the gate passes for that command's
 * declared class. A `read`-classed handler's `R` simply lacks these tags, so
 * naming one is a COMPILE error — fail-closed becomes a type-level property, not
 * a runtime convention (this is what makes AC-010/AC-011 a compile-time
 * guarantee).
 */

/** runtime-eval capability — injects/evaluates JS in the app (CDP). AC-004/010/011. */
export interface RuntimeEvalCapabilityService {
  /** Evaluate an expression in the running app and return the value by-value. */
  readonly evaluate: (expression: string, options?: { readonly metroPort?: number }) => Effect.Effect<unknown>
}

export class RuntimeEvalCapability extends Context.Tag("@expo98/core/RuntimeEvalCapability")<
  RuntimeEvalCapability,
  RuntimeEvalCapabilityService
>() {}

/** device capability — drives the simulator/device via subprocess. AC-005/006/007. */
export interface DeviceCapabilityService {
  /** Invoke a device tool (xcrun/simctl/idb/…) with argv (no shell). */
  readonly invoke: (
    tool: string,
    args: ReadonlyArray<string>,
  ) => Effect.Effect<string, ToolNotFound | SubprocessTimeout | SubprocessFailed>
}

export class DeviceCapability extends Context.Tag("@expo98/core/DeviceCapability")<
  DeviceCapability,
  DeviceCapabilityService
>() {}

/** source-write capability — writes/deletes project source files. AC-008. */
export interface SourceWriteCapabilityService {
  readonly writeFile: (path: ConfinedPath, contents: string) => Effect.Effect<void>
  readonly deleteFile: (path: ConfinedPath) => Effect.Effect<void>
}

export class SourceWriteCapability extends Context.Tag("@expo98/core/SourceWriteCapability")<
  SourceWriteCapability,
  SourceWriteCapabilityService
>() {}

/**
 * The union of capability tag *identifiers* a handler may require. Used purely
 * to express the dispatcher's input bound — a handler's `R` is some subset of
 * these (or `never` for a read-classed handler).
 */
export type AnyCapability = RuntimeEvalCapability | DeviceCapability | SourceWriteCapability
