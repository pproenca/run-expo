/**
 * `all-commands.ts` — the FULL command surface, registered into the shell (S12
 * final integration).
 *
 * Each handler / integration package exports command BUILDERS that return a core
 * `Command<S, A>` carrying a REQUIRED, typed `sideEffect`. This module wraps every
 * verb in a `CommandRegistration` (the CLI verb path + summary + a `build` that
 * produces the typed core command for a parsed context) and funnels them all
 * through `registerCommands`. The dispatcher (core) then classifies → gates →
 * injects-the-matching-capability-iff-allowed → runs → redacts at the boundary,
 * so gating / redaction / exit-codes apply UNIFORMLY to the whole surface.
 *
 * Capability withholding is preserved: each `*Command(verb)` is fully typed at
 * its call site (a `read` verb's handler is `R = never`; a `device`/`runtime-eval`/
 * `source-write` verb's handler names exactly its one capability). The per-class
 * registrations are erased into the heterogeneous registry array ONLY at the
 * boundary, via `eraseRegistration` (see its doc for why that single cast is sound
 * — `runRegistered` → `dispatch` provides every capability in `CapabilityEnv`).
 *
 * Pragmatic argv mapping: the shell maps the positional argv to each handler's
 * args struct pragmatically (it does not re-implement every per-flag parser). The
 * SIDE-EFFECT CLASS + the DISPATCH PATH are the load-bearing parts and are real.
 */
import { command } from "@expo98/core"
import { installWriteCommand, removeWriteCommand, buildSitemap, classifyCompat } from "@expo98/expo-integration"
import {
  type DiffKind,
  dashboardCommand,
  type DashboardVerb,
  diffCommand,
  liveBacklogGenerateCommand,
  liveBacklogMatrixCommand,
  reviewCommand,
  type ReviewVerb,
  reviewNextCommand,
  uxContextCommand,
} from "@expo98/handlers-artifacts"
import {
  inspectorCommand,
  inspectorSideEffect,
  type InspectorVerb,
  logsCommand,
  navigationCommand,
  navigationSideEffect,
  type NavigationVerb,
  traceCommand,
  type TraceVerb,
} from "@expo98/handlers-devtools"
import {
  clipboardCommand,
  type ClipboardVerb,
  gestureCommand,
  type GestureKind,
  keyboardCommand,
  type KeyboardVerb,
  lifecycle,
  type LifecycleVerb,
  refActionCommand,
  type RefActionVerb,
  screenshotCommand,
  tapCommand,
  waitCommand,
} from "@expo98/handlers-interaction"
import { buildWaterfall, duplicateGroups, normalizeRequests, reportFindings } from "@expo98/handlers-net-perf"
import {
  accessibilityCommand,
  type AccessibilityVerb,
  rnCommand,
  type RnVerb,
  snapshotCommand,
} from "@expo98/handlers-snapshot"
import { Effect } from "effect"
import { type CommandContext, type CommandRegistration, eraseRegistration, registration } from "./registry.js"

/** A numeric positional, or `undefined` when absent / non-numeric. */
const num = (s: string | undefined): number | undefined => {
  if (s === undefined) {
    return undefined
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

const projectRoot = (ctx: CommandContext): string => ctx.root ?? process.cwd()
const artifactsRoot = (ctx: CommandContext): string => ctx.artifactsRoot ?? projectRoot(ctx)

// ───────────────────────────────────────────────────────────────────────────
// handlers-devtools — trace / inspector / navigation / console / errors
// ───────────────────────────────────────────────────────────────────────────

const TRACE_VERBS: ReadonlyArray<TraceVerb> = ["start", "read", "clear", "stop"]
const traceRegs = TRACE_VERBS.map((verb) =>
  eraseRegistration(
    registration({
      path: `trace ${verb}`,
      summary: `Runtime tracer: ${verb} (runtime-eval, gated).`,
      sideEffect: "runtime-eval",
      build: () => traceCommand(verb, {}),
    }),
  ),
)

const INSPECTOR_VERBS: ReadonlyArray<InspectorVerb> = [
  "probe",
  "read-comments",
  "install-comment-menu",
  "clear-comments",
  "toggle",
  "open-dev-menu",
]
// inspectorCommand returns a per-verb union; each verb's class is fixed, so we
// build it inside a class-pinned registration and erase at the boundary.
const inspectorRegs = INSPECTOR_VERBS.map((verb) =>
  eraseRegistration({
    path: `inspector ${verb}`,
    summary: `In-app inspector: ${verb}.`,
    sideEffect: inspectorSideEffect(verb),
    build: () => inspectorCommand(verb),
  } as CommandRegistration),
)

const NAVIGATION_VERBS: ReadonlyArray<NavigationVerb> = ["state", "back", "pop-to-root", "tab", "deep-link"]
const navigationRegs = NAVIGATION_VERBS.map((verb) =>
  eraseRegistration({
    path: `navigation ${verb}`,
    summary: `Navigation: ${verb} (mutations gated as device).`,
    sideEffect: navigationSideEffect(verb),
    build: (ctx: CommandContext) => navigationCommand(verb, { target: ctx.positionals[0] }),
  } as CommandRegistration),
)

const logsRegs = (["console", "errors"] as const).map((stream) =>
  eraseRegistration(
    registration({
      path: stream,
      summary: `Read the last N ${stream} entries (read).`,
      sideEffect: "read",
      build: (ctx: CommandContext) => logsCommand(stream, { limit: num(ctx.positionals[0]) }),
    }),
  ),
)

// ───────────────────────────────────────────────────────────────────────────
// handlers-interaction — lifecycle / interaction / wait
// ───────────────────────────────────────────────────────────────────────────

const LIFECYCLE_VERBS: ReadonlyArray<LifecycleVerb> = [
  "boot-simulator",
  "open-url",
  "launch-app",
  "terminate-app",
  "reload-app",
  "install-app",
  "uninstall-app",
  "open-route",
  "set",
]
const lifecycleRegs = LIFECYCLE_VERBS.map((verb) =>
  eraseRegistration({
    path: verb,
    summary: `App/simulator lifecycle: ${verb} (device, gated).`,
    sideEffect: "device",
    build: (ctx: CommandContext) =>
      lifecycle(verb, {
        device: ctx.positionals[0],
        bundleId: ctx.positionals[1],
        url: ctx.positionals[1],
        appPath: ctx.positionals[1],
      }),
  } as CommandRegistration),
)

const GESTURE_KINDS: ReadonlyArray<GestureKind> = ["tap", "long-press", "drag", "swipe"]
const gestureRegs = GESTURE_KINDS.map((kind) =>
  eraseRegistration(
    registration({
      path: `gesture ${kind}`,
      summary: `Gesture: ${kind} (device, gated).`,
      sideEffect: "device",
      build: () => gestureCommand(kind, {}),
    }),
  ),
)

const REF_ACTION_VERBS: ReadonlyArray<RefActionVerb> = [
  "long-press",
  "dbltap",
  "fill",
  "focus",
  "blur",
  "select",
  "check",
  "uncheck",
  "drag",
  "scroll",
  "scroll-into-view",
]
const refActionRegs = REF_ACTION_VERBS.map((verb) =>
  eraseRegistration(
    registration({
      path: `ref ${verb}`,
      summary: `Ref action over an @eN ref: ${verb} (device, gated).`,
      sideEffect: "device",
      build: (ctx: CommandContext) =>
        refActionCommand(verb, ctx.positionals[0] ?? "@e1", { value: ctx.positionals[1] }),
    }),
  ),
)

const KEYBOARD_VERBS: ReadonlyArray<KeyboardVerb> = ["type", "press", "keyboard"]
const keyboardRegs = KEYBOARD_VERBS.map((verb) =>
  eraseRegistration(
    registration({
      path: verb,
      summary: `Keyboard: ${verb} (device, gated).`,
      sideEffect: "device",
      build: (ctx: CommandContext) => keyboardCommand(verb, { text: ctx.positionals[0], key: ctx.positionals[0] }),
    }),
  ),
)

const CLIPBOARD_VERBS: ReadonlyArray<ClipboardVerb> = ["read", "write", "paste"]
const clipboardRegs = CLIPBOARD_VERBS.map((verb) =>
  eraseRegistration(
    registration({
      path: `clipboard ${verb}`,
      summary: `Clipboard: ${verb} (device, gated).`,
      sideEffect: "device",
      build: (ctx: CommandContext) => clipboardCommand(verb, { text: ctx.positionals[0] }),
    }),
  ),
)

const tapReg = eraseRegistration(
  registration({
    path: "tap",
    summary: "Tap at (x, y) (device, gated).",
    sideEffect: "device",
    build: (ctx: CommandContext) => tapCommand({ x: num(ctx.positionals[0]), y: num(ctx.positionals[1]) }),
  }),
)

const screenshotReg = eraseRegistration(
  registration({
    path: "screenshot",
    summary: "Capture a screenshot to a confined artifact path (device, gated).",
    sideEffect: "device",
    build: (ctx: CommandContext) =>
      screenshotCommand(artifactsRoot(ctx), { outputPath: ctx.positionals[0], full: false }),
  }),
)

// `wait`: read by default; `wait fn <expr>` is runtime-eval and gated.
const waitReg = eraseRegistration({
  path: "wait",
  summary: "Wait for a duration / predicate (--fn is runtime-eval, gated).",
  sideEffect: "read",
  build: (ctx: CommandContext) => {
    const ms = num(ctx.positionals[0])
    return waitCommand(ms !== undefined ? { ms } : {}, {})
  },
} as CommandRegistration)

const waitFnReg = eraseRegistration({
  path: "wait fn",
  summary: "Wait for a runtime predicate (runtime-eval, gated).",
  sideEffect: "runtime-eval",
  build: (ctx: CommandContext) => waitCommand({ fn: ctx.positionals[0] ?? "true" }, { hasRuntimeAdapter: true }),
} as CommandRegistration)

// ───────────────────────────────────────────────────────────────────────────
// handlers-snapshot — snapshot / accessibility / rn (all read)
// ───────────────────────────────────────────────────────────────────────────

const snapshotReg = eraseRegistration(
  registration({
    path: "snapshot",
    summary: "Capture a UI snapshot (read; capture seam orchestrated by the shell).",
    sideEffect: "read",
    // The capture orchestration (which needs the SemanticCapture / NativeAxe /
    // PersistenceService seams) runs ahead of this read wrapper. Wired here as an
    // unavailable result — the live capture path is the documented seam.
    build: () =>
      snapshotCommand({
        available: false,
        action: "snapshot",
        reason: "Live capture seam not wired in this invocation.",
        code: "no-axe",
      }),
  }),
)

const ACCESSIBILITY_VERBS: ReadonlyArray<AccessibilityVerb> = ["tree", "audit"]
const accessibilityRegs = ACCESSIBILITY_VERBS.map((verb) =>
  eraseRegistration(
    registration({
      path: `accessibility ${verb}`,
      summary: `Accessibility ${verb} over the persisted ref cache (read).`,
      sideEffect: "read",
      // The ref cache is read from refs.json by the shell ahead of time; here we
      // pass null (no cache) → an unavailable read.
      build: () => accessibilityCommand(verb, null),
    }),
  ),
)

const RN_VERBS: ReadonlyArray<RnVerb> = ["tree", "refs", "renders", "inspect"]
const rnRegs = RN_VERBS.map((verb) =>
  eraseRegistration(
    registration({
      path: `rn ${verb}`,
      summary: `React Native introspection: ${verb} (read).`,
      sideEffect: "read",
      build: (ctx: CommandContext) => rnCommand(verb, { graph: null, elementId: ctx.positionals[0] }),
    }),
  ),
)

// ───────────────────────────────────────────────────────────────────────────
// handlers-net-perf — network / perf (read wrappers over the PURE derivations)
// ───────────────────────────────────────────────────────────────────────────

const networkReg = eraseRegistration(
  registration({
    path: "network",
    summary: "Network evidence: waterfall / duplicates / HAR (read).",
    sideEffect: "read",
    // The harvested payload arrives over the protocols read-eval seam; with none
    // wired here the derivations run over an empty request set (read-only).
    build: () =>
      command(
        { action: "network", sideEffect: "read" } as const,
        Effect.sync(() => {
          const requests = normalizeRequests([])
          return {
            available: true,
            action: "network",
            requestCount: requests.length,
            waterfall: buildWaterfall(requests),
            duplicates: duplicateGroups(requests),
          }
        }),
      ),
  }),
)

const perfReg = eraseRegistration(
  registration({
    path: "perf",
    summary: "Performance findings from harvested metrics (read).",
    sideEffect: "read",
    build: () =>
      command(
        { action: "perf", sideEffect: "read" } as const,
        Effect.sync(() => ({
          available: true,
          action: "perf",
          findings: reportFindings({}),
        })),
      ),
  }),
)

// ───────────────────────────────────────────────────────────────────────────
// handlers-artifacts — diff / ux-context / review-next / review / dashboard /
// live-backlog (all read)
// ───────────────────────────────────────────────────────────────────────────

const DIFF_KINDS: ReadonlyArray<DiffKind> = ["snapshot", "screenshot"]
const diffRegs = DIFF_KINDS.map((kind) =>
  eraseRegistration(
    registration({
      path: `diff ${kind}`,
      summary: `Diff a captured ${kind} against a --baseline (read).`,
      sideEffect: "read",
      build: (ctx: CommandContext) =>
        diffCommand(kind, { baseline: ctx.positionals[0], candidate: ctx.positionals[1] }),
    }),
  ),
)

const uxContextReg = eraseRegistration(
  registration({
    path: "ux-context",
    summary: "Bundle UX-context evidence facets (read).",
    sideEffect: "read",
    build: () => uxContextCommand({}),
  }),
)

const reviewNextReg = eraseRegistration(
  registration({
    path: "review-next",
    summary: "Next-step review guidance (read).",
    sideEffect: "read",
    build: (ctx: CommandContext) => reviewNextCommand({ surface: ctx.positionals[0] }),
  }),
)

const REVIEW_VERBS: ReadonlyArray<ReviewVerb> = ["report", "matrix"]
const reviewRegs = REVIEW_VERBS.map((verb) =>
  eraseRegistration(
    registration({
      path: `review ${verb}`,
      summary: `Render a review ${verb} (read).`,
      sideEffect: "read",
      build: () => reviewCommand(verb, {}),
    }),
  ),
)

const DASHBOARD_VERBS: ReadonlyArray<DashboardVerb> = ["start", "stop", "report"]
const dashboardRegs = DASHBOARD_VERBS.map((verb) =>
  eraseRegistration(
    registration({
      path: `dashboard ${verb}`,
      summary: `Session observability: ${verb} (read; no network listener).`,
      sideEffect: "read",
      build: () => dashboardCommand(verb, {}),
    }),
  ),
)

const liveBacklogRegs = [
  eraseRegistration(
    registration({
      path: "live-backlog generate",
      summary: "Emit the source-derived command-matrix template (read).",
      sideEffect: "read",
      build: () => liveBacklogGenerateCommand(),
    }),
  ),
  eraseRegistration(
    registration({
      path: "live-backlog matrix",
      summary: "Substitute project inputs into the matrix (read).",
      sideEffect: "read",
      build: (ctx: CommandContext) =>
        liveBacklogMatrixCommand({
          bundleId: ctx.positionals[0],
          device: ctx.positionals[1],
          devClientUrl: ctx.positionals[2],
        }),
    }),
  ),
]

// ───────────────────────────────────────────────────────────────────────────
// expo-integration — bridge install/remove (source-write) + expo-compat /
// sitemap (read)
// ───────────────────────────────────────────────────────────────────────────

const bridgeInstallReg = eraseRegistration(
  registration({
    path: "bridge install",
    summary: "Install the in-app bridge files (source-write; needs confirmation).",
    sideEffect: "source-write",
    build: (ctx: CommandContext) => installWriteCommand(projectRoot(ctx)),
  }),
)

const bridgeRemoveReg = eraseRegistration(
  registration({
    path: "bridge remove",
    summary: "Remove the in-app bridge files (source-write; needs confirmation).",
    sideEffect: "source-write",
    build: (ctx: CommandContext) => removeWriteCommand(projectRoot(ctx)),
  }),
)

const expoCompatReg = eraseRegistration(
  registration({
    path: "expo-compat",
    summary: "Classify the declared Expo/RN version pair (read).",
    sideEffect: "read",
    build: (ctx: CommandContext) =>
      command(
        { action: "expo-compat", sideEffect: "read" } as const,
        Effect.sync(() => ({
          available: true,
          action: "expo-compat",
          result: classifyCompat({ expo: ctx.positionals[0], reactNative: ctx.positionals[1] }),
        })),
      ),
  }),
)

const sitemapReg = eraseRegistration(
  registration({
    path: "sitemap",
    summary: "Build an Expo Router sitemap from route sources (read).",
    sideEffect: "read",
    build: (ctx: CommandContext) =>
      command(
        { action: "sitemap", sideEffect: "read" } as const,
        Effect.sync(() => ({
          available: true,
          action: "sitemap",
          entries: buildSitemap(ctx.positionals.length > 0 ? ctx.positionals : [projectRoot(ctx)]),
        })),
      ),
  }),
)

// ───────────────────────────────────────────────────────────────────────────
// overlay-server — review-overlay (read; the live `server` bind is the seam)
// ───────────────────────────────────────────────────────────────────────────

const REVIEW_OVERLAY_ACTIONS = ["prepare", "read", "clear"] as const
const reviewOverlayReg = eraseRegistration(
  registration({
    path: "review-overlay",
    summary: "Review-overlay ingest: prepare/read/clear (read; server bind is a seam).",
    sideEffect: "read",
    build: (ctx: CommandContext) =>
      command(
        { action: "review-overlay", sideEffect: "read" } as const,
        Effect.sync(() => {
          const requested = ctx.positionals[0] ?? "prepare"
          const action = (REVIEW_OVERLAY_ACTIONS as ReadonlyArray<string>).includes(requested) ? requested : "prepare"
          // The hardened ingest server (token + Origin + body-cap + comments[]
          // schema) + the live bind live in @expo98/overlay-server; the `server`
          // action is the documented live seam (not wired into the read path).
          return {
            available: true,
            action: "review-overlay",
            overlayAction: action,
            networkListener: false,
          }
        }),
      ),
  }),
)

/**
 * Every handler / integration command registered into the shell, alongside the
 * core READ proof-commands. The composition root (`main.ts`) registers
 * `[...coreReadCommands, ...handlerCommands]`.
 */
export const handlerCommands: ReadonlyArray<CommandRegistration> = [
  // handlers-devtools
  ...traceRegs,
  ...inspectorRegs,
  ...navigationRegs,
  ...logsRegs,
  // handlers-interaction
  ...lifecycleRegs,
  ...gestureRegs,
  ...refActionRegs,
  ...keyboardRegs,
  ...clipboardRegs,
  tapReg,
  screenshotReg,
  waitReg,
  waitFnReg,
  // handlers-snapshot
  snapshotReg,
  ...accessibilityRegs,
  ...rnRegs,
  // handlers-net-perf
  networkReg,
  perfReg,
  // handlers-artifacts
  ...diffRegs,
  uxContextReg,
  reviewNextReg,
  ...reviewRegs,
  ...dashboardRegs,
  ...liveBacklogRegs,
  // expo-integration
  bridgeInstallReg,
  bridgeRemoveReg,
  expoCompatReg,
  sitemapReg,
  // overlay-server
  reviewOverlayReg,
]
