/**
 * D7 — interaction / gesture handlers (AC-013, AC-036, AC-037, AC-054).
 *
 * All interaction commands are classed `device`: the dispatcher provides
 * `DeviceCapability` into `R` ONLY on the gate-pass branch, so a denied command
 * does ZERO device work. Handlers NEVER import a subprocess/protocol surface —
 * they reach the simulator solely through the injected capability.
 *
 *   tap · gesture (long-press/drag/swipe/tap) · the 11 ref-actions
 *   (long-press/dbltap/fill/focus/blur/select/check/uncheck/drag/scroll/
 *   scroll-into-view) · type/press/keyboard · clipboard · screenshot
 *
 * The pure geometry (AC-036 centre, AC-037 deltas/clamps, AC-054 stitch) lives in
 * `gesture-plan.ts` / `screenshot-geometry.ts`; the handlers here drive the device
 * with those plans. `screenshot --output-path` is confined under the artifacts
 * root via core's `confinePath` BEFORE any write (AC-013).
 */
import { command, type Command, confinePath, DeviceCapability } from "@expo98/core"
import { Effect, Match } from "effect"
import {
  type GestureArgs,
  type GestureKind,
  type GesturePlan,
  planGesture,
  planScroll,
  pointForBox,
  type ScreenBox,
  type ScreenPoint,
  type ScrollArgs,
  type ScrollDirection,
  type ScrollPlan
} from "./gesture-plan.js"
import {
  type FullScreenshotArgs,
  type FullScreenshotPlan,
  planFullScreenshot
} from "./screenshot-geometry.js"
import { descriptor } from "./support.js"

const DEFAULT_DEVICE = "booted" as const

// ── tap (device) ──

export interface TapArgs {
  readonly x?: number
  readonly y?: number
  readonly device?: string
}

export interface TapResult {
  readonly action: "tap"
  readonly point: ScreenPoint
  readonly value: unknown
}

export const tapCommand = (args: TapArgs = {}): Command<"device", TapResult> => {
  const point: ScreenPoint = { x: args.x ?? 0, y: args.y ?? 0 }
  const device = args.device ?? DEFAULT_DEVICE
  return command(
    descriptor("tap", "device"),
    DeviceCapability.pipe(
      Effect.flatMap((cap) =>
        cap.invoke("idb", ["ui", "tap", "--udid", device, String(point.x), String(point.y)])
      ),
      Effect.map((value): TapResult => ({ action: "tap", point, value }))
    )
  )
}

// ── gesture (device): long-press / drag / swipe / tap, planned then driven ──

export interface GestureResult {
  readonly action: "gesture"
  readonly kind: GestureKind
  readonly plan: GesturePlan
  readonly value: unknown
}

export const gestureCommand = (
  kind: GestureKind,
  args: GestureArgs = {}
): Command<"device", GestureResult> => {
  const plan = planGesture(kind, args)
  return command(
    descriptor("gesture", "device"),
    DeviceCapability.pipe(
      Effect.flatMap((cap) =>
        cap.invoke("idb", [
          "ui",
          "gesture",
          kind,
          String(plan.from.x),
          String(plan.from.y),
          String(plan.to.x),
          String(plan.to.y),
          "--duration",
          String(plan.durationMs)
        ])
      ),
      Effect.map((value): GestureResult => ({ action: "gesture", kind, plan, value }))
    )
  )
}

// ── ref-actions (device): the 11 verbs over an @eN ref ──

export type RefActionVerb =
  | "long-press"
  | "dbltap"
  | "fill"
  | "focus"
  | "blur"
  | "select"
  | "check"
  | "uncheck"
  | "drag"
  | "scroll"
  | "scroll-into-view"

/** Which ref-actions need element coordinates (so a missing box → unavailable). */
const POINT_ACTIONS: ReadonlyArray<RefActionVerb> = [
  "long-press",
  "dbltap",
  "fill",
  "select",
  "check",
  "uncheck",
  "drag",
  "scroll",
  "scroll-into-view"
]

export const refActionIsPointAction = (verb: RefActionVerb): boolean =>
  POINT_ACTIONS.includes(verb)

export interface RefActionArgs {
  readonly box?: ScreenBox | null
  readonly value?: string
  readonly direction?: ScrollDirection
  readonly device?: string
}

export interface RefActionResult {
  readonly action: string
  readonly verb: RefActionVerb
  readonly ref: string
  readonly point: ScreenPoint | null
  readonly scroll: ScrollPlan | null
  readonly value: unknown
}

/**
 * A ref-action handler. The centre point (AC-036) is computed from the supplied
 * box; `scroll`/`scroll-into-view` additionally carry an AC-037 scroll plan. The
 * device is driven through the injected capability; the handler's `R` cannot name
 * the eval/source-write capability.
 */
export const refActionCommand = (
  verb: RefActionVerb,
  ref: string,
  args: RefActionArgs = {}
): Command<"device", RefActionResult> => {
  const point = pointForBox(args.box ?? null)
  const scroll =
    verb === "scroll" || verb === "scroll-into-view"
      ? planScroll(args.direction ?? "down", {})
      : null
  const device = args.device ?? DEFAULT_DEVICE
  return command(
    descriptor(`ref.${verb}`, "device"),
    DeviceCapability.pipe(
      Effect.flatMap((cap) =>
        cap.invoke("idb", [
          "ui",
          verb,
          "--udid",
          device,
          ref,
          ...(args.value !== undefined ? [args.value] : [])
        ])
      ),
      Effect.map(
        (value): RefActionResult => ({
          action: `ref.${verb}`,
          verb,
          ref,
          point,
          scroll,
          value
        })
      )
    )
  )
}

// ── keyboard: type / press / keyboard (device) ──

export type KeyboardVerb = "type" | "press" | "keyboard"

export interface KeyboardArgs {
  readonly text?: string
  readonly key?: string
  readonly device?: string
}

export interface KeyboardResult {
  readonly action: KeyboardVerb
  readonly verb: KeyboardVerb
  readonly value: unknown
}

export const keyboardCommand = (
  verb: KeyboardVerb,
  args: KeyboardArgs = {}
): Command<"device", KeyboardResult> => {
  const device = args.device ?? DEFAULT_DEVICE
  const argv = Match.value(verb).pipe(
    Match.when("type", () => ["ui", "text", "--udid", device, args.text ?? ""]),
    Match.when("press", () => ["ui", "key", "--udid", device, args.key ?? ""]),
    Match.when("keyboard", () => ["ui", "key", "--udid", device, args.key ?? ""]),
    Match.exhaustive
  )
  return command(
    descriptor(verb, "device"),
    DeviceCapability.pipe(
      Effect.flatMap((cap) => cap.invoke("idb", argv)),
      Effect.map((value): KeyboardResult => ({ action: verb, verb, value }))
    )
  )
}

// ── clipboard: read / write / paste (device) ──

export type ClipboardVerb = "read" | "write" | "paste"

export interface ClipboardArgs {
  readonly text?: string
  readonly device?: string
}

export interface ClipboardResult {
  readonly action: "clipboard"
  readonly verb: ClipboardVerb
  readonly value: unknown
}

export const clipboardCommand = (
  verb: ClipboardVerb,
  args: ClipboardArgs = {}
): Command<"device", ClipboardResult> => {
  const device = args.device ?? DEFAULT_DEVICE
  const argv = Match.value(verb).pipe(
    Match.when("read", () => ["simctl", "pbpaste", device]),
    Match.when("write", () => ["simctl", "pbcopy", device]),
    Match.when("paste", () => ["simctl", "pbpaste", device]),
    Match.exhaustive
  )
  return command(
    descriptor("clipboard", "device"),
    DeviceCapability.pipe(
      Effect.flatMap((cap) => cap.invoke("xcrun", argv)),
      Effect.map((value): ClipboardResult => ({ action: "clipboard", verb, value }))
    )
  )
}

// ── screenshot (device): writes a file → --output-path confined (AC-013) ──

export interface ScreenshotArgs extends FullScreenshotArgs {
  readonly full?: boolean
  readonly annotate?: boolean
  /** User-supplied output path; confined under `artifactsRoot` (AC-013). */
  readonly outputPath?: string
  readonly device?: string
}

export interface ScreenshotResult {
  readonly action: "screenshot"
  readonly full: boolean
  /** The RESOLVED, confined artifact path the screenshot was written to. */
  readonly outputPath: string
  readonly plan: FullScreenshotPlan | null
  readonly value: unknown
}

/**
 * The screenshot handler. The `--output-path` is FIRST resolved through
 * `confinePath(artifactsRoot, ...)` — a `../`/absolute escape FAILS before any
 * device work or write (AC-013, surfaced as a `PathEscape`). A `--full` capture
 * additionally carries the AC-054 stitch plan; the device captures are driven
 * through the injected capability.
 */
export const screenshotCommand = (
  artifactsRoot: string,
  args: ScreenshotArgs = {}
): Command<"device", ScreenshotResult> => {
  const full = args.full === true
  const plan = full ? planFullScreenshot(args) : null
  const device = args.device ?? DEFAULT_DEVICE
  const requestedPath = args.outputPath ?? "screenshot.png"
  return command(
    descriptor("screenshot", "device"),
    Effect.gen(function* () {
      // AC-013: confine BEFORE any device work / write. Escape → PathEscape fail.
      const outputPath = yield* confinePath(artifactsRoot, requestedPath)
      const value = yield* DeviceCapability.pipe(
        Effect.flatMap((cap) =>
          cap.invoke("xcrun", ["simctl", "io", device, "screenshot", outputPath])
        )
      )
      const result: ScreenshotResult = {
        action: "screenshot",
        full,
        outputPath,
        plan,
        value
      }
      return result
    })
  )
}

export type { ScrollArgs, ScreenBox }
