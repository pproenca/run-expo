/**
 * `navigation` — D10 navigation reads + mutations (AC-007).
 *
 *   - `state`                          → `read`   (ungated)
 *   - `back`, `pop-to-root`, `tab`,
 *     `deep-link`                      → `device` (gated — mutates app nav state)
 *
 * Mirrors the inspector pattern: ONE command name, verbs mapped to classes via
 * an EXHAUSTIVE `Match`; each verb yields a `Command<S, …>` whose handler `R` is
 * bounded to `CapabilityFor<S>`. `state`'s handler is `R = never`.
 */
import { command, type Command, DeviceCapability } from "@expo98/core"
import { Effect, Match } from "effect"
import { descriptor } from "./support.js"

export type NavigationReadVerb = "state"
export type NavigationDeviceVerb = "back" | "pop-to-root" | "tab" | "deep-link"
export type NavigationVerb = NavigationReadVerb | NavigationDeviceVerb

export type NavigationSideEffect = "read" | "device"

/**
 * Per-verb side-effect class. EXHAUSTIVE — a new verb without a branch is a
 * COMPILE error (AC-007: nav mutations can never silently become ungated).
 */
export const navigationSideEffect = (verb: NavigationVerb): NavigationSideEffect =>
  Match.value(verb).pipe(
    Match.when("state", () => "read" as const),
    Match.when("back", () => "device" as const),
    Match.when("pop-to-root", () => "device" as const),
    Match.when("tab", () => "device" as const),
    Match.when("deep-link", () => "device" as const),
    Match.exhaustive,
  )

export interface NavigationArgs {
  /** Tab key for `tab`, or URL for `deep-link`. */
  readonly target?: string
  /** Caller-supplied read evidence for `state`; absent evidence is explicit. */
  readonly state?: unknown
}

export interface NavigationResult {
  readonly action: string
  readonly verb: NavigationVerb
  readonly sideEffect: NavigationSideEffect
  readonly available?: boolean
  readonly reason?: string
  readonly value: unknown
}

const result = (verb: NavigationVerb, sideEffect: NavigationSideEffect, value: unknown): NavigationResult => ({
  action: `navigation.${verb}`,
  verb,
  sideEffect,
  value,
})

/** `state` is a pure read — handler `R = never`. */
const readNavigationCommand = (verb: NavigationReadVerb, args: NavigationArgs): Command<"read", NavigationResult> =>
  command(
    descriptor(`navigation.${verb}`, "read"),
    Effect.sync(() => {
      if (args.state === undefined) {
        return {
          ...result(verb, "read", null),
          available: false,
          reason: "No navigation read evidence was provided.",
        }
      }
      return { ...result(verb, "read", args.state), available: true }
    }),
  )

/** A mutating nav verb — reaches the device capability via `R` (gated). */
const deviceNavigationCommand = (
  verb: NavigationDeviceVerb,
  args: NavigationArgs,
): Command<"device", NavigationResult> =>
  command(
    descriptor(`navigation.${verb}`, "device"),
    Effect.gen(function* () {
      if ((verb === "tab" || verb === "deep-link") && (args.target === undefined || args.target.length === 0)) {
        return {
          ...result(verb, "device", null),
          available: false,
          reason: `${verb} requires a target.`,
        } satisfies NavigationResult
      }
      const device = yield* DeviceCapability
      const value = yield* device.invoke("xcrun", ["simctl", "navigate", verb, args.target ?? ""])
      return result(verb, "device", value)
    }),
  )

export type NavigationCommand = Command<"read", NavigationResult> | Command<"device", NavigationResult>

/** Build the right per-class nav command for a verb (EXHAUSTIVE over the class). */
export const navigationCommand = (verb: NavigationVerb, args: NavigationArgs = {}): NavigationCommand =>
  Match.value(navigationSideEffect(verb)).pipe(
    Match.when("read", () => readNavigationCommand(verb as NavigationReadVerb, args)),
    Match.when("device", () => deviceNavigationCommand(verb as NavigationDeviceVerb, args)),
    Match.exhaustive,
  )
