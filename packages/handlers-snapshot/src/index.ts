/**
 * `@expo98/handlers-snapshot` — D8 snapshot/accessibility/RN-introspection handlers.
 *
 * All commands are `read`. Capture reaches evidence over READ surfaces only:
 *   - the semantic-bridge probe (`SemanticCapture`, a FIXED CDP `HermesEvidence`
 *     expression — package-controlled, never caller JS), and
 *   - the native `axe describe-ui` CLI fallback (`NativeAxe`, a subprocess).
 * Neither is the dispatcher-withheld runtime-eval mutation surface, so every
 * handler keeps `R = never` w.r.t. core's dangerous capability tags. The capture
 * I/O arrives via these two documented SEAM tags (so the live transport is
 * injected, never imported), exactly mirroring the D10 capability-seam rule.
 *
 * Persistence is domain-owned (AC-026): `captureSnapshot` builds the
 * `SnapshotResult` and calls domain's `snapshotPersist`, which writes
 * `snapshots/<id>.json` + `refs.json`, moves `lastSnapshotId`/`updatedAt`, and
 * asserts the THREE Session pointer invariants. We re-spec NONE of that here.
 *
 * AC map: AC-019 (capture prereqs + semantic→native fallback), AC-026 (persist +
 * the 3 pointer invariants), AC-023 (accessibility audit `interactive-name`),
 * AC-040 (snapshot filter depth clamp 1..100), AC-055 (RN introspection caps).
 */

// shared bounds + capture SEAMS (AC-019 timeouts/buffers, AC-040, AC-055)
export {
  ANCESTOR_PATH_DEPTH_CAP,
  ANCESTOR_SLICE_HEAD,
  ANCESTOR_SLICE_TAIL,
  clamp,
  CONTROL_LIST_CAP,
  DEFAULT_RN_DEPTH,
  DEFAULT_RN_NODES,
  descriptor,
  ELEMENT_ACTIONS_CAP,
  MAX_DEPTH,
  MAX_RN_DEPTH,
  MAX_RN_NODES,
  MIN_DEPTH,
  NATIVE_AXE_MAX_BUFFER,
  NATIVE_AXE_TIMEOUT_MS,
  NativeAxe,
  type NativeAxeElement,
  type NativeAxeResult,
  type NativeAxeService,
  RECORD_LIST_CAP,
  resolveDepth,
  resolveRnMaxDepth,
  resolveRnMaxNodes,
  round,
  SEMANTIC_EVAL_TIMEOUT_MS,
  SemanticCapture,
  type SemanticCapturePayload,
  type SemanticCaptureService,
  type SemanticRef
} from "./support.js"

// snapshot capture (AC-019/026) + depth filter (AC-040)
export {
  captureSnapshot,
  type DepthedNode,
  filterByDepth,
  type SnapshotCaptured,
  type SnapshotCaptureInput,
  type SnapshotCaptureResult,
  snapshotCommand,
  type SnapshotUnavailable
} from "./snapshot.js"

// accessibility tree / audit (AC-023)
export {
  type AccessibilityAuditResult,
  accessibilityCommand,
  type AccessibilityFinding,
  accessibilityResult,
  type AccessibilityResult,
  type AccessibilityTreeResult,
  type AccessibilityTreeRow,
  type AccessibilityUnavailable,
  type AccessibilityVerb,
  INTERACTIVE_NAME_MESSAGE,
  isInteractiveUnnamed
} from "./accessibility.js"

// rn introspection tree / refs / renders / inspect (AC-055)
export {
  applyTraversalCaps,
  capActions,
  capAncestors,
  type RnArgs,
  rnCommand,
  type RnInput,
  type RnInspectResult,
  type RnInspectResultEnvelope,
  type RnNode,
  type RnRefRow,
  type RnRefsResult,
  type RnRenderRow,
  type RnRendersResult,
  rnResult,
  type RnResult,
  type RnTreeResult,
  type RnTreeRow,
  type RnUnavailable,
  type RnVerb
} from "./rn.js"
