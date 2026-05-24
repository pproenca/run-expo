import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  chooseReviewConstraint,
  reviewCommandSuggestions,
  reviewFlowsForSurface,
  reviewNextStep,
  reviewQuestionTriggers,
  reviewStopConditions,
  toolJson,
  verifierRuleMatchesChangedWorkflow,
} from "../main/index.js";
import type { ToolTextResult } from "../main/index.js";

describe("review-next-guidance legacy characterization", () => {
  it("defaults to generic intake guidance and blocks on a missing acceptance contract", async () => {
    const payload = parseToolJson(await reviewNextStep());

    assert.equal(payload.issue, "unspecified UI review issue");
    assert.equal(payload.surface, "generic");
    assert.equal(payload.stage, "intake");
    assert.deepEqual(payload.constraint, {
      name: "decision clarity",
      tocStep: "exploit",
      reason: "The limiting constraint is not code; it is the missing acceptance contract.",
      nextStep: "Write the acceptance contract and resolve ambiguous control/gesture/chrome semantics before editing.",
    });
    assert.equal(payload.nextStep, payload.constraint.nextStep);
    assert.equal(payload.subordinateRule, "Do not patch or call done until the current constraint is proven or deliberately elevated.");
    assert.deepEqual(payload.suggestedCommands, ["expo-ios --json ux-context --cwd . --metro-port 8081"]);
    assert.deepEqual(payload.stopConditions, ["Stop before patching: acceptance contract is missing."]);
    assert.deepEqual(payload.acceptanceContractTemplate.nonGoals, [
      "Do not change unrelated app contracts, data shape, or navigation model without a separate reason.",
    ]);
  });

  it("requires baseline evidence at intake or pre-patch once the acceptance contract exists", async () => {
    const intake = parseToolJson(await reviewNextStep({ hasAcceptanceContract: true }));
    const prePatch = chooseReviewConstraint({
      stage: "pre-patch",
      flags: flags({ hasAcceptanceContract: true }),
    });

    assert.deepEqual(intake.constraint, {
      name: "baseline evidence",
      tocStep: "exploit",
      reason: "The screen cannot be reviewed reliably without visible runtime evidence.",
      nextStep: "Capture ux-context or a screenshot, then inspect the image against the first-screen invariants.",
    });
    assert.equal(prePatch.name, "baseline evidence");
  });

  it("prioritizes verifier blockers before interaction, chrome, affordance, and static gates", () => {
    const constraint = chooseReviewConstraint({
      stage: "interaction",
      flags: flags({
        hasAcceptanceContract: true,
        hasScreenshot: true,
        changedGesture: true,
        changedChrome: true,
      }),
      verifierRule: "gesture-panresponder",
    });

    assert.deepEqual(constraint, {
      name: "workflow blocker",
      tocStep: "elevate",
      reason: "Verifier rule gesture-panresponder maps to the changed workflow.",
      nextStep: "Treat the verifier finding as blocking, fix the underlying workflow, or record an explicit product exception.",
    });
  });

  it("classifies interaction, chrome/navigation, affordance, static, and handoff constraints in legacy order", () => {
    assert.equal(chooseReviewConstraint({
      stage: "interaction",
      flags: flags({ hasAcceptanceContract: true, hasScreenshot: true }),
    }).name, "interaction proof");
    assert.equal(chooseReviewConstraint({
      stage: "handoff",
      flags: flags({ hasAcceptanceContract: true, hasScreenshot: true, changedNavigation: true }),
    }).name, "chrome/navigation proof");
    assert.equal(chooseReviewConstraint({
      stage: "handoff",
      flags: flags({ hasAcceptanceContract: true, hasScreenshot: true, addedVisibleControls: true }),
    }).name, "affordance validation");
    assert.equal(chooseReviewConstraint({
      stage: "handoff",
      flags: flags({ hasAcceptanceContract: true, hasScreenshot: true }),
    }).name, "static pattern gate");
    assert.equal(chooseReviewConstraint({
      stage: "handoff",
      flags: flags({ hasAcceptanceContract: true, hasScreenshot: true, hasStaticVerifier: true }),
    }).name, "handoff proof");
  });

  it("returns legacy surface-specific first-screen flows and templates", async () => {
    const calendar = parseToolJson(await reviewNextStep({
      surface: "calendar",
      issue: "today screen is cropped",
      hasAcceptanceContract: true,
      hasScreenshot: true,
      hasStaticVerifier: true,
    }));
    const navigation = reviewFlowsForSurface("navigation");
    const form = reviewFlowsForSurface("form");
    const list = reviewFlowsForSurface("list");
    const editor = reviewFlowsForSurface("editor");

    assert.equal(calendar.issue, "today screen is cropped");
    assert.deepEqual(calendar.requiredFlows.firstScreenInvariants, [
      "current day remains visibly distinct",
      "current time is visible or the screen explains why not",
      "date context is still visible after positioning near now",
      "bottom tab/home-indicator chrome does not crop or cover working time",
    ]);
    assert.equal(calendar.requiredFlows.flows.at(-1), "today selected, today not selected, past, future, occupied, and free states");
    assert.deepEqual(calendar.acceptanceContractTemplate.firstScreenInvariants, calendar.requiredFlows.firstScreenInvariants);
    assert.equal(navigation.representativeAction, "Enter the route, navigate forward, back out, switch tabs, and return.");
    assert.deepEqual(form.flows, ["focus/keyboard", "invalid submit", "recovery", "valid submit"]);
    assert.deepEqual(list.evidenceRequired, ["ux-context or screenshot", "scroll/row interaction proof"]);
    assert.deepEqual(editor.flows, ["edit", "preview", "cancel", "commit"]);
  });

  it("emits question triggers for chrome, gesture, visible controls, and verifier rules", () => {
    assert.deepEqual(reviewQuestionTriggers(flags({
      changedChrome: true,
      changedNavigation: true,
      changedGesture: true,
      addedVisibleControls: true,
    }), "safe-area"), [
      "What should this control/chrome mean: navigation, disclosure, filter, picker, or title menu?",
      "Which gesture owns the surface when scroll and direct manipulation overlap?",
      "Can object-level feedback solve discoverability before adding always-visible controls?",
      "Does verifier rule safe-area map to the changed workflow or an unrelated legacy surface?",
    ]);
  });

  it("builds command suggestions with legacy quoting, inspector, overlay, trace, gesture, and verifier commands", () => {
    const commands = reviewCommandSuggestions({
      cwd: "/tmp/app with space",
      metroPort: 19000,
      componentFilter: "Calendar Day",
      stage: "interaction",
      flags: flags({ changedGesture: true, changedChrome: true }),
    });

    assert.equal(commands[0], "expo-ios --json ux-context --cwd '/tmp/app with space' --metro-port 19000 --component-filter 'Calendar Day'");
    assert.ok(commands.includes("expo-ios --json inspector open-dev-menu"));
    assert.ok(commands.includes("expo-ios --json review-overlay prepare --cwd '/tmp/app with space' --serve true"));
    assert.ok(commands.includes("# reproduce the representative gesture in the simulator, or use expo-ios gesture when coordinates are known"));
    assert.ok(commands.includes("expo-ios --json gesture long-press --x <x> --y <y> --duration-ms 900 --capture-before-after true"));
    assert.equal(commands.at(-1), "verify-native-experience <expo-app> --strict");
  });

  it("tracks stop conditions and changed-workflow verifier matching", () => {
    assert.deepEqual(reviewStopConditions({
      flags: flags({ changedGesture: true, changedChrome: true }),
      verifierRule: "safe area tab",
    }), [
      "Stop before patching: acceptance contract is missing.",
      "Stop before handoff: gesture/direct-manipulation proof is missing.",
      "Stop before handoff: tab/header/safe-area behavior has not been exercised.",
      "Stop before handoff: verifier rule safe area tab maps to the changed workflow.",
    ]);
    assert.equal(verifierRuleMatchesChangedWorkflow("row wrapper text", flags()), true);
    assert.equal(verifierRuleMatchesChangedWorkflow("modal back", flags({ changedNavigation: true })), true);
    assert.equal(verifierRuleMatchesChangedWorkflow("gesture", flags({ changedGesture: false })), false);
    assert.equal(JSON.parse(toolJson({ ok: true }).content[0]?.text ?? "{}").ok, true);
  });
});

function flags(overrides: Partial<{
  hasAcceptanceContract: boolean;
  hasScreenshot: boolean;
  hasInteractionProof: boolean;
  hasStaticVerifier: boolean;
  changedGesture: boolean;
  changedChrome: boolean;
  changedNavigation: boolean;
  addedVisibleControls: boolean;
}> = {}) {
  return {
    hasAcceptanceContract: false,
    hasScreenshot: false,
    hasInteractionProof: false,
    hasStaticVerifier: false,
    changedGesture: false,
    changedChrome: false,
    changedNavigation: false,
    addedVisibleControls: false,
    ...overrides,
  };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
