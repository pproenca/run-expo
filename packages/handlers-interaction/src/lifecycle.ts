/**
 * D6 — app & simulator lifecycle handlers (AC-005, AC-029, AC-056).
 *
 * Every lifecycle command is classed `device`, so the dispatcher provides
 * `DeviceCapability` into the handler's `R` ONLY on the gate-pass branch. A denied
 * command never builds the handler — so it performs ZERO `xcrun`/`simctl` work
 * (AC-005). Handlers NEVER import a subprocess/protocol surface directly; they
 * reach the simulator solely through the injected `DeviceCapability`.
 *
 * Verbs:
 *   boot-simulator · open-url · launch-app · terminate-app · reload-app ·
 *   install-app · uninstall-app · open-route · set        → all `device`
 *
 * Special behaviours:
 *   - `launch-app` / `reload-app`: AFTER the device action, scan the iOS crash
 *     directory through the SAME injected capability and attach a `crashCheck`;
 *     fail closed (`available:false`) on ≥1 post-launch crash (AC-029/056).
 *   - `install-app` / `uninstall-app` with `--dry-run`: return a PLAN with the
 *     policy attached and mutate nothing — the device capability is invoked 0×.
 */
import { command, type Command, DeviceCapability } from "@expo98/core"
import { Effect, Match } from "effect"
import {
  type CrashAction,
  type CrashCheck,
  type CrashReport,
  type CrashReportCandidate,
  evaluateCrash,
  isCrashReportPath,
  resolveCrashGraceMs
} from "./crash.js"
import { descriptor } from "./support.js"

/** The nine D6 lifecycle verbs. ALL classed `device`. */
export type LifecycleVerb =
  | "boot-simulator"
  | "open-url"
  | "launch-app"
  | "terminate-app"
  | "reload-app"
  | "install-app"
  | "uninstall-app"
  | "open-route"
  | "set"

/**
 * Per-verb side-effect class. EXHAUSTIVE — a new verb without a branch is a
 * COMPILE error (AC-005: a lifecycle verb can never silently go ungated).
 */
export const lifecycleSideEffect = (verb: LifecycleVerb): "device" =>
  Match.value(verb).pipe(
    Match.when("boot-simulator", () => "device" as const),
    Match.when("open-url", () => "device" as const),
    Match.when("launch-app", () => "device" as const),
    Match.when("terminate-app", () => "device" as const),
    Match.when("reload-app", () => "device" as const),
    Match.when("install-app", () => "device" as const),
    Match.when("uninstall-app", () => "device" as const),
    Match.when("open-route", () => "device" as const),
    Match.when("set", () => "device" as const),
    Match.exhaustive
  )

export interface LifecycleArgs {
  readonly device?: string
  readonly bundleId?: string
  readonly url?: string
  readonly appPath?: string
  readonly route?: string
  readonly scheme?: string
  readonly setting?: string
  readonly value?: string
  /** Crash-grace override (ms) for launch/reload (AC-056). */
  readonly crashCheckMs?: number
  /** When true, install/uninstall returns a plan and mutates nothing (AC-005). */
  readonly dryRun?: boolean
}

export interface LifecycleResult {
  readonly action: string
  readonly verb: LifecycleVerb
  readonly device: string
  readonly value: unknown
  readonly available?: boolean
  readonly reason?: string | null
  readonly crashCheck?: CrashCheck
  readonly crashReports?: ReadonlyArray<CrashReport>
}

/** AC-005 dry-run plan: the operation that WOULD run, with policy attached later. */
export interface LifecyclePlan {
  readonly action: string
  readonly verb: LifecycleVerb
  readonly dryRun: true
  readonly tool: string
  readonly args: ReadonlyArray<string>
}

const DEFAULT_DEVICE = "booted" as const

/** The argv the device capability would receive for a given verb. */
const argvFor = (verb: LifecycleVerb, args: LifecycleArgs): ReadonlyArray<string> => {
  const device = args.device ?? DEFAULT_DEVICE
  return Match.value(verb).pipe(
    Match.when("boot-simulator", () => ["simctl", "boot", device]),
    Match.when("open-url", () => ["simctl", "openurl", device, args.url ?? ""]),
    Match.when("launch-app", () => ["simctl", "launch", device, args.bundleId ?? ""]),
    Match.when("terminate-app", () => [
      "simctl",
      "terminate",
      device,
      args.bundleId ?? ""
    ]),
    Match.when("reload-app", () => ["simctl", "launch", device, args.bundleId ?? ""]),
    Match.when("install-app", () => ["simctl", "install", device, args.appPath ?? ""]),
    Match.when("uninstall-app", () => [
      "simctl",
      "uninstall",
      device,
      args.bundleId ?? ""
    ]),
    Match.when("open-route", () => [
      "simctl",
      "openurl",
      device,
      `${args.scheme ?? "exp"}://${args.route ?? ""}`
    ]),
    Match.when("set", () => [
      "simctl",
      "ui",
      device,
      args.setting ?? "",
      args.value ?? ""
    ]),
    Match.exhaustive
  )
}

/** Which verbs carry a post-launch crash check (AC-029). */
const crashActionFor = (verb: LifecycleVerb): CrashAction | null =>
  verb === "launch-app" ? "launch-app" : verb === "reload-app" ? "reload-app" : null

/** Which verbs honour `--dry-run` (AC-005). */
const supportsDryRun = (verb: LifecycleVerb): boolean =>
  verb === "install-app" || verb === "uninstall-app"

/**
 * The simctl probe used to scan the iOS crash report directory. The device
 * capability runs it via argv (no shell); the handler then parses the listed
 * paths/mtimes. (A real build resolves the per-device DiagnosticReports dir; here
 * the listing tool is package-controlled and the parsing is pure.)
 */
const CRASH_SCAN_ARGS: ReadonlyArray<string> = [
  "simctl",
  "spawn",
  "booted",
  "log",
  "collect",
  "--crash-reports"
]

/**
 * Parse the crash-scan tool output into candidates. Each non-empty line is
 * `<path>\t<mtimeMs>`; only `.ips`/`.crash` paths are kept (AC-029). Lines that
 * do not parse are skipped (never crash on malformed device output).
 */
const parseCrashCandidates = (output: string): ReadonlyArray<CrashReportCandidate> =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line): ReadonlyArray<CrashReportCandidate> => {
      const tab = line.lastIndexOf("\t")
      if (tab < 0) {
        return []
      }
      const path = line.slice(0, tab)
      const mtimeMs = Number(line.slice(tab + 1))
      if (!isCrashReportPath(path) || !Number.isFinite(mtimeMs)) {
        return []
      }
      return [{ path, mtimeMs }]
    })

/**
 * Build a `device`-classed lifecycle command.
 *
 * For non-crash verbs the handler invokes the device capability once and returns
 * its value. For `launch-app`/`reload-app` it (1) records `startedAt`, (2) invokes
 * the device action, (3) scans the crash directory through the SAME capability,
 * (4) evaluates the crash and attaches/fails-closes (AC-029/056). The handler's
 * `R` is `DeviceCapability`; it cannot name the eval/source-write capability.
 */
export const lifecycleCommand = (
  verb: LifecycleVerb,
  args: LifecycleArgs = {}
): Command<"device", LifecycleResult> => {
  const action = verb
  const device = args.device ?? DEFAULT_DEVICE
  const crashAction = crashActionFor(verb)

  // Crash-bearing verbs: run the action, then scan + evaluate the crash window.
  if (crashAction !== null) {
    const waitedMs = resolveCrashGraceMs(args.crashCheckMs)
    const bundleId = args.bundleId ?? ""
    return command(
      descriptor(action, "device"),
      DeviceCapability.pipe(
        Effect.flatMap((cap) =>
          Effect.gen(function* () {
            const startedAt = Date.now()
            const value = yield* cap.invoke("xcrun", argvFor(verb, args))
            const scan = yield* cap.invoke("xcrun", CRASH_SCAN_ARGS)
            const evaluation = evaluateCrash({
              action: crashAction,
              bundleId,
              processName: bundleId,
              startedAt,
              waitedMs,
              candidates: parseCrashCandidates(scan)
            })
            const result: LifecycleResult = {
              action,
              verb,
              device,
              value,
              available: evaluation.available,
              reason: evaluation.reason,
              crashCheck: evaluation.crashCheck,
              crashReports: evaluation.crashReports
            }
            return result
          })
        )
      )
    )
  }

  // Non-crash verb: a single device invocation.
  return command(
    descriptor(action, "device"),
    DeviceCapability.pipe(
      Effect.flatMap((cap) => cap.invoke("xcrun", argvFor(verb, args))),
      Effect.map(
        (value): LifecycleResult => ({ action, verb, device, value })
      )
    )
  )
}

/**
 * AC-005 dry-run: build the PLAN for an `install-app`/`uninstall-app` without ANY
 * device work. This is a pure value (no capability in `R`), so the dispatcher
 * still gates it as `device` but the handler invokes the device capability 0×.
 * The caller (dispatch) attaches the policy; here we surface the plan.
 */
export const lifecyclePlan = (
  verb: LifecycleVerb,
  args: LifecycleArgs = {}
): Command<"device", LifecyclePlan> => {
  if (!supportsDryRun(verb)) {
    throw new Error(`Verb "${verb}" does not support --dry-run.`)
  }
  const plan: LifecyclePlan = {
    action: verb,
    verb,
    dryRun: true,
    tool: "xcrun",
    args: argvFor(verb, args)
  }
  // A dry-run plan is a pure value; the handler reaches no capability (R never
  // names DeviceCapability), so even on gate-pass it mutates nothing (AC-005).
  return command(descriptor(verb, "device"), Effect.succeed(plan))
}

/**
 * Choose the right lifecycle command for a verb, honouring `--dry-run` for the
 * install/uninstall verbs (AC-005). EXHAUSTIVE over the dry-run/real split.
 */
export const lifecycle = (
  verb: LifecycleVerb,
  args: LifecycleArgs = {}
): Command<"device", LifecycleResult> | Command<"device", LifecyclePlan> =>
  args.dryRun === true && supportsDryRun(verb)
    ? lifecyclePlan(verb, args)
    : lifecycleCommand(verb, args)
