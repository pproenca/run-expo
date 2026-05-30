/**
 * `install` — bridge install / remove (AC-008, `source-write`).
 *
 * Install/remove are `source-write`-classed COMMANDS dispatched THROUGH core's
 * gate. Core's `source-write` gate requires BOTH a policy allow AND an exact
 * confirmation token (`--confirm-actions`, comma-split/trimmed/exact). The action
 * names ARE the tokens: `bridge-install` / `bridge-remove`.
 *
 * Structural guarantee: the write/delete is performed ONLY by the
 * `SourceWriteCapability` the dispatcher injects into the handler's `R` on the
 * gate-pass branch. With no token the gate denies → the handler is never built →
 * the capability is invoked ZERO times (AC-008: "create/delete no files"). On
 * denial we surface a richer `{ requiredConfirmation, status, plan }` payload
 * instead of the bare policy-denial, computed from a `read` of the current
 * install state.
 *
 * `// SEAM (Expo SDK)`: real in-app delivery of the written bridge to the running
 * dev client is the official Expo DevTools Plugins SDK (brief Q#10). This module
 * only writes/deletes the PROJECT-SIDE files over `SourceWriteCapability`.
 */
import {
  command,
  type Command,
  confinePath,
  DeviceCapability,
  dispatch,
  type DispatchResult,
  type PolicyDocument,
  RuntimeEvalCapability,
  SourceWriteCapability,
} from "@expo98/core"
import { Fs } from "@expo98/domain"
import { Effect } from "effect"
import { bridgeFilePaths, bridgeMetadataContents, bridgeSourceContents } from "./bridge-files.js"
import { type InstallStateResult, readInstallState } from "./install-state.js"

/** The confirmation tokens (also the action names) for AC-008. */
export const BRIDGE_INSTALL_TOKEN = "bridge-install" as const
export const BRIDGE_REMOVE_TOKEN = "bridge-remove" as const

export type BridgeWriteAction = typeof BRIDGE_INSTALL_TOKEN | typeof BRIDGE_REMOVE_TOKEN

/** The plan describing files that WOULD be written/deleted. */
export interface BridgePlan {
  readonly action: BridgeWriteAction
  readonly writes: ReadonlyArray<string>
  readonly deletes: ReadonlyArray<string>
}

/** Payload returned when a write/remove COMPLETED (token present, gate passed). */
export interface BridgeWriteResult {
  readonly action: BridgeWriteAction
  readonly applied: true
  readonly written: ReadonlyArray<string>
  readonly deleted: ReadonlyArray<string>
}

/** Payload returned when confirmation is MISSING (no files touched). */
export interface BridgeConfirmationRequired {
  readonly action: BridgeWriteAction
  readonly applied: false
  readonly requiredConfirmation: BridgeWriteAction
  readonly status: InstallStateResult
  readonly plan: BridgePlan
}

export type BridgeWritePayload = BridgeWriteResult | BridgeConfirmationRequired

/** Build the install plan for a project root. */
export const installPlan = (root: string): BridgePlan => {
  const paths = bridgeFilePaths(root)
  return {
    action: BRIDGE_INSTALL_TOKEN,
    writes: [paths.metadata, paths.source],
    deletes: [],
  }
}

/** Build the remove plan for a project root (includes the legacy fallback). */
export const removePlan = (root: string): BridgePlan => {
  const paths = bridgeFilePaths(root)
  return {
    action: BRIDGE_REMOVE_TOKEN,
    writes: [],
    deletes: [paths.metadata, paths.source, paths.legacyMetadata],
  }
}

const confinedBridgeFilePaths = (root: string) =>
  Effect.all({
    metadata: confinePath(root, ".expo98/bridge.json"),
    source: confinePath(root, "src/expo98-devtools-bridge.ts"),
    legacyMetadata: confinePath(root, ".expo-ios/bridge.json"),
  })

/** The `source-write` install command — writes both files via the capability. */
export const installWriteCommand = (root: string): Command<"source-write", BridgeWriteResult> => {
  return command(
    { action: BRIDGE_INSTALL_TOKEN, sideEffect: "source-write" },
    Effect.gen(function* () {
      const paths = yield* confinedBridgeFilePaths(root)
      const cap = yield* SourceWriteCapability
      yield* cap
        .writeFile(paths.metadata, bridgeMetadataContents())
        .pipe(Effect.zipRight(cap.writeFile(paths.source, bridgeSourceContents())))
      return {
        action: BRIDGE_INSTALL_TOKEN,
        applied: true,
        written: [paths.metadata, paths.source],
        deleted: [],
      } satisfies BridgeWriteResult
    }),
  )
}

/** The `source-write` remove command — deletes both files (+ legacy fallback). */
export const removeWriteCommand = (root: string): Command<"source-write", BridgeWriteResult> => {
  return command(
    { action: BRIDGE_REMOVE_TOKEN, sideEffect: "source-write" },
    Effect.gen(function* () {
      const paths = yield* confinedBridgeFilePaths(root)
      const cap = yield* SourceWriteCapability
      yield* cap
        .deleteFile(paths.metadata)
        .pipe(Effect.zipRight(cap.deleteFile(paths.source)), Effect.zipRight(cap.deleteFile(paths.legacyMetadata)))
      return {
        action: BRIDGE_REMOVE_TOKEN,
        applied: true,
        written: [],
        deleted: [paths.metadata, paths.source, paths.legacyMetadata],
      } satisfies BridgeWriteResult
    }),
  )
}

/**
 * Run a bridge write action through core's dispatch. On a confirmation-missing
 * denial, return the richer `{ requiredConfirmation, status, plan }` payload
 * (computed via a `read` of the install state) instead of the generic denial.
 *
 * The `SourceWriteCapability` must be supplied via `R` (the dispatcher injects it
 * into the handler only on gate-pass); a denied call never reaches it.
 */
/**
 * No-op Device / RuntimeEval services. A `source-write` command never reaches
 * them (its handler `R` is exactly `SourceWriteCapability`), but core's `dispatch`
 * types its environment as the full `CapabilityEnv`; providing inert services for
 * the two unused tags narrows the PUBLIC requirement to `SourceWriteCapability`
 * (+ `Fs`) without ever invoking device/eval — they are structurally unreachable.
 */
const inertDevice = DeviceCapability.of({
  invoke: () => Effect.succeed(""),
})
const inertEval = RuntimeEvalCapability.of({
  evaluate: () => Effect.succeed(undefined),
})

const runBridgeWrite = (
  root: string,
  action: BridgeWriteAction,
  policy: PolicyDocument,
): Effect.Effect<DispatchResult<BridgeWritePayload>, never, SourceWriteCapability | Fs> =>
  Effect.gen(function* () {
    const cmd = action === BRIDGE_INSTALL_TOKEN ? installWriteCommand(root) : removeWriteCommand(root)

    const dispatched = yield* dispatch(cmd, policy).pipe(
      Effect.provideService(DeviceCapability, inertDevice),
      Effect.provideService(RuntimeEvalCapability, inertEval),
    )

    // Gate passed → the write/delete happened; pass the applied payload through.
    if (
      typeof dispatched.payload === "object" &&
      dispatched.payload !== null &&
      "applied" in dispatched.payload &&
      (dispatched.payload as { applied: unknown }).applied === true
    ) {
      return dispatched as DispatchResult<BridgeWritePayload>
    }

    if (
      typeof dispatched.payload !== "object" ||
      dispatched.payload === null ||
      !("reason" in dispatched.payload) ||
      typeof (dispatched.payload as { reason: unknown }).reason !== "string" ||
      !(dispatched.payload as { reason: string }).reason.includes("requires confirmation token")
    ) {
      return dispatched as DispatchResult<BridgeWritePayload>
    }

    // Denied for missing confirmation → richer confirmation-required payload.
    const status = yield* readInstallState(root)
    const plan = action === BRIDGE_INSTALL_TOKEN ? installPlan(root) : removePlan(root)
    const confirmationPayload: BridgeConfirmationRequired = {
      action,
      applied: false,
      requiredConfirmation: action,
      status,
      plan,
    }
    return {
      exitCode: dispatched.exitCode,
      sideEffect: dispatched.sideEffect,
      payload: confirmationPayload,
    }
  })

/** AC-008 — `bridge install`. */
export const bridgeInstall = (
  root: string,
  policy: PolicyDocument,
): Effect.Effect<DispatchResult<BridgeWritePayload>, never, SourceWriteCapability | Fs> =>
  runBridgeWrite(root, BRIDGE_INSTALL_TOKEN, policy)

/** AC-008 — `bridge remove`. */
export const bridgeRemove = (
  root: string,
  policy: PolicyDocument,
): Effect.Effect<DispatchResult<BridgeWritePayload>, never, SourceWriteCapability | Fs> =>
  runBridgeWrite(root, BRIDGE_REMOVE_TOKEN, policy)
