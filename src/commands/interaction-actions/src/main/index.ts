export type {
  ActionPolicyDecision,
  ExecCall,
  ExecError,
  ExecOptions,
  ExecResult,
  GesturePlan,
  InteractionArgs,
  InteractionDependencies,
  InteractionPayload,
  IosDevice,
  Platform,
  RefActionAdapterDependencies,
  RefActionModule,
  RefBox,
  RefCache,
  RefRecord,
  ToolTextResult,
} from "./types.js";
export { MAX_OUTPUT } from "./types.js";
export { defaultInteractionDependencies } from "./dependencies.js";
export { automationTap, refActionCommand } from "./tap-ref-actions.js";
export { clipboardCommand, keyboardCommand, keyCodeFor } from "./keyboard-clipboard.js";
export { setEnvironmentCommand, setEnvironmentPlan } from "./environment.js";
export {
  automationGesture,
  axeGestureCommandFromPlan,
  captureGestureScreenshot,
  defaultGestureDurationMs,
  executeGesturePlan,
  executeRepeatedCommand,
  gestureCommandPlan,
  normalizeGesture,
  normalizeGestureCoordinates,
} from "./gestures.js";
export {
  clampNumber,
  createRefActionAdapter,
  requireString,
  toolJson,
  truncate,
} from "./shared.js";
