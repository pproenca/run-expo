import {
  toolJson,
  type ToolTextResult,
} from "../../../../core/tool-json-envelope/src/main/index.ts";

export interface ReviewFlags {
  hasAcceptanceContract: boolean;
  hasScreenshot: boolean;
  hasInteractionProof: boolean;
  hasStaticVerifier: boolean;
  changedGesture: boolean;
  changedChrome: boolean;
  changedNavigation: boolean;
  addedVisibleControls: boolean;
}

export interface ReviewConstraint {
  name: string;
  tocStep: "exploit" | "elevate" | "subordinate";
  reason: string;
  nextStep: string;
}

export interface ReviewFlows {
  firstScreenInvariants: string[];
  representativeAction: string;
  evidenceRequired: string[];
  flows: string[];
}

export interface ReviewCommandSuggestionArgs {
  cwd: string;
  metroPort: number;
  componentFilter?: string | null;
  flags: ReviewFlags;
  stage: string;
}

export interface ReviewNextStepArgs extends Record<string, unknown> {
  surface?: string | null;
  stage?: string | null;
  issue?: string | null;
  cwd?: string | null;
  metroPort?: number | string | null;
  componentFilter?: string | null;
  verifierRule?: string | null;
  hasAcceptanceContract?: boolean;
  hasScreenshot?: boolean;
  hasInteractionProof?: boolean;
  hasStaticVerifier?: boolean;
  changedGesture?: boolean;
  changedChrome?: boolean;
  changedNavigation?: boolean;
  addedVisibleControls?: boolean;
}

const SUBORDINATE_RULE =
  "Do not patch or call done until the current constraint is proven or deliberately elevated.";
const NON_GOALS = [
  "Do not change unrelated app contracts, data shape, or navigation model without a separate reason.",
];

export async function reviewNextStep(args: ReviewNextStepArgs = {}): Promise<ToolTextResult> {
  const surface = args.surface ?? "generic";
  const stage = args.stage ?? "intake";
  const issue = requireOptionalString(args.issue) ?? "unspecified UI review issue";
  const cwd = requireOptionalString(args.cwd) ?? ".";
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const componentFilter = requireOptionalString(args.componentFilter);
  const verifierRule = requireOptionalString(args.verifierRule);
  const flags = reviewFlags(args);
  const requiredFlows = reviewFlowsForSurface(surface);
  const suggestedCommands = reviewCommandSuggestions({
    cwd,
    metroPort,
    componentFilter,
    flags,
    stage,
  });
  const questionTriggers = reviewQuestionTriggers(flags, verifierRule);
  const constraint = chooseReviewConstraint({ stage, flags, verifierRule });

  return toolJson({
    issue,
    surface,
    stage,
    constraint,
    nextStep: constraint.nextStep,
    subordinateRule: SUBORDINATE_RULE,
    requiredFlows,
    questionTriggers,
    suggestedCommands,
    stopConditions: reviewStopConditions({ flags, verifierRule }),
    acceptanceContractTemplate: {
      userGoal: "<role + task>",
      firstScreenInvariants: requiredFlows.firstScreenInvariants,
      ambiguousSemantics: questionTriggers,
      representativeAction: requiredFlows.representativeAction,
      evidenceRequired: requiredFlows.evidenceRequired,
      nonGoals: NON_GOALS,
    },
  });
}

export function chooseReviewConstraint(args: {
  stage: string;
  flags: ReviewFlags;
  verifierRule?: string | null;
}): ReviewConstraint {
  const workflowVerifier =
    args.verifierRule && verifierRuleMatchesChangedWorkflow(args.verifierRule, args.flags);
  if (!args.flags.hasAcceptanceContract && args.stage !== "handoff") {
    return {
      name: "decision clarity",
      tocStep: "exploit",
      reason: "The limiting constraint is not code; it is the missing acceptance contract.",
      nextStep:
        "Write the acceptance contract and resolve ambiguous control/gesture/chrome semantics before editing.",
    };
  }
  if (!args.flags.hasScreenshot && (args.stage === "intake" || args.stage === "pre-patch")) {
    return {
      name: "baseline evidence",
      tocStep: "exploit",
      reason: "The screen cannot be reviewed reliably without visible runtime evidence.",
      nextStep:
        "Capture ux-context or a screenshot, then inspect the image against the first-screen invariants.",
    };
  }
  if (workflowVerifier) {
    return {
      name: "workflow blocker",
      tocStep: "elevate",
      reason: `Verifier rule ${args.verifierRule} maps to the changed workflow.`,
      nextStep:
        "Treat the verifier finding as blocking, fix the underlying workflow, or record an explicit product exception.",
    };
  }
  if (
    (args.flags.changedGesture || args.stage === "interaction") &&
    !args.flags.hasInteractionProof
  ) {
    return {
      name: "interaction proof",
      tocStep: "elevate",
      reason:
        "The touched workflow depends on direct manipulation, so screenshots and static checks are insufficient.",
      nextStep:
        "Run the representative action in the simulator or an equivalent interaction test, then compare preview and committed state.",
    };
  }
  if (
    (args.flags.changedChrome || args.flags.changedNavigation) &&
    !args.flags.hasInteractionProof
  ) {
    return {
      name: "chrome/navigation proof",
      tocStep: "subordinate",
      reason:
        "Chrome and navigation changes can silently break safe area, tab, sheet, or return behavior.",
      nextStep:
        "Exercise tab/header/sheet/back behavior on the target route and inspect safe-area clearance.",
    };
  }
  if (args.flags.addedVisibleControls && !args.flags.hasInteractionProof) {
    return {
      name: "affordance validation",
      tocStep: "exploit",
      reason:
        "New always-visible controls may reduce discoverability debt while damaging the direct object model.",
      nextStep:
        "Prove object-level feedback is insufficient, then verify the added controls do not clutter or compete with the primary surface.",
    };
  }
  if (!args.flags.hasStaticVerifier && args.stage !== "intake") {
    return {
      name: "static pattern gate",
      tocStep: "subordinate",
      reason: "The local native-feel rule gate has not been run for the changed iOS surface.",
      nextStep:
        "Run verify-native-experience and classify findings by whether they map to the touched workflow.",
    };
  }
  return {
    name: "handoff proof",
    tocStep: "subordinate",
    reason: "The main constraints appear covered; the remaining work is to make proof inspectable.",
    nextStep:
      "Finish with an acceptance matrix: invariant, evidence, pass/fail, and remaining risk.",
  };
}

export function reviewFlowsForSurface(surface: string): ReviewFlows {
  if (surface === "calendar" || surface === "timeline") {
    return {
      firstScreenInvariants: [
        "current day remains visibly distinct",
        "current time is visible or the screen explains why not",
        "date context is still visible after positioning near now",
        "bottom tab/home-indicator chrome does not crop or cover working time",
      ],
      representativeAction:
        "Open today, tap an empty slot, drag a time range, confirm the draft range, scroll without creating, and drag without scrolling.",
      evidenceRequired: [
        "before and after ux-context or screenshot",
        "interaction proof for tap-to-create and drag-to-create",
        "safe-area/tab clearance proof",
        "verify-native-experience classification for gesture, tab, safe-area, and visible-text rules",
      ],
      flows: [
        "fresh-open temporal context",
        "day switch away and back to today",
        "tap-to-create draft",
        "short and long drag-to-create",
        "scroll-vs-drag conflict",
        "bottom chrome and safe-area clearance",
        "today selected, today not selected, past, future, occupied, and free states",
      ],
    };
  }
  if (surface === "navigation") {
    return {
      firstScreenInvariants: [
        "selected tab/title is clear",
        "back or dismiss behavior is predictable",
        "content clears system chrome",
      ],
      representativeAction: "Enter the route, navigate forward, back out, switch tabs, and return.",
      evidenceRequired: [
        "ux-context or screenshot",
        "manual/smoke navigation walkthrough",
        "safe-area proof",
      ],
      flows: ["deep link/cold entry", "tab switch", "back/dismiss", "return to prior state"],
    };
  }
  if (surface === "form") {
    return {
      firstScreenInvariants: [
        "primary fields are visible",
        "keyboard does not hide focused input",
        "submit state is clear",
      ],
      representativeAction:
        "Focus a field, submit invalid data, recover, submit valid data, and confirm the result.",
      evidenceRequired: [
        "focused keyboard state",
        "invalid/recovery state",
        "success or saved state",
      ],
      flows: ["focus/keyboard", "invalid submit", "recovery", "valid submit"],
    };
  }
  if (surface === "list") {
    return {
      firstScreenInvariants: [
        "rows are readable",
        "selected/empty/loading/error state is clear",
        "row actions do not conflict with scroll",
      ],
      representativeAction: "Scroll, select a row, perform row action if present, and return.",
      evidenceRequired: ["ux-context or screenshot", "scroll/row interaction proof"],
      flows: ["loading/empty/error", "scroll", "row select", "row action"],
    };
  }
  if (surface === "editor") {
    return {
      firstScreenInvariants: [
        "editable object is clear",
        "tool state is visible",
        "chrome does not cover the canvas/content",
      ],
      representativeAction:
        "Create or edit the object, preview the change, cancel, then commit and confirm saved state.",
      evidenceRequired: ["before/after screenshot", "interaction proof", "saved-state proof"],
      flows: ["edit", "preview", "cancel", "commit"],
    };
  }
  return {
    firstScreenInvariants: [
      "location/state is clear",
      "primary action is visible or directly discoverable",
      "system chrome does not cover content",
    ],
    representativeAction:
      "Exercise the primary user action from the visible surface and confirm the committed state matches the preview.",
    evidenceRequired: [
      "ux-context or screenshot",
      "representative action proof",
      "static verifier classification",
    ],
    flows: ["fresh open", "primary action", "cancel/recover", "commit", "return"],
  };
}

export function reviewQuestionTriggers(flags: ReviewFlags, verifierRule?: string | null): string[] {
  const questions: string[] = [];
  if (flags.changedChrome || flags.changedNavigation) {
    questions.push(
      "What should this control/chrome mean: navigation, disclosure, filter, picker, or title menu?",
    );
  }
  if (flags.changedGesture) {
    questions.push("Which gesture owns the surface when scroll and direct manipulation overlap?");
  }
  if (flags.addedVisibleControls) {
    questions.push(
      "Can object-level feedback solve discoverability before adding always-visible controls?",
    );
  }
  if (verifierRule) {
    questions.push(
      `Does verifier rule ${verifierRule} map to the changed workflow or an unrelated legacy surface?`,
    );
  }
  return questions;
}

export function reviewCommandSuggestions(args: ReviewCommandSuggestionArgs): string[] {
  const base = [
    `expo98 --json ux-context --cwd ${shellArg(args.cwd)} --metro-port ${args.metroPort}${args.componentFilter ? ` --component-filter ${shellArg(args.componentFilter)}` : ""}`,
  ];
  if (
    args.flags.changedGesture ||
    args.flags.changedChrome ||
    args.flags.changedNavigation ||
    args.flags.addedVisibleControls ||
    args.stage === "interaction"
  ) {
    base.push(
      `expo98 --json inspector probe --metro-port ${args.metroPort}`,
      `expo98 --json inspector toggle --metro-port ${args.metroPort}`,
      `expo98 --json inspector install-comment-menu --metro-port ${args.metroPort}`,
      "expo98 --json inspector open-dev-menu",
      `expo98 --json inspector read-comments --metro-port ${args.metroPort}`,
      `expo98 --json review-overlay scaffold --cwd ${shellArg(args.cwd)}`,
      `expo98 --json review-overlay prepare --cwd ${shellArg(args.cwd)} --serve true`,
      `expo98 --json review-overlay read --cwd ${shellArg(args.cwd)}`,
    );
  }
  if (args.flags.changedGesture || args.stage === "interaction") {
    base.push(
      `expo98 --json trace --action start --metro-port ${args.metroPort}${args.componentFilter ? ` --component-filter ${shellArg(args.componentFilter)}` : ""}`,
      "# reproduce the representative gesture in the simulator, or use expo98 gesture when coordinates are known",
      "expo98 --json gesture drag --start-x <x1> --start-y <y1> --end-x <x2> --end-y <y2> --duration-ms 900 --capture-before-after true",
      "expo98 --json gesture long-press --x <x> --y <y> --duration-ms 900 --capture-before-after true",
      `expo98 --json trace --action read --metro-port ${args.metroPort} --max-events 200`,
      `expo98 --json trace --action stop --metro-port ${args.metroPort}`,
    );
  }
  if (!args.flags.hasStaticVerifier && args.stage !== "intake") {
    base.push("verify-native-experience <expo-app> --strict");
  }
  return base;
}

export function reviewStopConditions(args: {
  flags: ReviewFlags;
  verifierRule?: string | null;
}): string[] {
  const stops: string[] = [];
  if (!args.flags.hasAcceptanceContract)
    stops.push("Stop before patching: acceptance contract is missing.");
  if (args.flags.changedGesture && !args.flags.hasInteractionProof)
    stops.push("Stop before handoff: gesture/direct-manipulation proof is missing.");
  if (args.flags.changedChrome && !args.flags.hasInteractionProof)
    stops.push("Stop before handoff: tab/header/safe-area behavior has not been exercised.");
  if (args.verifierRule && verifierRuleMatchesChangedWorkflow(args.verifierRule, args.flags)) {
    stops.push(
      `Stop before handoff: verifier rule ${args.verifierRule} maps to the changed workflow.`,
    );
  }
  return stops;
}

export function verifierRuleMatchesChangedWorkflow(
  rule: string | null | undefined,
  flags: ReviewFlags,
): boolean {
  const normalized = String(rule ?? "").toLowerCase();
  if (
    flags.changedGesture &&
    /(gesture|panresponder|reanimated|handler|swipe|drag)/.test(normalized)
  )
    return true;
  if (
    (flags.changedChrome || flags.changedNavigation) &&
    /(tab|safe|navigation|header|sheet|modal|back)/.test(normalized)
  )
    return true;
  if (/(text|button|row|visible|wrapper)/.test(normalized)) return true;
  return false;
}

export function reviewFlags(args: ReviewNextStepArgs): ReviewFlags {
  return {
    hasAcceptanceContract: args.hasAcceptanceContract === true,
    hasScreenshot: args.hasScreenshot === true,
    hasInteractionProof: args.hasInteractionProof === true,
    hasStaticVerifier: args.hasStaticVerifier === true,
    changedGesture: args.changedGesture === true,
    changedChrome: args.changedChrome === true,
    changedNavigation: args.changedNavigation === true,
    addedVisibleControls: args.addedVisibleControls === true,
  };
}

export function shellArg(value: string): string {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

export function requireOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error("Expected optional string.");
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return min;
  return Math.max(min, Math.min(max, Math.trunc(numberValue)));
}
