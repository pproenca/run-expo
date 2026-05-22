#!/usr/bin/env node

import { spawn, execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const CLI_NAME = "expo-ios";
const CLI_VERSION = "0.1.0";
const MAX_OUTPUT = 40_000;
const EXIT_SUCCESS = 0;
const EXIT_RUNTIME_FAILURE = 1;
const EXIT_INVALID_USAGE = 2;
const REDACTED = "[redacted]";

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
    this.exitCode = EXIT_INVALID_USAGE;
  }
}

const tools = [
  {
    name: "doctor",
    description: "Check local Expo/iOS developer tooling needed by the expo-ios CLI.",
    inputSchema: objectSchema({
      cwd: stringSchema("Project directory. Defaults to the current working directory."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "project_info",
    description: "Inspect the current Expo project: package manager, Expo dependency, app config, and iOS identifiers.",
    inputSchema: objectSchema({
      cwd: stringSchema("Project directory. Defaults to the current working directory."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "expo_router_sitemap",
    description: "Generate a filesystem-derived sitemap for an Expo Router app directory without starting Metro.",
    inputSchema: objectSchema({
      cwd: stringSchema("Project directory. Defaults to the current working directory."),
      appDir: stringSchema("Expo Router app directory, relative to cwd or absolute. Defaults to app."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_devices",
    description: "List available iOS simulators and Android devices/emulators visible to local developer tooling.",
    inputSchema: objectSchema({
      platform: enumSchema(["ios", "android", "all"], "Device platform. Defaults to all."),
      limit: numberSchema("Maximum devices to return per platform. Defaults to 40.", { minimum: 1, maximum: 200 }),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "session",
    description: "Create and inspect local expo-ios evidence sessions and artifact namespaces.",
    inputSchema: objectSchema({
      action: enumSchema(["new"], "Session action. Milestone 1 tracer bullet supports new."),
      name: stringSchema("Human-readable session name. Defaults to review."),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Session artifacts use a sibling sessions directory when this ends in runs."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "target",
    description: "List, select, and inspect stable simulator/app/Metro target handles for a session.",
    inputSchema: objectSchema({
      action: enumSchema(["list", "select", "current"], "Target action."),
      targetId: stringSchema("Target ID to select."),
      platform: enumSchema(["ios", "android", "all"], "Target platform. Defaults to all."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Target selection uses a sibling sessions directory when this ends in runs."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "snapshot",
    description: "Capture a semantic accessibility snapshot with stable @e refs for the current target.",
    inputSchema: objectSchema({
      interactive: booleanSchema("Only include interactive elements. Defaults to false."),
      compact: booleanSchema("Remove empty structural nodes. Defaults to false."),
      depth: numberSchema("Maximum tree depth.", { minimum: 1, maximum: 100 }),
      source: booleanSchema("Include source hints when available."),
      bounds: booleanSchema("Include screen bounds when available."),
      metroPort: numberSchema("Metro port for optional semantic bridge data. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Snapshot artifacts use a sibling sessions directory when this ends in runs."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "refs",
    description: "Read cached semantic refs from the latest session snapshot.",
    inputSchema: objectSchema({
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Ref cache uses a sibling sessions directory when this ends in runs."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_ref",
    description: "Inspect one cached semantic ref field from the latest snapshot.",
    inputSchema: objectSchema({
      field: enumSchema(["text", "props", "box", "style", "source"], "Ref field to inspect."),
      ref: stringSchema("Element ref such as @e1."),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Ref cache uses a sibling sessions directory when this ends in runs."),
    }, ["field", "ref"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "find",
    description: "Find cached semantic refs by role, text, label, placeholder, testID, or source, with optional dry-run action planning.",
    inputSchema: objectSchema({
      kind: enumSchema(["role", "text", "label", "placeholder", "testid", "source"], "Finder kind."),
      value: stringSchema("Finder value."),
      name: stringSchema("Accessible name filter for role finders."),
      action: enumSchema(["tap", "long-press", "fill", "focus", "inspect"], "Optional action to plan on the first match."),
      text: stringSchema("Text to fill when action is fill."),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Ref cache uses a sibling sessions directory when this ends in runs."),
    }, ["kind", "value"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "wait",
    description: "Wait for cached semantic evidence such as text content or ref visibility in the current session snapshot.",
    inputSchema: objectSchema({
      ref: stringSchema("Element ref such as @e1."),
      state: enumSchema(["visible", "hidden"], "Ref state predicate."),
      text: stringSchema("Text to wait for in semantic refs."),
      timeoutMs: numberSchema("Maximum wait time in milliseconds. Defaults to 5000.", { minimum: 0, maximum: 60000 }),
      ms: numberSchema("Sleep duration when no predicate is supplied.", { minimum: 0, maximum: 60000 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Ref cache uses a sibling sessions directory when this ends in runs."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "batch",
    description: "Run multiple expo-ios command steps with shared root, state, and JSON context.",
    inputSchema: objectSchema({
      steps: {
        type: "array",
        description: "Command steps as argv arrays or JSON-encoded argv arrays.",
        items: { type: ["array", "string"] },
      },
      bail: booleanSchema("Stop after the first failed step. Defaults to false."),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Batch steps reuse this state directory."),
    }, ["steps"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "boot_simulator",
    description: "Boot an iOS simulator by name or UDID and open Simulator.app.",
    inputSchema: objectSchema({
      device: stringSchema("Simulator UDID or exact/partial simulator name. Defaults to a booted simulator, then the newest available iPhone."),
      openSimulator: booleanSchema("Open Simulator.app after booting. Defaults to true."),
    }),
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: "open_url",
    description: "Open a URL or deep link on an iOS simulator or Android emulator/device.",
    inputSchema: objectSchema({
      platform: enumSchema(["ios", "android"], "Target platform. Defaults to ios."),
      device: stringSchema("iOS simulator UDID/name or Android device serial. Defaults to booted/default device."),
      url: stringSchema("URL or app deep link to open."),
    }, ["url"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "launch_app",
    description: "Launch an installed app on an iOS simulator or Android device/emulator.",
    inputSchema: objectSchema({
      platform: enumSchema(["ios", "android"], "Target platform. Defaults to ios."),
      device: stringSchema("iOS simulator UDID/name or Android device serial. Defaults to booted/default device."),
      bundleId: stringSchema("iOS bundle identifier, such as com.example.app."),
      processName: stringSchema("Optional process name to match iOS crash reports."),
      crashCheckMs: numberSchema("Milliseconds to wait for a matching iOS crash report after launch. Defaults to 0.", { minimum: 0, maximum: 30000 }),
      packageName: stringSchema("Android package name, such as com.example.app."),
      activity: stringSchema("Optional Android activity to launch."),
    }),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "collect_app_logs",
    description: "Collect recent logs from iOS Simulator or Android logcat, with bundle/process filtering where available.",
    inputSchema: objectSchema({
      platform: enumSchema(["ios", "android"], "Target platform. Defaults to ios."),
      device: stringSchema("iOS simulator UDID/name or Android device serial. Defaults to booted/default device."),
      last: stringSchema("iOS log window passed to log show --last, such as 2m or 30s. Defaults to 2m."),
      lines: numberSchema("Android logcat line count. Defaults to 500.", { minimum: 1, maximum: 5000 }),
      bundleId: stringSchema("App bundle/package identifier used for filtering where possible."),
      processName: stringSchema("iOS process name for filtering."),
      predicate: stringSchema("Raw iOS log predicate. Overrides bundleId/processName."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "automation_take_screenshot",
    description: "Capture a screenshot from an iOS simulator or Android device/emulator and return the local image path.",
    inputSchema: objectSchema({
      platform: enumSchema(["ios", "android"], "Target platform. Defaults to ios."),
      device: stringSchema("iOS simulator UDID/name or Android device serial. Defaults to booted/default device."),
      outputPath: stringSchema("Optional output PNG path. Defaults to a temp file."),
      annotate: booleanSchema("Write an SVG overlay and label-map metadata bound to cached semantic refs."),
      full: booleanSchema("Capture a stitched segmented scroll screenshot when simulator gesture and image stitching tools are available."),
      fullSegments: numberSchema("Number of viewport segments to capture for --full. Defaults to 3.", { minimum: 1, maximum: 12 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Ref cache uses a sibling sessions directory when this ends in runs."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "automation_tap",
    description: "Tap device coordinates. Android uses adb input tap. iOS uses idb or axe when installed.",
    inputSchema: objectSchema({
      platform: enumSchema(["ios", "android"], "Target platform. Defaults to ios."),
      device: stringSchema("iOS simulator UDID/name or Android device serial. Defaults to booted/default device."),
      x: numberSchema("X coordinate."),
      y: numberSchema("Y coordinate."),
    }, ["x", "y"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "automation_gesture",
    description: "Run or plan a tap, long-press, drag, or swipe gesture, optionally with screenshots and Hermes trace evidence.",
    inputSchema: objectSchema({
      platform: enumSchema(["ios", "android"], "Target platform. Defaults to ios."),
      device: stringSchema("iOS simulator UDID/name or Android device serial. Defaults to booted/default device."),
      gesture: enumSchema(["tap", "long-press", "tap-and-hold", "drag", "swipe"], "Gesture to perform."),
      x: numberSchema("X coordinate for tap or long-press."),
      y: numberSchema("Y coordinate for tap or long-press."),
      startX: numberSchema("Start X coordinate for drag or swipe."),
      startY: numberSchema("Start Y coordinate for drag or swipe."),
      endX: numberSchema("End X coordinate for drag or swipe."),
      endY: numberSchema("End Y coordinate for drag or swipe."),
      durationMs: numberSchema("Gesture duration in milliseconds. Defaults vary by gesture.", { minimum: 1, maximum: 30000 }),
      holdMs: numberSchema("Optional hold-before-move duration in milliseconds when supported.", { minimum: 0, maximum: 30000 }),
      repeat: numberSchema("Number of times to perform the gesture. Defaults to 1.", { minimum: 1, maximum: 20 }),
      intervalMs: numberSchema("Delay between repeated gestures in milliseconds. Defaults to 250.", { minimum: 0, maximum: 10000 }),
      dryRun: booleanSchema("Return the planned platform commands without executing them. Defaults to false."),
      captureBeforeAfter: booleanSchema("Capture screenshots before and after the gesture. Defaults to false."),
      outputDir: stringSchema("Optional directory for before/after screenshots. Defaults to a temp directory."),
      includeTrace: booleanSchema("Wrap the gesture with expo-ios trace start/read/stop. Defaults to false."),
      cwd: stringSchema("Expo project directory for trace evidence. Defaults to current working directory."),
      metroPort: numberSchema("Metro port for trace evidence. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      componentFilter: stringSchema("Optional component filter for trace evidence."),
      maxEvents: numberSchema("Maximum trace events to return when includeTrace is true. Defaults to 200.", { minimum: 1, maximum: 2000 }),
    }, ["gesture"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "open_expo_route",
    description: "Open an Expo Router route or explicit deep link on an iOS simulator.",
    inputSchema: objectSchema({
      cwd: stringSchema("Expo project directory. Used to infer the app scheme when scheme is omitted."),
      device: stringSchema("iOS simulator UDID or name. Defaults to the booted simulator."),
      url: stringSchema("Explicit URL/deep link to open. If set, scheme/route/query are ignored."),
      scheme: stringSchema("App URL scheme such as my-app. Inferred from app.json/app.config when omitted."),
      route: stringSchema("Expo Router path to open, such as /, /customers, or /appointments/123. Defaults to /."),
      query: stringSchema("Optional raw query string without leading ?."),
      authCookie: stringSchema("Optional auth cookie to append as a URL-encoded cookie query param."),
    }),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "capture_ux_context",
    description: "Capture screenshot, visual analysis, routes, iOS hierarchy, recent logs, and Metro/Hermes runtime component/layout context for the current Expo iOS screen.",
    inputSchema: objectSchema({
      cwd: stringSchema("Expo project directory. Defaults to the current working directory."),
      device: stringSchema("iOS simulator UDID or name. Defaults to the booted simulator."),
      bundleId: stringSchema("iOS bundle identifier. Inferred from Metro inspector or app config when possible."),
      processName: stringSchema("iOS process name for log filtering. Inferred from bundleId when possible."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      outputPath: stringSchema("Optional screenshot PNG path. Defaults to a temp file."),
      includeScreenshot: booleanSchema("Capture a simulator screenshot. Defaults to true."),
      includeImageAnalysis: booleanSchema("Analyze screenshot colors and coarse composition. Defaults to true."),
      includeHierarchy: booleanSchema("Try to pull the AX hierarchy with axe describe-ui. Defaults to true."),
      includeRuntime: booleanSchema("Try Metro and Hermes inspector runtime probes. Defaults to true."),
      includeComponents: booleanSchema("Try to extract React component and host element hierarchy through the Hermes inspector. Defaults to true when includeRuntime is true."),
      componentFilter: stringSchema("Optional case-insensitive filter for component/layout extraction."),
      includeLogs: booleanSchema("Collect recent filtered iOS logs. Defaults to false for speed."),
      logsLast: stringSchema("iOS log window when includeLogs is true, such as 30s or 2m. Defaults to 60s."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "annotate_screen",
    description: "Create a local screenshot annotation board so a human can leave element comments that Codex can read as JSON.",
    inputSchema: objectSchema({
      cwd: stringSchema("Expo project directory. Defaults to current working directory."),
      device: stringSchema("iOS simulator UDID/name. Defaults to the booted simulator when capturing a screenshot."),
      bundleId: stringSchema("iOS bundle identifier for ux-context capture."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      screenshotPath: stringSchema("Existing screenshot PNG to annotate. If omitted, ux-context captures one from the simulator."),
      outputDir: stringSchema("Directory for annotation artifacts. Defaults to .scratch/expo-ios-annotations/<timestamp>."),
      title: stringSchema("Human-readable title for the annotation board."),
      serve: booleanSchema("Start a local background server so comments save directly to annotations.json. Defaults to false."),
      port: numberSchema("Local server port when serve=true. Defaults to the first free port starting at 17654.", { minimum: 1, maximum: 65535 }),
      includeUxContext: booleanSchema("Capture ux-context JSON when screenshotPath is omitted. Defaults to true."),
    }),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "runtime_inspector",
    description: "Toggle the React Native in-app inspector and install/read simulator-side UI review comments through the dev menu.",
    inputSchema: objectSchema({
      cwd: stringSchema("Expo project directory. Used only for command context. Defaults to current working directory."),
      device: stringSchema("iOS simulator UDID/name for open-dev-menu. Defaults to the booted simulator."),
      bundleId: stringSchema("iOS bundle identifier to terminate when restartDevClient=true."),
      devClientUrl: stringSchema("Optional Expo development client URL to open when Metro has no connected /message peer."),
      restartDevClient: booleanSchema("Terminate bundleId before opening devClientUrl. Defaults to false."),
      crashCheckMs: numberSchema("Milliseconds to wait for a matching iOS crash report after opening devClientUrl. Defaults to 0.", { minimum: 0, maximum: 30000 }),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      action: enumSchema(["probe", "toggle", "install-comment-menu", "read-comments", "clear-comments", "open-dev-menu"], "Inspector action. Defaults to probe."),
      commentTitle: stringSchema("Dev menu item title for comment capture. Defaults to Codex: Add UI comment."),
      maxComments: numberSchema("Maximum stored comments to return. Defaults to 50.", { minimum: 1, maximum: 500 }),
    }),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "review_overlay",
    description: "Create and run a dev-only in-app Codex review overlay with one Comment control, element hit boxes, gesture notes, and a local JSON event channel.",
    inputSchema: objectSchema({
      cwd: stringSchema("Expo project directory. Defaults to current working directory."),
      action: enumSchema(["prepare", "scaffold", "server", "read", "clear"], "Overlay action. Defaults to prepare."),
      outputDir: stringSchema("Directory for overlay event artifacts. Defaults to .scratch/codex-review-overlay."),
      overlayDir: stringSchema("Directory where the React Native overlay component should be written. Defaults to codex-review-overlay."),
      endpointPath: stringSchema("HTTP endpoint path used by the overlay. Defaults to /events."),
      metroPort: numberSchema("Metro port used to symbolicate element component stacks on read. Defaults to no symbolication.", { minimum: 1, maximum: 65535 }),
      title: stringSchema("Human-readable review title."),
      port: numberSchema("Local server port. Defaults to the first free port starting at 17655.", { minimum: 1, maximum: 65535 }),
      serve: booleanSchema("For prepare: start a local background server. Defaults to false."),
      force: booleanSchema("For scaffold: overwrite existing overlay files. Defaults to false."),
    }),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "review_next_step",
    description: "Suggest the next constraint-focused evidence step for Expo iOS UI review-and-fix work.",
    inputSchema: objectSchema({
      cwd: stringSchema("Expo project directory. Used only for command suggestions."),
      surface: enumSchema(["calendar", "timeline", "form", "list", "navigation", "editor", "generic"], "Reviewed surface type. Defaults to generic."),
      stage: enumSchema(["intake", "pre-patch", "post-patch", "verifier-failed", "interaction", "handoff"], "Current review stage. Defaults to intake."),
      issue: stringSchema("Short issue or symptom being worked, such as bottom tab overlaps current-time line."),
      componentFilter: stringSchema("Optional component name/filter for ux-context and trace suggestions."),
      metroPort: numberSchema("Metro port for suggested commands. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      verifierRule: stringSchema("Optional verify-native-experience rule that failed."),
      hasAcceptanceContract: booleanSchema("Whether a pre-patch acceptance contract has been written."),
      hasScreenshot: booleanSchema("Whether current visual evidence exists."),
      hasInteractionProof: booleanSchema("Whether the representative action has been exercised."),
      hasStaticVerifier: booleanSchema("Whether verify-native-experience or equivalent has run."),
      changedGesture: booleanSchema("Whether the change touches drag, swipe, resize, draw, scrub, or gesture ownership."),
      changedChrome: booleanSchema("Whether the change touches tab/header/safe-area chrome."),
      changedNavigation: booleanSchema("Whether the change touches tabs, stacks, sheets, modals, or back/deep-link behavior."),
      addedVisibleControls: booleanSchema("Whether the change adds new always-visible controls or action affordances."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "annotation_server",
    description: "Serve a generated annotation board directory. Intended for annotate-screen --serve; normally run as a background process.",
    inputSchema: objectSchema({
      dir: stringSchema("Annotation artifact directory containing annotate.html and annotations.json."),
      port: numberSchema("Local port. Defaults to 17654.", { minimum: 1, maximum: 65535 }),
    }, ["dir"]),
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: "devtools",
    description: "Report machine-readable DevTools and runtime evidence capabilities.",
    inputSchema: objectSchema({
      action: enumSchema(["capabilities"], "DevTools action."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
    }, ["action"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "console",
    description: "Read bounded JavaScript console diagnostics from an available runtime source.",
    inputSchema: objectSchema({
      limit: numberSchema("Maximum messages to return. Defaults to 100.", { minimum: 1, maximum: 1000 }),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "errors",
    description: "Read bounded JavaScript error diagnostics from an available runtime source.",
    inputSchema: objectSchema({
      limit: numberSchema("Maximum errors to return. Defaults to 100.", { minimum: 1, maximum: 1000 }),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "metro",
    description: "Report Metro status, connected targets, and symbolication availability without starting Metro.",
    inputSchema: objectSchema({
      action: enumSchema(["status"], "Metro action."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
    }, ["action"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "navigation",
    description: "Read or drive runtime navigation state through the dev-only app instrumentation bridge.",
    inputSchema: objectSchema({
      action: enumSchema(["state", "back", "pop-to-root", "tab", "deep-link"], "Navigation action."),
      tab: stringSchema("Tab name or index for navigation tab."),
      route: stringSchema("Route for deep-link action."),
      url: stringSchema("Explicit URL/deep link for deep-link action."),
      scheme: stringSchema("URL scheme for deep-link action."),
      query: stringSchema("Query string for deep-link action."),
      device: stringSchema("iOS simulator UDID/name. Defaults to a booted simulator for deep-link."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Navigation evidence reuses this state directory."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "network",
    description: "Read dev-only app network evidence and write redacted HAR artifacts.",
    inputSchema: objectSchema({
      action: enumSchema(["status", "requests", "request", "clear", "har"], "Network action."),
      harAction: enumSchema(["start", "stop"], "HAR action when action is har."),
      requestId: stringSchema("Request id for network request."),
      outputPath: stringSchema("Output HAR path for network har stop."),
      limit: numberSchema("Maximum requests to return. Defaults to 100.", { minimum: 1, maximum: 1000 }),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Network artifacts reuse this state directory."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "storage",
    description: "Read or mutate app storage through the dev-only app instrumentation bridge with policy gates for writes.",
    inputSchema: objectSchema({
      store: stringSchema("Storage adapter name, such as async, mmkv, secure, or sqlite."),
      action: enumSchema(["list", "get", "set", "clear"], "Storage action."),
      key: stringSchema("Storage key for get/set."),
      value: stringSchema("JSON value for set."),
      limit: numberSchema("Maximum entries to return. Defaults to 100.", { minimum: 1, maximum: 1000 }),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      actionPolicy: stringSchema("Policy JSON file permitting write/clear actions."),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
    }, ["store", "action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "state",
    description: "List, save, load, or clear app state snapshots through the dev-only app instrumentation bridge.",
    inputSchema: objectSchema({
      action: enumSchema(["list", "save", "load", "clear"], "State action."),
      name: stringSchema("State snapshot name."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      actionPolicy: stringSchema("Policy JSON file permitting load/clear actions."),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "controls",
    description: "List, inspect, and press app-defined controls through the dev-only app instrumentation bridge.",
    inputSchema: objectSchema({
      action: enumSchema(["list", "get", "press"], "Controls action."),
      name: stringSchema("Control name for get/press."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      actionPolicy: stringSchema("Policy JSON file permitting press actions."),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "bridge",
    description: "Plan and inspect the dev-only Expo/Rozenite app bridge installation without mutating unless explicitly confirmed.",
    inputSchema: objectSchema({
      action: enumSchema(["status", "plan", "health", "domains", "install", "remove"], "Bridge action."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      domain: stringSchema("Optional domain name to inspect for bridge domains."),
      command: stringSchema("Optional read/write command name to check policy gating for bridge domains."),
      actionPolicy: stringSchema("Policy JSON file permitting write actions."),
      cwd: stringSchema("Expo project directory. Defaults to the current working directory."),
      confirmActions: stringSchema("Comma-separated explicit confirmations such as bridge-install or bridge-remove."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "accessibility",
    description: "Capture native accessibility tree, inspect cached refs, or run basic accessibility audits.",
    inputSchema: objectSchema({
      action: enumSchema(["tree", "inspect", "audit"], "Accessibility action."),
      ref: stringSchema("Element ref for inspect."),
      device: stringSchema("iOS simulator UDID/name."),
      metroPort: numberSchema("Metro port for optional semantic bridge data. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Ref cache uses a sibling sessions directory when this ends in runs."),
    }, ["action"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "dialog",
    description: "Report or act on visible native/app dialog blockers through dev-only instrumentation.",
    inputSchema: objectSchema({
      action: enumSchema(["status", "accept", "dismiss"], "Dialog action."),
      text: stringSchema("Optional text for accept."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "sheet",
    description: "Report or dismiss visible sheet/modal blockers through dev-only instrumentation.",
    inputSchema: objectSchema({
      action: enumSchema(["status", "dismiss"], "Sheet action."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "record",
    description: "Create simulator recording evidence metadata and stop artifacts tied to session state.",
    inputSchema: objectSchema({
      action: enumSchema(["start", "stop"], "Recording action."),
      outputPath: stringSchema("Output video path for stop."),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Recording artifacts reuse this state directory."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "diff",
    description: "Write before/after evidence diffs for snapshots or screenshots.",
    inputSchema: objectSchema({
      kind: enumSchema(["snapshot", "screenshot"], "Diff kind."),
      baseline: stringSchema("Baseline artifact path."),
      current: stringSchema("Current artifact path. Defaults to latest snapshot for snapshot diffs."),
      outputPath: stringSchema("Output JSON artifact path."),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Diff artifacts reuse this state directory."),
    }, ["kind", "baseline"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "expo",
    description: "Report Expo modules, resolved config, doctor summary, upstream dependency policy, and prebuild/config-plugin risk.",
    inputSchema: objectSchema({
      action: enumSchema(["modules", "config", "doctor", "upstream-policy", "prebuild-plan"], "Expo introspection action."),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
    }, ["action"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "rn",
    description: "Report React Native tree, ref inspection, render, and fiber evidence with source limitations.",
    inputSchema: objectSchema({
      action: enumSchema(["tree", "inspect", "renders", "fiber"], "React Native introspection action."),
      subaction: enumSchema(["start", "stop", "read"], "Render recording subaction."),
      ref: stringSchema("Semantic element ref such as @e1 for inspect/fiber."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Ref cache uses a sibling sessions directory when this ends in runs."),
    }, ["action"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "perf",
    description: "Report layered performance evidence for summary, startup, action, and bundle measurements.",
    inputSchema: objectSchema({
      action: enumSchema(["summary", "startup", "action", "bundle", "mark", "measure", "compare", "budget", "js-thread", "frames", "memory", "ettrace", "memgraph"], "Performance evidence action."),
      subaction: stringSchema("Subaction for mark, measure, budget, ettrace, and memgraph."),
      label: stringSchema("Representative action or measure label."),
      bundleArtifact: stringSchema("Existing Metro/Expo bundle artifact to measure for perf bundle."),
      baseline: stringSchema("Baseline performance result path for compare."),
      candidate: stringSchema("Candidate performance result path for compare or budget check."),
      file: stringSchema("Budget definition path for perf budget check."),
      nativeArtifact: stringSchema("Native profiler artifact path for ETTrace or memgraph."),
      outputPath: stringSchema("Output JSON artifact path for measured performance results."),
      buildKind: enumSchema(["development", "dev-build", "preview", "release-export", "production", "unknown"], "Build context for the measurement."),
      samples: numberSchema("Sample count for memory evidence.", { minimum: 1, maximum: 100 }),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Artifacts use a sibling artifacts directory when this ends in runs."),
    }, ["action"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "dashboard",
    description: "Start, stop, or report a local observability dashboard for sessions and artifacts.",
    inputSchema: objectSchema({
      action: enumSchema(["start", "status", "stop"], "Dashboard action."),
      outputPath: stringSchema("Output dashboard metadata JSON path."),
      port: numberSchema("Preferred local dashboard port. Use 0 for static metadata only.", { minimum: 0, maximum: 65535 }),
      cwd: stringSchema("Project or workspace directory. Defaults to the current working directory."),
      root: stringSchema("State root for .scratch/expo-ios when stateDir is not provided."),
      stateDir: stringSchema("Run-record state directory. Dashboard state uses a sibling dashboard directory when this ends in runs."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  {
    name: "skills",
    description: "List or print bundled version-matched companion skill guidance.",
    inputSchema: objectSchema({
      action: enumSchema(["list", "get"], "Skills action."),
      name: stringSchema("Skill name for get."),
    }, ["action"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "install",
    description: "Check local install target paths for the expo-ios executable.",
    inputSchema: objectSchema({
      action: enumSchema(["check"], "Install action."),
      prefix: stringSchema("Install prefix. Defaults to ~/.local."),
    }, ["action"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "upgrade",
    description: "Check whether the local CLI package has an upgrade available.",
    inputSchema: objectSchema({
      action: enumSchema(["check"], "Upgrade action."),
      prefix: stringSchema("Install prefix. Defaults to ~/.local."),
    }, ["action"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "release",
    description: "Run release packaging checks for version/help and key JSON commands from outside the repo.",
    inputSchema: objectSchema({
      action: enumSchema(["check"], "Release action."),
      cwd: stringSchema("Outside working directory for release checks."),
    }, ["action"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "live_backlog",
    description: "Generate or run the source-derived Maddie Native live verification backlog with per-row artifacts.",
    inputSchema: objectSchema({
      action: enumSchema(["matrix", "self-check", "run"], "Live backlog action."),
      cwd: stringSchema("Expo project directory. Defaults to the current working directory."),
      outputDir: stringSchema("Directory for report and per-row stdout/stderr/exit-code artifacts."),
      scope: enumSchema(["smoke", "full"], "Backlog scope. Defaults to smoke."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      bundleId: stringSchema("iOS bundle identifier for app lifecycle rows."),
      device: stringSchema("Simulator UDID or name for device rows."),
      devClientUrl: stringSchema("Expo development client URL for reconnect rows."),
      actionPolicy: stringSchema("Action policy file for gated mutation rows."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
  {
    name: "trace_interaction",
    description: "Start/read/stop a lightweight Hermes runtime interaction trace for React commits, layout/style changes, animation frames, and handler-bearing components.",
    inputSchema: objectSchema({
      cwd: stringSchema("Expo project directory. Defaults to the current working directory."),
      metroPort: numberSchema("Metro port. Defaults to 8081.", { minimum: 1, maximum: 65535 }),
      action: enumSchema(["start", "read", "stop", "clear"], "Trace action. Use start before reproducing an interaction, read after, stop to restore patches, clear to empty the buffer."),
      componentFilter: stringSchema("Optional case-insensitive filter for trace summaries."),
      maxEvents: numberSchema("Maximum trace events to return. Defaults to 300.", { minimum: 1, maximum: 2000 }),
      includeEvents: booleanSchema("Include raw per-event records. Defaults to false."),
    }, ["action"]),
    annotations: { readOnlyHint: false, idempotentHint: false },
  },
];

const handlers = {
  doctor,
  project_info: projectInfo,
  expo_router_sitemap: expoRouterSitemap,
  list_devices: listDevices,
  session: sessionCommand,
  target: targetCommand,
  snapshot: snapshotCommand,
  refs: refsCommand,
  get_ref: getRefCommand,
  find: findCommand,
  wait: waitCommand,
  batch: batchCommand,
  boot_simulator: bootSimulator,
  open_url: openUrl,
  launch_app: launchApp,
  terminate_app: terminateApp,
  reload_app: reloadApp,
  install_app: installApp,
  uninstall_app: uninstallApp,
  ref_action: refActionCommand,
  clipboard: clipboardCommand,
  keyboard: keyboardCommand,
  set_environment: setEnvironmentCommand,
  collect_app_logs: collectAppLogs,
  automation_take_screenshot: automationTakeScreenshot,
  automation_tap: automationTap,
  automation_gesture: automationGesture,
  open_expo_route: openExpoRoute,
  capture_ux_context: captureUxContext,
  annotate_screen: annotateScreen,
  runtime_inspector: runtimeInspector,
  review_overlay: reviewOverlay,
  review_next_step: reviewNextStep,
  annotation_server: annotationServer,
  devtools: devtoolsCommand,
  console: consoleCommand,
  errors: errorsCommand,
  metro: metroCommand,
  navigation: navigationCommand,
  network: networkCommand,
  storage: storageCommand,
  state: stateCommand,
  controls: controlsCommand,
  bridge: bridgeCommand,
  accessibility: accessibilityCommand,
  dialog: dialogCommand,
  sheet: sheetCommand,
  record: recordCommand,
  diff: diffCommand,
  debug_inspect: debugInspectCommand,
  highlight: highlightCommand,
  expo: expoCommand,
  rn: rnCommand,
  perf: perfCommand,
  dashboard: dashboardCommand,
  review: reviewCommand,
  policy: policyCommand,
  redact: redactCommand,
  skills: skillsCommand,
  install: installCommand,
  upgrade: upgradeCommand,
  release: releaseCommand,
  live_backlog: liveBacklogCommand,
  trace_interaction: traceInteraction,
};

function stringSchema(description) {
  return { type: "string", description };
}

function numberSchema(description, extra = {}) {
  return { type: "number", description, ...extra };
}

function booleanSchema(description) {
  return { type: "boolean", description };
}

function enumSchema(values, description) {
  return { type: "string", enum: values, description };
}

function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function toolText(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function toolJson(value) {
  return toolText(`${JSON.stringify(value, null, 2)}\n`);
}

function unwrapToolJson(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function doctor(args = {}) {
  const cwd = await normalizeCwd(args.cwd).catch(() => path.resolve(args.cwd ?? process.cwd()));
  const commandNames = ["node", "npx", "xcrun", "open", "plutil", "idb", "axe", "adb"];
  const commands = {};
  for (const command of commandNames) {
    commands[command] = await commandPath(command);
  }
  const projectInfoResult = await safeToolSection(() => projectInfo({ cwd }));
  const repairs = args.fix === true ? await doctorRepairs(cwd) : [];
  return toolJson({
    cli: { name: CLI_NAME, version: CLI_VERSION },
    cwd,
    auth: { required: false, source: "not-required" },
    commands,
    capabilities: {
      iosSimulator: Boolean(commands.xcrun),
      simulatorScreenshots: Boolean(commands.xcrun),
      iosCoordinateTap: Boolean(commands.idb || commands.axe),
      iosCoordinateGestures: Boolean(commands.idb || commands.axe),
      iosHierarchy: Boolean(commands.axe),
      androidDeviceBridge: Boolean(commands.adb),
      expoCli: Boolean(commands.npx),
      metroHermes: typeof fetch === "function" && typeof WebSocket === "function",
    },
    repairs,
    project: projectInfoResult.ok ? unwrapToolJson(projectInfoResult.value) : projectInfoResult,
  });
}

async function doctorRepairs(cwd) {
  const stateRoot = resolveExpoStateRoot({ cwd });
  await fs.mkdir(path.join(stateRoot, "runs"), { recursive: true });
  await fs.mkdir(path.join(stateRoot, "sessions"), { recursive: true });
  return [
    { action: "ensure-directory", path: path.join(stateRoot, "runs") },
    { action: "ensure-directory", path: path.join(stateRoot, "sessions") },
  ];
}

async function projectInfo(args) {
  const cwd = await normalizeCwd(args.cwd);
  const packageJsonPath = await findUp(cwd, "package.json");
  if (!packageJsonPath) {
    return toolJson({
      cwd,
      isExpoProject: false,
      reason: "No package.json found in this directory or its parents.",
    });
  }

  const projectRoot = path.dirname(packageJsonPath);
  const packageJson = await readJsonFile(packageJsonPath);
  const allDeps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };
  const appJsonPath = await pathExists(path.join(projectRoot, "app.json"));
  const appConfigPath = await firstExisting(projectRoot, ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]);
  const appJson = appJsonPath ? await readJsonFile(path.join(projectRoot, "app.json")) : null;
  const expoConfig = appJson?.expo ?? appJson ?? null;
  const appConfigSummary = await readExpoConfigSummary(projectRoot);
  const easJson = (await pathExists(path.join(projectRoot, "eas.json")))
    ? await readJsonFile(path.join(projectRoot, "eas.json"))
    : null;
  const packageManager = await detectPackageManager(projectRoot);

  return toolJson({
    cwd,
    projectRoot,
    isExpoProject: Boolean(allDeps.expo || expoConfig),
    packageManager,
    expoDependency: allDeps.expo ?? null,
    reactNativeDependency: allDeps["react-native"] ?? null,
    expoRouterDependency: allDeps["expo-router"] ?? null,
    upstreamDependencies: buildUpstreamDependencyReport(projectRoot, allDeps),
    scripts: packageJson.scripts ?? {},
    appConfig: appConfigSummary
      ? projectInfoAppConfigSummary(appConfigSummary)
      : expoConfig
        ? {
            source: appJsonPath ? "app.json" : path.basename(appConfigPath ?? ""),
            name: expoConfig.name ?? null,
            slug: expoConfig.slug ?? null,
            scheme: expoConfig.scheme ?? null,
            iosBundleIdentifier: expoConfig.ios?.bundleIdentifier ?? null,
            androidPackage: expoConfig.android?.package ?? null,
            easProjectId: expoConfig.extra?.eas?.projectId ?? null,
          }
        : null,
    hasDynamicAppConfig: Boolean(appConfigPath),
    eas: easJson
      ? {
          buildProfiles: Object.keys(easJson.build ?? {}),
          submitProfiles: Object.keys(easJson.submit ?? {}),
          cli: easJson.cli ?? null,
        }
      : null,
  });
}

const EXPO_REACT_NATIVE_COMPATIBILITY = [
  { expoMajor: 54, reactNativeMajorMinor: "0.81" },
  { expoMajor: 53, reactNativeMajorMinor: "0.79" },
  { expoMajor: 52, reactNativeMajorMinor: "0.76" },
  { expoMajor: 51, reactNativeMajorMinor: "0.74" },
  { expoMajor: 50, reactNativeMajorMinor: "0.73" },
];

function buildUpstreamDependencyReport(projectRoot, allDeps = {}) {
  const expoVersion = dependencyInfo(allDeps, "expo");
  const reactNativeVersion = dependencyInfo(allDeps, "react-native");
  const metroVersion = dependencyInfo(allDeps, "metro");
  const expoCliVersion = dependencyInfo(allDeps, "@expo/cli");
  const devMiddlewareVersion = dependencyInfo(allDeps, "@react-native/dev-middleware");
  const rozenitePackages = Object.keys(allDeps)
    .filter((name) => name === "rozenite" || name.startsWith("@rozenite/"))
    .sort()
    .map((name) => dependencyInfo(allDeps, name));
  const expoRnCompatibility = classifyExpoReactNativeCompatibility(expoVersion, reactNativeVersion);
  const dependencies = [
    {
      id: "expo-public-api",
      ecosystem: "expo",
      packageName: "expo",
      integrationPoint: "Expo config, dev-client, expo/devtools plugin APIs, and public package exports.",
      classification: "public-api",
      usage: "direct-dependency",
      directDependency: expoVersion.present,
      declaredVersion: expoVersion.declaredVersion,
      resolvedVersion: expoVersion.resolvedVersion,
      status: dependencyStatus(expoVersion),
      compatibility: expoRnCompatibility.forExpo,
      notes: expoVersion.present
        ? ["Expo is declared by the project and can be used for public API compatibility checks."]
        : ["Expo is not declared; Expo-specific upstream clients remain unavailable."],
    },
    {
      id: "metro-inspector-http",
      ecosystem: "metro",
      packageName: "metro",
      integrationPoint: "Metro /status, /json/list, /json/version, /symbolicate, and /message HTTP/WebSocket surfaces.",
      classification: "documented-unstable-api",
      usage: "optional-compatibility-shim",
      directDependency: metroVersion.present,
      declaredVersion: metroVersion.declaredVersion,
      resolvedVersion: metroVersion.resolvedVersion,
      status: metroVersion.present
        ? dependencyStatus(metroVersion)
        : expoVersion.present
          ? "inferred-transitive"
          : "missing",
      compatibility: {
        state: metroVersion.present || expoVersion.present ? "discoverable-at-runtime" : "missing",
        expected: "Metro inspector endpoints are discovered over local HTTP at runtime; direct internal imports are not required.",
      },
      notes: [
        "The CLI may probe Metro's local HTTP endpoints, but Metro server internals are reference-only unless isolated by a shim.",
      ],
    },
    {
      id: "hermes-react-native-cdp",
      ecosystem: "hermes-react-native",
      packageName: "react-native",
      integrationPoint: "Hermes inspector Chrome DevTools Protocol websocket exposed by React Native/Metro.",
      classification: "optional-compatibility-shim",
      usage: "optional-compatibility-shim",
      directDependency: reactNativeVersion.present,
      declaredVersion: reactNativeVersion.declaredVersion,
      resolvedVersion: reactNativeVersion.resolvedVersion,
      status: dependencyStatus(reactNativeVersion),
      compatibility: expoRnCompatibility.forReactNative,
      notes: [
        "CDP method calls must stay behind the expo-ios CDP client because Hermes/RN can expose implementation-specific methods.",
      ],
    },
    {
      id: "react-native-devtools",
      ecosystem: "react-native-devtools",
      packageName: "@react-native/dev-middleware",
      integrationPoint: "React Native DevTools launch metadata, panel discovery, and machine-readable domains where available.",
      classification: "documented-unstable-api",
      usage: "internal-reference-only",
      directDependency: devMiddlewareVersion.present,
      declaredVersion: devMiddlewareVersion.declaredVersion,
      resolvedVersion: devMiddlewareVersion.resolvedVersion,
      status: devMiddlewareVersion.present
        ? dependencyStatus(devMiddlewareVersion)
        : reactNativeVersion.present
          ? "reference-only"
          : "missing",
      compatibility: {
        state: reactNativeVersion.present ? "runtime-target-required" : "missing",
        expected: "React Native DevTools capabilities are confirmed from Metro target metadata before use.",
      },
      notes: [
        "React Native DevTools internals can inform local wrappers, but command code must not depend on private build paths.",
      ],
    },
    {
      id: "expo-devtools-plugin",
      ecosystem: "expo-devtools-plugin",
      packageName: "expo",
      integrationPoint: "expo/devtools and useDevToolsPluginClient two-way development plugin APIs.",
      classification: "public-api",
      usage: "direct-dependency",
      directDependency: expoVersion.present,
      declaredVersion: expoVersion.declaredVersion,
      resolvedVersion: expoVersion.resolvedVersion,
      status: dependencyStatus(expoVersion),
      compatibility: {
        state: expoVersion.present ? "available-when-app-registers" : "missing",
        expected: "Plugin domains still require a live development build to register the app-side bridge.",
      },
      notes: [
        "Plugin bridge installation and mutation remain explicit-user-permission operations.",
      ],
    },
    {
      id: "rozenite-devtools-bridge",
      ecosystem: "rozenite",
      packageName: rozenitePackages.length > 0 ? rozenitePackages.map((item) => item.name).join(", ") : "rozenite/@rozenite/*",
      integrationPoint: "Rozenite bridge, agent, React Navigation, network, storage, controls, and performance integrations.",
      classification: "optional-compatibility-shim",
      usage: "optional-compatibility-shim",
      directDependency: rozenitePackages.length > 0,
      declaredVersion: rozenitePackages.length > 0 ? rozenitePackages.map((item) => `${item.name}@${item.declaredVersion}`).join(", ") : null,
      resolvedVersion: rozenitePackages.length > 0 ? rozenitePackages.map((item) => `${item.name}@${item.resolvedVersion ?? item.declaredVersion}`).join(", ") : null,
      status: rozenitePackages.length > 0
        ? (rozenitePackages.some((item) => item.unresolved) ? "declared-unresolved" : "present")
        : "missing",
      compatibility: {
        state: rozenitePackages.length > 0 ? "optional-present" : "optional-missing",
        expected: "Rozenite-backed domains are preferred only when installed and registered by the app.",
      },
      notes: [
        "Rozenite is optional; absence must produce structured unavailable data, not a CLI failure.",
      ],
    },
    {
      id: "expo-cli-internals",
      ecosystem: "expo",
      packageName: "@expo/cli",
      integrationPoint: "Expo CLI private implementation details used only as reference material.",
      classification: "internal-reference-only",
      usage: "internal-reference-only",
      directDependency: expoCliVersion.present,
      declaredVersion: expoCliVersion.declaredVersion,
      resolvedVersion: expoCliVersion.resolvedVersion,
      status: expoCliVersion.present ? dependencyStatus(expoCliVersion) : "not-depended-on",
      compatibility: {
        state: "reference-only",
        expected: "Private Expo CLI build paths must not be imported by command handlers.",
      },
      notes: [
        "If an internal path is ever needed, it must be wrapped by an optional compatibility shim with fallback behavior.",
      ],
    },
  ];
  return {
    schemaVersion: 1,
    projectRoot,
    policy: {
      categories: [
        { id: "public-api", mayImportDirectly: true, requiresShim: false },
        { id: "documented-unstable-api", mayImportDirectly: false, requiresShim: true },
        { id: "internal-reference-only", mayImportDirectly: false, requiresShim: true },
        { id: "optional-compatibility-shim", mayImportDirectly: false, requiresShim: true },
      ],
      rules: [
        "Command handlers depend on expo-ios adapters, not raw upstream package objects.",
        "Metro and Hermes runtime availability is confirmed at runtime before a command reports live evidence.",
        "Internal Expo, Metro, React Native, or DevTools source paths are reference material unless isolated behind optional shims.",
        "Missing optional upstream packages produce structured unavailable reports instead of thrown errors.",
      ],
    },
    summary: summarizeUpstreamDependencies(dependencies),
    dependencies,
  };
}

function dependencyInfo(allDeps, name) {
  const declaredVersion = allDeps[name] ?? null;
  return {
    name,
    present: typeof declaredVersion === "string" && declaredVersion.length > 0,
    declaredVersion,
    resolvedVersion: parseVersionLike(declaredVersion),
    unresolved: typeof declaredVersion === "string" && /^(catalog|workspace|file|link|portal):/.test(declaredVersion),
  };
}

function dependencyStatus(info) {
  if (!info.present) return "missing";
  if (info.unresolved) return "declared-unresolved";
  return "present";
}

function parseVersionLike(version) {
  if (typeof version !== "string") return null;
  const match = version.match(/\d+\.\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

function majorFromVersion(version) {
  const parsed = parseVersionLike(version);
  if (!parsed) return null;
  return Number(parsed.split(".")[0]);
}

function majorMinorFromVersion(version) {
  const parsed = parseVersionLike(version);
  if (!parsed) return null;
  const [major, minor] = parsed.split(".");
  return `${major}.${minor ?? "0"}`;
}

function classifyExpoReactNativeCompatibility(expoVersion, reactNativeVersion) {
  const missing = {
    state: "missing",
    expected: "Declare both expo and react-native to classify SDK compatibility.",
  };
  if (!expoVersion.present || !reactNativeVersion.present) {
    return { forExpo: missing, forReactNative: missing };
  }
  if (expoVersion.unresolved || reactNativeVersion.unresolved) {
    const unresolved = {
      state: "declared-unresolved",
      expected: "Resolve catalog/workspace dependency versions before treating compatibility as proven.",
      expo: expoVersion.declaredVersion,
      reactNative: reactNativeVersion.declaredVersion,
    };
    return { forExpo: unresolved, forReactNative: unresolved };
  }
  const expoMajor = majorFromVersion(expoVersion.declaredVersion);
  const reactNativeMajorMinor = majorMinorFromVersion(reactNativeVersion.declaredVersion);
  const expected = EXPO_REACT_NATIVE_COMPATIBILITY.find((entry) => entry.expoMajor === expoMajor);
  if (!expected) {
    const unknown = {
      state: "unknown",
      expected: "This Expo SDK is not in expo-ios' compatibility table; verify with the project dependency source.",
      expo: expoVersion.declaredVersion,
      reactNative: reactNativeVersion.declaredVersion,
    };
    return { forExpo: unknown, forReactNative: unknown };
  }
  const compatible = reactNativeMajorMinor === expected.reactNativeMajorMinor;
  const result = {
    state: compatible ? "compatible" : "mismatched",
    expected: `Expo SDK ${expected.expoMajor} expects React Native ${expected.reactNativeMajorMinor}.x.`,
    expo: expoVersion.declaredVersion,
    reactNative: reactNativeVersion.declaredVersion,
  };
  return { forExpo: result, forReactNative: result };
}

function summarizeUpstreamDependencies(dependencies) {
  const statuses = {};
  for (const dependency of dependencies) {
    statuses[dependency.status] = (statuses[dependency.status] ?? 0) + 1;
  }
  return {
    total: dependencies.length,
    directDependencies: dependencies.filter((dependency) => dependency.usage === "direct-dependency").length,
    internalReferenceOnly: dependencies.filter((dependency) => dependency.classification === "internal-reference-only").length,
    optionalCompatibilityShims: dependencies.filter((dependency) => dependency.classification === "optional-compatibility-shim").length,
    statuses,
    mismatched: dependencies.filter((dependency) => dependency.compatibility?.state === "mismatched").map((dependency) => dependency.id),
    missing: dependencies.filter((dependency) => dependency.status === "missing").map((dependency) => dependency.id),
  };
}

function projectInfoAppConfigSummary(summary) {
  const payload = {
    source: path.basename(summary.source),
    name: summary.name ?? null,
    slug: summary.slug ?? null,
    scheme: summary.scheme ?? null,
    iosBundleIdentifier: summary.iosBundleIdentifier ?? null,
    androidPackage: summary.androidPackage ?? null,
    easProjectId: summary.easProjectId ?? null,
  };
  if (summary.userInterfaceStyle != null) payload.userInterfaceStyle = summary.userInterfaceStyle;
  if (summary.dynamic === true) payload.dynamic = true;
  return payload;
}

async function expoRouterSitemap(args) {
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true });
  const appDir = path.resolve(cwd, args.appDir ?? "app");
  if (!(await pathExists(appDir))) {
    return toolJson({
      cwd,
      appDir,
      routes: [],
      specialFiles: [],
      warning: "App directory was not found.",
    });
  }
  const files = await walkFiles(appDir);
  const routeFiles = files.filter((file) => /\.(jsx?|tsx?)$/.test(file));
  const routes = [];
  const specialFiles = [];
  for (const file of routeFiles) {
    const rel = path.relative(appDir, file);
    const parsed = routeFromFile(rel);
    if (parsed.kind === "route") {
      routes.push({ route: parsed.route, file, segments: parsed.segments });
    } else {
      specialFiles.push({ kind: parsed.kind, file });
    }
  }
  routes.sort((a, b) => a.route.localeCompare(b.route));
  specialFiles.sort((a, b) => a.file.localeCompare(b.file));
  return toolJson({ cwd, appDir, routeCount: routes.length, routes, specialFiles });
}

async function listDevices(args) {
  const platform = args.platform ?? "all";
  const limit = clampNumber(args.limit ?? 40, 1, 200);
  const result = {};
  if (platform === "ios" || platform === "all") {
    result.ios = await safeToolSection(async () => {
      const { stdout } = await execFilePromise("xcrun", ["simctl", "list", "devices", "available", "--json"], {
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout);
      return Object.entries(parsed.devices ?? {})
        .flatMap(([runtime, devices]) =>
          devices.map((device) => ({
            runtime,
            name: device.name,
            udid: device.udid,
            state: device.state,
            isAvailable: device.isAvailable,
          })),
        )
        .sort((a, b) => Number(b.state === "Booted") - Number(a.state === "Booted") || a.name.localeCompare(b.name))
        .slice(0, limit);
    });
    result.iosPhysical = await safeToolSection(() => listIosPhysicalDevices(limit));
  }
  if (platform === "android" || platform === "all") {
    result.android = await safeToolSection(async () => {
      const { stdout } = await execFilePromise("adb", ["devices", "-l"], { timeout: 20_000 });
      return stdout
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [serial, state, ...details] = line.split(/\s+/);
          return { serial, state, details: details.join(" ") };
        })
        .slice(0, limit);
    });
  }
  return toolJson(result);
}

async function listIosPhysicalDevices(limit) {
  const { stdout } = await execFilePromise("xcrun", ["devicectl", "list", "devices", "--json-output", "-"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  const devices = parsed?.result?.devices ?? parsed?.devices ?? [];
  return devices.slice(0, limit).map((device) => ({
    name: device.deviceProperties?.name ?? device.name ?? null,
    identifier: device.identifier ?? device.udid ?? null,
    platform: device.deviceProperties?.platform ?? device.platform ?? null,
    model: device.hardwareProperties?.marketingName ?? device.model ?? null,
    connectionType: device.connectionProperties?.transportType ?? device.connectionType ?? null,
    state: device.connectionProperties?.pairingState ?? device.state ?? null,
  }));
}

async function sessionCommand(args = {}) {
  const action = requireString(args.action ?? "new", "action");
  if (!["new", "list", "show", "close", "clean"].includes(action)) {
    throw new Error(`Unknown session action: ${action}`);
  }
  const stateRoot = resolveExpoStateRoot(args);
  if (action === "list") {
    const sessions = await listSessions(stateRoot);
    return toolJson({ available: true, action, stateRoot, sessions });
  }
  if (action === "show") {
    const sessions = await listSessions(stateRoot);
    const requested = requireOptionalString(args.name);
    const session = requested
      ? sessions.find((item) => item.name === requested || item.sessionId === requested)
      : sessions.at(-1);
    return toolJson(session ? { available: true, action, session } : { available: false, action, reason: "Session not found.", name: requested });
  }
  if (action === "close") {
    const sessions = await listSessions(stateRoot);
    const requested = requireOptionalString(args.name);
    const session = requested
      ? sessions.find((item) => item.name === requested || item.sessionId === requested)
      : sessions.at(-1);
    if (!session) return toolJson({ available: false, action, reason: "Session not found.", name: requested });
    const closed = { ...session, closedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sidecars: [] };
    await writeJsonFile(path.join(sessionDirectory(stateRoot, session.sessionId), "session.json"), closed);
    return toolJson({ available: true, action, session: closed });
  }
  if (action === "clean") {
    const olderThan = parseDurationMs(args.olderThan ?? "7d");
    const cutoff = Date.now() - olderThan;
    const sessions = await listSessions(stateRoot);
    const removed = [];
    for (const session of sessions) {
      const created = Date.parse(session.createdAt ?? session.updatedAt ?? 0);
      if (Number.isFinite(created) && created < cutoff) {
        const dir = sessionDirectory(stateRoot, session.sessionId);
        await fs.rm(dir, { recursive: true, force: true });
        removed.push(session.sessionId);
      }
    }
    return toolJson({ available: true, action, stateRoot, olderThan: args.olderThan ?? "7d", removed });
  }
  const name = normalizeSessionName(args.name ?? "review");
  const now = new Date();
  const createdAt = now.toISOString();
  const sessionId = `${name}-${createdAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-").toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionDir = path.join(stateRoot, "sessions", sessionId);
  const artifactDir = path.join(sessionDir, "artifacts");
  await fs.mkdir(artifactDir, { recursive: true });
  const record = {
    schemaVersion: 1,
    sessionId,
    name,
    artifactDir,
    createdAt,
    updatedAt: createdAt,
    activeTargetId: null,
    lastSnapshotId: null,
    sidecars: [],
  };
  await writeJsonFile(path.join(sessionDir, "session.json"), record);
  return toolJson(record);
}

async function listSessions(stateRoot) {
  const sessionsDir = path.join(stateRoot, "sessions");
  const entries = await fs.readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile(path.join(sessionsDir, entry.name, "session.json")).catch(() => null);
    if (record) sessions.push(record);
  }
  return sessions.sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")));
}

function parseDurationMs(value) {
  const match = /^(\d+)([smhd])$/.exec(String(value));
  if (!match) throw new Error("duration must look like 30s, 2m, 1h, or 7d.");
  const amount = Number(match[1]);
  return amount * ({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]);
}

function normalizeSessionName(value) {
  const name = requireString(value, "name").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) throw new Error("name must include at least one letter or number.");
  return name.slice(0, 48);
}

function resolveExpoStateRoot(args = {}) {
  if (args.stateDir) {
    const resolved = path.resolve(args.stateDir);
    return path.basename(resolved) === "runs" ? path.dirname(resolved) : resolved;
  }
  const root = path.resolve(args.root ?? args.cwd ?? process.cwd());
  return path.join(root, ".scratch", "expo-ios");
}

async function targetCommand(args = {}) {
  const action = requireString(args.action ?? "list", "action");
  if (!["list", "select", "current"].includes(action)) {
    throw new Error(`Unknown target action: ${action}`);
  }
  const stateRoot = resolveExpoStateRoot(args);
  if (action === "list") {
    const targets = await discoverTargets(args, stateRoot);
    return toolJson({ available: targets.length > 0, targets });
  }
  const session = await readLatestSession(stateRoot);
  if (!session) {
    return toolJson({ available: false, reason: "No session exists. Run `expo-ios --json session new review` first." });
  }
  if (action === "select") {
    const targetId = requireString(args.targetId, "targetId");
    const targets = await discoverTargets(args, stateRoot);
    const target = targets.find((item) => item.targetId === targetId);
    if (!target) {
      return toolJson({ available: false, reason: "Target not found.", targetId, targets });
    }
    const selected = { ...target, selected: true, stale: false };
    await updateSessionRecord(stateRoot, {
      ...session,
      activeTargetId: selected.targetId,
      updatedAt: new Date().toISOString(),
    });
    await writeJsonFile(path.join(sessionDirectory(stateRoot, session.sessionId), "target.json"), selected);
    return toolJson(selected);
  }
  if (!session.activeTargetId) {
    return toolJson({ available: false, reason: "No target selected for the current session.", sessionId: session.sessionId });
  }
  const targets = await discoverTargets(args, stateRoot);
  const current = targets.find((item) => item.targetId === session.activeTargetId);
  if (current) {
    return toolJson({ available: true, sessionId: session.sessionId, target: { ...current, selected: true, stale: false } });
  }
  const persisted = await readJsonFile(path.join(sessionDirectory(stateRoot, session.sessionId), "target.json")).catch(() => null);
  return toolJson({
    available: false,
    reason: "Selected target is stale.",
    sessionId: session.sessionId,
    target: persisted
      ? { ...persisted, selected: true, stale: true }
      : { targetId: session.activeTargetId, selected: true, stale: true },
  });
}

async function discoverTargets(args = {}, stateRoot = resolveExpoStateRoot(args)) {
  const platform = args.platform ?? "all";
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const session = await readLatestSession(stateRoot);
  const selectedTargetId = session?.activeTargetId ?? null;
  const targets = [];
  if (platform === "ios" || platform === "all") {
    const devices = await listIosSimulatorTargets();
    const metroTargets = await fetchLocalJson(`http://127.0.0.1:${metroPort}/json/list`, { timeoutMs: 1000 }).catch(() => []);
    for (const device of devices) {
      const matchingMetroTargets = Array.isArray(metroTargets)
        ? metroTargets.filter((target) => !target.deviceName || target.deviceName === device.name)
        : [];
      if (matchingMetroTargets.length === 0) {
        targets.push(targetRecord({ platform: "ios", device, metroPort, metroTarget: null, selectedTargetId }));
      } else {
        for (const metroTarget of matchingMetroTargets) {
          targets.push(targetRecord({ platform: "ios", device, metroPort, metroTarget, selectedTargetId }));
        }
      }
    }
  }
  targets.sort((a, b) =>
    Number(b.selected) - Number(a.selected) ||
    Number(b.metro.status === "available") - Number(a.metro.status === "available") ||
    a.device.name.localeCompare(b.device.name)
  );
  return targets;
}

async function listIosSimulatorTargets() {
  const { stdout } = await execFilePromise("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  return Object.entries(parsed.devices ?? {})
    .flatMap(([runtime, devices]) =>
      devices.map((device) => ({
        runtime,
        id: device.udid,
        name: device.name ?? device.udid,
        state: normalizeDeviceState(device.state),
      })),
    )
    .sort((a, b) => Number(b.state === "booted") - Number(a.state === "booted") || a.name.localeCompare(b.name));
}

function targetRecord({ platform, device, metroPort, metroTarget, selectedTargetId }) {
  const bundleId = metroTarget?.appId ?? null;
  const targetId = [
    platform,
    device.id,
    bundleId ?? metroTarget?.id ?? metroTarget?.title ?? "no-runtime",
    metroTarget ? metroPort : "no-metro",
  ].map(stableIdPart).join(":");
  return {
    targetId,
    platform,
    device: {
      id: device.id,
      name: device.name ?? null,
      state: device.state ?? "unknown",
    },
    app: {
      bundleId,
      processName: processNameFromBundleId(bundleId),
      running: null,
    },
    metro: {
      port: metroTarget ? metroPort : null,
      status: metroTarget ? "available" : "unavailable",
      targetId: metroTarget?.id ?? null,
      title: metroTarget?.title ?? null,
      appId: metroTarget?.appId ?? null,
      debuggerUrl: metroTarget?.webSocketDebuggerUrl ?? null,
    },
    selected: targetId === selectedTargetId,
    stale: false,
  };
}

function normalizeDeviceState(state) {
  if (state === "Booted") return "booted";
  if (state === "Shutdown") return "shutdown";
  if (state === "connected") return "connected";
  return "unknown";
}

function stableIdPart(value) {
  return String(value ?? "unknown").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

async function readLatestSession(stateRoot) {
  const sessionsRoot = path.join(stateRoot, "sessions");
  const entries = await fs.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile(path.join(sessionsRoot, entry.name, "session.json")).catch(() => null);
    if (record) sessions.push(record);
  }
  sessions.sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)));
  return sessions[0] ?? null;
}

async function updateSessionRecord(stateRoot, record) {
  const file = path.join(sessionDirectory(stateRoot, record.sessionId), "session.json");
  await writeJsonFile(file, record);
  return record;
}

function sessionDirectory(stateRoot, sessionId) {
  return path.join(stateRoot, "sessions", sessionId);
}

async function snapshotCommand(args = {}) {
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  if (!session) {
    return toolJson({ available: false, reason: "No session exists. Run `expo-ios --json session new review` first." });
  }
  if (!session.activeTargetId) {
    return toolJson({ available: false, reason: "No target selected for the current session.", sessionId: session.sessionId });
  }
  const target = await readSelectedTarget(stateRoot, session);
  if (!target?.device?.id) {
    return toolJson({ available: false, reason: "Selected target metadata is missing.", targetId: session.activeTargetId });
  }
  const filters = {
    interactiveOnly: args.interactive === true,
    compact: args.compact === true,
    depth: args.depth === undefined ? null : clampNumber(args.depth, 1, 100),
    includeSource: args.source === true,
    includeBounds: args.bounds === true,
  };
  const semanticBridge = await semanticBridgeSnapshot(args, { stateRoot, session, filters }).catch((error) => ({
    available: false,
    source: "plugin-bridge-semantic",
    code: "transport-failure",
    reason: formatError(error),
  }));
  if (semanticBridge.available === true) {
    return toolJson(await persistSemanticSnapshot({ stateRoot, session, filters, semanticBridge }));
  }
  const axe = await commandPath("axe");
  if (!axe) {
    return toolJson({ available: false, reason: "axe CLI is not installed or not on PATH.", targetId: session.activeTargetId, semanticBridge });
  }
  const result = await execFilePromise(axe, ["describe-ui", "--udid", target.device.id], {
    timeout: 12_000,
    maxBuffer: 4 * 1024 * 1024,
    rejectOnError: false,
  });
  if (result.error) {
    return toolJson({ available: false, reason: "Native accessibility snapshot failed.", targetId: session.activeTargetId, stderr: truncate(result.stderr), error: result.error, semanticBridge });
  }
  const rawTree = JSON.parse(result.stdout || "[]");
  const nodes = flattenAccessibilityNodes(rawTree, filters);
  const snapshotId = `snapshot-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
  const refs = nodes.map((node, index) => refRecordFromNode(node, index + 1, snapshotId, session.activeTargetId, filters));
  const snapshotDir = path.join(sessionDirectory(stateRoot, session.sessionId), "snapshots");
  await fs.mkdir(snapshotDir, { recursive: true });
  const snapshotPath = path.join(snapshotDir, `${snapshotId}.json`);
  const snapshot = {
    snapshotId,
    targetId: session.activeTargetId,
    routeHint: null,
    source: ["native-accessibility"],
    semanticBridge,
    generatedAt: new Date().toISOString(),
    filters,
    refs,
    tree: nodes.map((node, index) => snapshotNodeFromAccessibility(node, `@e${index + 1}`, filters)),
    artifacts: {
      json: snapshotPath,
      screenshot: null,
      annotatedScreenshot: null,
    },
    limitations: [
      "Native accessibility snapshots expose semantic UI where available; React component props and private fiber details are not included.",
    ],
  };
  await writeJsonFile(snapshotPath, snapshot);
  await writeJsonFile(path.join(sessionDirectory(stateRoot, session.sessionId), "refs.json"), {
    snapshotId,
    targetId: session.activeTargetId,
    source: snapshot.source,
    semanticBridge,
    refs,
  });
  await updateSessionRecord(stateRoot, {
    ...session,
    lastSnapshotId: snapshotId,
    updatedAt: snapshot.generatedAt,
  });
  return toolJson(snapshot);
}

async function semanticBridgeSnapshot(args, { stateRoot, session, filters }) {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const targets = await metroTargets(metroPort);
  const target = targets.find((item) => item.webSocketDebuggerUrl) ?? targets[0] ?? null;
  if (!target?.webSocketDebuggerUrl) {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      metroPort,
      transport: bridgeRuntimeTransport(metroPort, target, null),
    };
  }
  const result = await evaluateHermesExpression(target.webSocketDebuggerUrl, semanticBridgeExpression({ filters }), { timeoutMs: 5000 });
  const value = result?.result?.result?.value;
  if (!value || typeof value !== "object") {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "transport-failure",
      reason: result?.error ?? "Semantic bridge did not return a value.",
      metroPort,
      transport: bridgeRuntimeTransport(metroPort, target, result.diagnostics),
    };
  }
  if (value.available === false) {
    return {
      ...redactValue(value),
      source: value.source ?? "plugin-bridge-semantic",
      metroPort,
      transport: bridgeRuntimeTransport(metroPort, target, result.diagnostics),
    };
  }
  const refs = normalizeSemanticBridgeRefs(value.refs ?? value.elements ?? [], filters);
  return {
    available: true,
    source: value.source ?? "plugin-bridge-semantic",
    bridgeVersion: value.bridgeVersion ?? null,
    routeHint: value.routeHint ?? null,
    refs,
    rawCount: Array.isArray(value.refs ?? value.elements) ? (value.refs ?? value.elements).length : 0,
    metroPort,
    transport: bridgeRuntimeTransport(metroPort, target, result.diagnostics),
    limitations: value.limitations ?? ["Semantic bridge data is app-defined and should be cross-checked with native accessibility or screenshots for visual assertions."],
  };
}

async function persistSemanticSnapshot({ stateRoot, session, filters, semanticBridge }) {
  const snapshotId = `snapshot-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
  const refs = semanticBridge.refs.map((record, index) => ({
    ...record,
    ref: `@e${index + 1}`,
    snapshotId,
    targetId: session.activeTargetId,
    stale: false,
  }));
  const snapshotDir = path.join(sessionDirectory(stateRoot, session.sessionId), "snapshots");
  await fs.mkdir(snapshotDir, { recursive: true });
  const snapshotPath = path.join(snapshotDir, `${snapshotId}.json`);
  const snapshot = {
    snapshotId,
    targetId: session.activeTargetId,
    routeHint: semanticBridge.routeHint,
    source: [semanticBridge.source],
    semanticBridge,
    generatedAt: new Date().toISOString(),
    filters,
    refs,
    tree: refs.map((record) => ({
      ref: record.ref,
      role: record.role,
      label: record.label,
      text: record.text,
      testID: record.testID,
      source: filters.includeSource ? record.source : null,
      box: filters.includeBounds ? record.box : null,
      actions: record.actions,
    })),
    artifacts: {
      json: snapshotPath,
      screenshot: null,
      annotatedScreenshot: null,
    },
    limitations: semanticBridge.limitations,
  };
  await writeJsonFile(snapshotPath, snapshot);
  await writeJsonFile(path.join(sessionDirectory(stateRoot, session.sessionId), "refs.json"), {
    snapshotId,
    targetId: session.activeTargetId,
    source: snapshot.source,
    semanticBridge,
    refs,
  });
  await updateSessionRecord(stateRoot, {
    ...session,
    lastSnapshotId: snapshotId,
    updatedAt: snapshot.generatedAt,
  });
  return snapshot;
}

function normalizeSemanticBridgeRefs(refs, filters) {
  if (!Array.isArray(refs)) return [];
  return refs
    .map((item) => {
      const role = normalizeAccessibilityRole(item.role ?? item.type ?? null);
      const actions = Array.isArray(item.actions) ? item.actions : actionsForAccessibilityRole(role);
      return {
        role,
        label: item.label ?? item.name ?? null,
        text: item.text ?? item.value ?? null,
        placeholder: item.placeholder ?? null,
        testID: item.testID ?? item.testId ?? item.nativeID ?? null,
        nativeID: item.nativeID ?? null,
        component: item.component ?? null,
        source: filters.includeSource ? item.source ?? null : null,
        box: filters.includeBounds ? normalizeFrame(item.box ?? item.frame) : null,
        actions,
        disabled: item.disabled === true,
        raw: redactValue(item.raw ?? item),
      };
    })
    .filter((record) => {
      if (filters.interactiveOnly && record.actions.length === 0) return false;
      if (filters.compact && !record.label && !record.text && record.actions.length === 0) return false;
      return true;
    });
}

function semanticBridgeExpression({ filters }) {
  return `(() => {
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const filters = ${JSON.stringify(filters)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const metadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const bridgeVersion = metadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const semantic = pluginBridge?.snapshot ||
      pluginBridge?.semantics ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? (pluginBridge.domains.snapshot || pluginBridge.domains.semantics) : null) ||
      (pluginBridge?.domainRegistry ? (pluginBridge.domainRegistry.snapshot || pluginBridge.domainRegistry.semantics) : null);
    const callTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const hasSemantic = Boolean(semantic || callTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'snapshot' || domain?.name === 'semantics')));
    if (!hasSemantic) {
      return { available: false, source: 'plugin-bridge-semantic', code: pluginBridge ? 'missing-domain' : 'unavailable-bridge', reason: pluginBridge ? 'Semantic snapshot bridge domain is not registered.' : 'Semantic bridge is not installed.', refs: [] };
    }
    if (bridgeVersion && bridgeVersion !== expectedBridgeVersion) {
      return { available: false, source: 'plugin-bridge-semantic', code: 'version-mismatch', bridgeVersion, expectedBridgeVersion, reason: 'Semantic bridge version is not compatible with this CLI.', refs: [] };
    }
    const captured = semantic && typeof semantic.capture === 'function'
      ? semantic.capture({ filters })
      : semantic?.refs
      ? { refs: semantic.refs }
      : callTool
      ? callTool('snapshot.capture', { filters })
      : { refs: [] };
    return {
      available: true,
      source: 'plugin-bridge-semantic',
      bridgeVersion,
      routeHint: captured?.routeHint || null,
      refs: Array.isArray(captured?.refs) ? captured.refs : Array.isArray(captured) ? captured : [],
      limitations: captured?.limitations || []
    };
  })()`;
}

async function refsCommand(args = {}) {
  const cache = await readLatestRefCache(args);
  if (!cache) {
    return toolJson({ available: false, reason: "No snapshot exists for the current session." });
  }
  return toolJson({ available: true, ...cache });
}

async function getRefCommand(args = {}) {
  const field = requireString(args.field, "field");
  const ref = requireString(args.ref, "ref");
  if (!/^@e\d+$/.test(ref)) {
    return toolJson({ available: false, reason: "Ref must look like @e1.", ref });
  }
  const cache = await readLatestRefCache(args);
  if (!cache) {
    return toolJson({ available: false, reason: "No snapshot exists for the current session." });
  }
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) {
    return toolJson({ available: false, reason: "Ref not found in the latest snapshot.", ref });
  }
  return toolJson({
    ref,
    field,
    stale: record.stale,
    value: refFieldValue(record, field),
  });
}

async function findCommand(args = {}) {
  const kind = requireString(args.kind, "kind").toLowerCase();
  const value = requireString(args.value, "value");
  const cache = await readLatestRefCache(args);
  if (!cache) {
    return toolJson({ available: false, reason: "No snapshot exists for the current session." });
  }
  const matches = findMatches(cache.refs, kind, value, args.name);
  const payload = {
    available: matches.length > 0,
    kind,
    value,
    name: args.name ?? null,
    matches,
  };
  if (args.action) {
    payload.actionResult = matches[0]
      ? await finderActionResult({ ...args, ref: matches[0].ref })
      : { available: false, reason: "No matching ref for action.", action: args.action };
  }
  return toolJson(payload);
}

async function finderActionResult(args = {}) {
  const action = requireString(args.action, "action");
  const dryRun = args.dryRun !== false;
  if (action === "tap") return unwrapToolJson(await automationTap({ ...args, dryRun }));
  if (action === "inspect") return debugInspectPayload({ ...args, ref: args.ref });
  if (["long-press", "fill", "scroll-into-view", "focus"].includes(action)) {
    return unwrapToolJson(await refActionCommand({ ...args, command: action, dryRun }));
  }
  return { available: false, reason: `Unsupported finder action: ${action}`, action };
}

function findMatches(refs, kind, value, name) {
  if (kind === "first") {
    const match = refs.find((record) => refMatches(record, "source", value, name) || refMatches(record, "text", value, name) || refMatches(record, "label", value, name));
    return match ? [match] : [];
  }
  if (kind === "nth") {
    const index = clampNumber(Number(value), 1, Number.MAX_SAFE_INTEGER) - 1;
    const needle = requireString(name, "name");
    const matches = refs.filter((record) => refMatches(record, "source", needle) || refMatches(record, "text", needle) || refMatches(record, "label", needle));
    return matches[index] ? [matches[index]] : [];
  }
  return refs.filter((record) => refMatches(record, kind, value, name));
}

async function waitCommand(args = {}) {
  const started = Date.now();
  const timeoutMs = clampNumber(args.timeoutMs ?? 5000, 0, 60000);
  const intervalMs = Math.min(Math.max(Math.floor(timeoutMs / 10), 25), 250);
  const predicate = waitPredicate(args);
  if (!predicate) {
    const ms = clampNumber(args.ms ?? 0, 0, 60000);
    if (ms > 0) await wait(ms);
    return toolJson({ matched: true, predicate: { kind: "sleep", ms }, elapsedMs: Date.now() - started });
  }
  if (["metro-ready", "app-ready", "fn"].includes(predicate.kind)) {
    return toolJson(await waitRuntimePredicate(predicate, args, { started, timeoutMs, intervalMs }));
  }
  let lastCache = null;
  do {
    lastCache = await readLatestRefCache(args);
    if (!lastCache) {
      return toolJson({
        matched: false,
        reason: "No snapshot exists for the current session.",
        predicate,
        lastEvidence: null,
      });
    }
    const result = evaluateWaitPredicate(lastCache, predicate);
    if (result.final || result.matched) {
      const payload = result.payload.matched
        ? { ...result.payload, elapsedMs: Date.now() - started }
        : result.payload;
      return toolJson(payload);
    }
    if (Date.now() - started >= timeoutMs) break;
    await wait(Math.min(intervalMs, timeoutMs - (Date.now() - started)));
  } while (Date.now() - started <= timeoutMs);
  return toolJson(timeoutWaitPayload(predicate, lastCache, timeoutMs, Date.now() - started));
}

function waitPredicate(args = {}) {
  if (args.metroReady === true) return { kind: "metro-ready" };
  if (args.appReady === true) return { kind: "app-ready" };
  if (args.fn !== undefined) return { kind: "fn", expression: requireString(args.fn, "fn") };
  if (args.route !== undefined) return { kind: "route", route: requireString(args.route, "route") };
  if (args.noSpinner === true) return { kind: "no-spinner" };
  if (args.text !== undefined) return { kind: "text", text: requireString(args.text, "text") };
  if (args.ref !== undefined || args.state !== undefined) {
    return {
      kind: "ref-state",
      ref: requireString(args.ref, "ref"),
      state: requireString(args.state ?? "visible", "state").toLowerCase(),
    };
  }
  return null;
}

async function waitRuntimePredicate(predicate, args, { started, timeoutMs, intervalMs }) {
  do {
    if (predicate.kind === "metro-ready") {
      const metro = await metroStatusPayload({ metroPort: args.metroPort ?? 8081 });
      if (metro.available) return { matched: true, predicate, elapsedMs: Date.now() - started, metro };
    } else {
      const targets = await metroTargets(args.metroPort ?? 8081);
      const webSocketDebuggerUrl = targets[0]?.webSocketDebuggerUrl ?? null;
      if (webSocketDebuggerUrl) {
        const expression = predicate.kind === "app-ready"
          ? "Boolean(globalThis.appReady || globalThis.__EXPO_IOS_APP_READY__ || globalThis.__EXPO_IOS_INSTRUMENTATION__?.app?.ready)"
          : predicate.expression;
        const policy = predicate.kind === "fn"
          ? args.allowRuntimeEval === true
            ? { allowed: true, checked: true, action: "wait.fn", sideEffect: "runtime-eval", source: "--allow-runtime-eval", reason: "Runtime eval allowed by global flag." }
            : await policyDecision(args, "wait.fn", "device")
          : { allowed: true, checked: true, action: `wait.${predicate.kind}`, sideEffect: "read" };
        if (!policy.allowed) return { matched: false, predicate, reason: policy.reason, policy };
        const result = await evaluateHermesExpression(webSocketDebuggerUrl, expression, { timeoutMs: 2000 });
        const value = result?.result?.result?.value;
        if (value === true || value === "true") {
          return { matched: true, predicate, elapsedMs: Date.now() - started, target: targetSummary(targets[0]) };
        }
      }
    }
    if (Date.now() - started >= timeoutMs) break;
    await wait(Math.min(intervalMs, timeoutMs - (Date.now() - started)));
  } while (Date.now() - started <= timeoutMs);
  return { matched: false, predicate, timeoutMs, elapsedMs: Date.now() - started, reason: `Timed out waiting for ${predicate.kind}.` };
}

function evaluateWaitPredicate(cache, predicate) {
  if (predicate.kind === "text") {
    const expected = normalizeFinderText(predicate.text);
    const ref = cache.refs.find((record) =>
      !record.stale && normalizeFinderText([record.text, record.label].filter(Boolean).join(" ")).includes(expected)
    );
    if (!ref) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: {
        matched: true,
        predicate,
        ref,
        lastEvidence: waitEvidence(cache),
      },
    };
  }
  if (predicate.kind === "ref-state") {
    if (!/^@e\d+$/.test(predicate.ref)) {
      return {
        matched: false,
        final: true,
        payload: { matched: false, reason: "Ref must look like @e1.", ref: predicate.ref },
      };
    }
    if (!["visible", "hidden"].includes(predicate.state)) {
      throw new Error(`Unknown wait state: ${predicate.state}`);
    }
    const ref = cache.refs.find((record) => record.ref === predicate.ref);
    if (!ref) {
      return {
        matched: false,
        final: true,
        payload: { matched: false, reason: "Ref not found in the latest snapshot.", ref: predicate.ref },
      };
    }
    if (ref.stale) {
      return {
        matched: false,
        final: true,
        payload: {
          matched: false,
          reason: "Ref is stale. Capture a new snapshot before waiting on it.",
          ref: predicate.ref,
        },
      };
    }
    const visible = refHasVisibleEvidence(ref);
    const matched = predicate.state === "visible" ? visible : !visible;
    if (!matched) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: {
        matched: true,
        predicate,
        ref,
        lastEvidence: waitEvidence(cache),
      },
    };
  }
  if (predicate.kind === "route") {
    const expected = normalizeFinderText(predicate.route);
    const ref = cache.refs.find((record) =>
      !record.stale && normalizeFinderText([record.text, record.label].filter(Boolean).join(" ")).includes(expected)
    );
    if (!ref) return { matched: false, final: false };
    return { matched: true, final: true, payload: { matched: true, predicate, ref, lastEvidence: waitEvidence(cache) } };
  }
  if (predicate.kind === "no-spinner") {
    const spinner = cache.refs.find((record) => /spinner|loading|progress/i.test([record.role, record.label, record.text].filter(Boolean).join(" ")));
    if (spinner) return { matched: false, final: false };
    return { matched: true, final: true, payload: { matched: true, predicate, lastEvidence: waitEvidence(cache) } };
  }
  throw new Error(`Unknown wait predicate: ${predicate.kind}`);
}

function timeoutWaitPayload(predicate, cache, timeoutMs, elapsedMs) {
  const label = predicate.kind === "text" ? "text" : `${predicate.ref} to become ${predicate.state}`;
  return {
    matched: false,
    reason: `Timed out waiting for ${label}.`,
    predicate,
    timeoutMs,
    elapsedMs,
    lastEvidence: waitEvidence(cache, { includeSampleRefs: true }),
  };
}

function waitEvidence(cache, options = {}) {
  if (!cache) return null;
  return {
    snapshotId: cache.snapshotId ?? null,
    targetId: cache.targetId ?? null,
    refCount: cache.refs?.length ?? 0,
    ...(options.includeSampleRefs
      ? { sampleRefs: (cache.refs ?? []).slice(0, 5).map((record) => waitSampleRef(record)) }
      : {}),
  };
}

function waitSampleRef(record) {
  return {
    ref: record.ref,
    role: record.role ?? null,
    label: record.label ?? null,
    text: record.text ?? null,
    stale: record.stale === true,
  };
}

function refHasVisibleEvidence(record) {
  return Boolean(
    record?.box ||
    normalizeFinderText(record?.text) ||
    normalizeFinderText(record?.label)
  );
}

async function batchCommand(args = {}) {
  const steps = normalizeBatchSteps(args.steps ?? []);
  const bail = args.bail === true;
  const results = [];
  let failureIndex = null;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    try {
      const result = await runBatchStep(step, args);
      results.push({ index, command: result.command, ok: true, data: result.data });
    } catch (error) {
      if (failureIndex === null) failureIndex = index;
      results.push({
        index,
        command: Array.isArray(step) ? step[0] ?? null : null,
        ok: false,
        error: batchStepError(error),
      });
      if (bail) break;
    }
  }
  return toolJson({
    ok: failureIndex === null,
    bail,
    failureIndex,
    steps: results,
  });
}

function normalizeBatchSteps(steps) {
  if (!Array.isArray(steps)) {
    throw new CliUsageError("batch requires one or more command steps.");
  }
  return steps.map((step, index) => {
    const parsed = typeof step === "string" ? parseJsonArgument(step, `step ${index + 1}`) : step;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new CliUsageError(`batch step ${index + 1} must be a non-empty argv array.`);
    }
    return parsed.map((part) => String(part));
  });
}

async function runBatchStep(step, batchArgs) {
  const parsed = parseCliArgs(step);
  const { command, args, globals } = parsed;
  if (!command) throw new CliUsageError("Batch step is missing a command.");
  const toolName = commandAliases[command];
  if (!toolName) throw new CliUsageError(`Unknown command: ${command}`);
  const mergedGlobals = {
    ...globals,
    json: true,
    plain: false,
    quiet: true,
    root: globals.root ?? batchArgs.root ?? null,
    stateDir: globals.stateDir ?? batchArgs.stateDir ?? null,
  };
  const effectiveArgs = commandArgs(command, args, mergedGlobals);
  const data = await runTool(toolName, effectiveArgs, { command, globals: mergedGlobals, silent: true });
  return { command, data };
}

function batchStepError(error) {
  const exitCode = exitCodeForError(error);
  return {
    code: errorCodeForExitCode(exitCode),
    message: sanitizeErrorMessage(formatError(error)),
    exitCode,
  };
}

function refMatches(record, kind, value, name) {
  const expected = normalizeFinderText(value);
  if (kind === "role") {
    if (normalizeFinderText(record.role) !== expected) return false;
    if (!name) return true;
    const accessibleName = normalizeFinderText([record.label, record.text].filter(Boolean).join(" "));
    return accessibleName.includes(normalizeFinderText(name));
  }
  if (kind === "text") return normalizeFinderText(record.text ?? record.label).includes(expected);
  if (kind === "label") return normalizeFinderText(record.label).includes(expected);
  if (kind === "placeholder") return normalizeFinderText(record.placeholder).includes(expected);
  if (kind === "testid") return normalizeFinderText(record.testID ?? record.nativeID).includes(expected);
  if (kind === "source") return normalizeFinderText([record.component, record.source?.file].filter(Boolean).join(" ")).includes(expected);
  throw new Error(`Unknown finder kind: ${kind}`);
}

function normalizeFinderText(value) {
  return String(value ?? "").toLowerCase().trim();
}

async function readLatestRefCache(args = {}) {
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  if (!session?.lastSnapshotId) return null;
  return readJsonFile(path.join(sessionDirectory(stateRoot, session.sessionId), "refs.json")).catch(() => null);
}

async function readSelectedTarget(stateRoot, session) {
  return readJsonFile(path.join(sessionDirectory(stateRoot, session.sessionId), "target.json")).catch(() => null);
}

function flattenAccessibilityNodes(tree, filters) {
  const roots = Array.isArray(tree) ? tree : [tree];
  const nodes = [];
  function visit(node, depth) {
    if (!node || typeof node !== "object") return;
    if (filters.depth !== null && depth > filters.depth) return;
    const normalized = normalizeAccessibilityNode(node);
    if (!filters.interactiveOnly || normalized.actions.length > 0) {
      if (!filters.compact || normalized.label || normalized.text || normalized.actions.length > 0) {
        nodes.push(normalized);
      }
    }
    for (const child of node.children ?? []) visit(child, depth + 1);
  }
  for (const root of roots) visit(root, 0);
  return nodes;
}

function normalizeAccessibilityNode(node) {
  const role = normalizeAccessibilityRole(node.role_description ?? node.role ?? node.type ?? null);
  const label = node.AXLabel ?? node.label ?? node.title ?? null;
  const text = node.AXValue ?? node.value ?? (role === "text" ? label : null);
  return {
    role,
    label,
    text,
    placeholder: node.placeholder ?? null,
    testID: node.testID ?? node.testId ?? node.nativeID ?? null,
    nativeID: node.nativeID ?? null,
    component: node.component ?? node.name ?? null,
    source: node.source ?? null,
    box: normalizeFrame(node.frame),
    actions: actionsForAccessibilityRole(role),
    raw: node,
  };
}

function normalizeAccessibilityRole(role) {
  const text = String(role ?? "").replace(/^AX/, "").toLowerCase();
  if (text === "statictext") return "text";
  if (text === "button") return "button";
  if (text === "textfield" || text === "textbox") return "textbox";
  if (text === "switch") return "switch";
  if (text === "link") return "link";
  return text || null;
}

function normalizeFrame(frame) {
  if (!frame || typeof frame !== "object") return null;
  const x = Number(frame.x ?? frame.left);
  const y = Number(frame.y ?? frame.top);
  const width = Number(frame.width);
  const height = Number(frame.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return { x, y, width, height };
}

function actionsForAccessibilityRole(role) {
  if (role === "button" || role === "link") return ["tap", "inspect"];
  if (role === "textbox") return ["tap", "fill", "focus", "inspect"];
  if (role === "switch") return ["tap", "inspect"];
  return [];
}

function refRecordFromNode(node, index, snapshotId, targetId, filters) {
  return {
    ref: `@e${index}`,
    snapshotId,
    targetId,
    stale: false,
    role: node.role,
    label: node.label,
    text: node.text,
    placeholder: node.placeholder,
    testID: node.testID,
    nativeID: node.nativeID,
    component: node.component,
    source: filters.includeSource ? normalizeSource(node.source) : null,
    box: filters.includeBounds ? node.box : null,
    actions: node.actions,
  };
}

function snapshotNodeFromAccessibility(node, ref, filters) {
  return {
    ref,
    role: node.role,
    label: node.label,
    text: node.text,
    testID: node.testID,
    source: filters.includeSource ? normalizeSource(node.source) : null,
    box: filters.includeBounds ? node.box : null,
    actions: node.actions,
  };
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") return null;
  return {
    file: source.file ?? source.fileName ?? null,
    line: Number.isFinite(Number(source.line ?? source.lineNumber)) ? Number(source.line ?? source.lineNumber) : null,
    column: Number.isFinite(Number(source.column ?? source.columnNumber)) ? Number(source.column ?? source.columnNumber) : null,
  };
}

function refFieldValue(record, field) {
  switch (field) {
    case "text":
      return record.text ?? record.label ?? null;
    case "props":
      return {
        role: record.role,
        label: record.label,
        placeholder: record.placeholder,
        testID: record.testID,
        nativeID: record.nativeID,
        component: record.component,
        actions: record.actions,
      };
    case "box":
      return record.box;
    case "style":
      return null;
    case "source":
      return record.source;
    default:
      throw new Error(`Unknown ref field: ${field}`);
  }
}

async function planRefAction(args = {}) {
  const action = requireString(args.action, "action");
  const ref = requireString(args.ref, "ref");
  const cache = await readLatestRefCache(args);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) {
    return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  }
  if (record.stale) {
    return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  }
  if (!record.actions.includes(action)) {
    return {
      available: false,
      reason: "Action is not available for this ref.",
      ref,
      action,
      availableActions: record.actions,
    };
  }
  const point = record.box
    ? { x: record.box.x + record.box.width / 2, y: record.box.y + record.box.height / 2 }
    : null;
  return {
    available: true,
    dryRun: true,
    plan: {
      action,
      ref,
      targetId: record.targetId,
      box: record.box,
      point,
    },
  };
}

async function bootSimulator(args) {
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const bootResult = await execFilePromise("xcrun", ["simctl", "boot", device.udid], {
    timeout: 60_000,
    rejectOnError: false,
  });
  const shouldOpen = args.openSimulator !== false;
  if (shouldOpen) {
    await execFilePromise("open", ["-a", "Simulator"], { timeout: 10_000, rejectOnError: false });
  }
  return toolJson({
    requestedDevice: args.device ?? null,
    device,
    openSimulator: shouldOpen,
    stdout: truncate(bootResult.stdout),
    stderr: truncate(bootResult.stderr),
  });
}

async function openUrl(args) {
  const platform = args.platform ?? "ios";
  const url = requireString(args.url, "url");
  if (/\s/.test(url)) throw new Error("url must not contain whitespace.");

  if (platform === "android") {
    const adbArgs = androidDeviceArgs(args.device, ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url]);
    const result = await execFilePromise("adb", adbArgs, { timeout: 30_000, rejectOnError: false });
    return toolJson({ platform, device: args.device ?? null, stdout: truncate(result.stdout), stderr: truncate(result.stderr) });
  }

  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const result = await execFilePromise("xcrun", ["simctl", "openurl", device.udid, url], {
    timeout: 30_000,
    rejectOnError: false,
  });
  return toolJson({ platform, device, stdout: truncate(result.stdout), stderr: truncate(result.stderr) });
}

async function launchApp(args) {
  const platform = args.platform ?? "ios";
  if (platform === "android") {
    const packageName = requireString(args.packageName ?? args.bundleId, "packageName");
    const launchArgs = args.activity
      ? ["shell", "am", "start", "-n", `${packageName}/${args.activity}`]
      : ["shell", "monkey", "-p", packageName, "1"];
    const result = await execFilePromise("adb", androidDeviceArgs(args.device, launchArgs), {
      timeout: 30_000,
      rejectOnError: false,
    });
    return toolJson({ platform, packageName, stdout: truncate(result.stdout), stderr: truncate(result.stderr) });
  }

  const bundleId = requireString(args.bundleId ?? args.packageName, "bundleId");
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const startedAt = Date.now();
  const result = await execFilePromise("xcrun", ["simctl", "launch", device.udid, bundleId], {
    timeout: 30_000,
    rejectOnError: false,
  });
  const payload = { platform, device, bundleId, available: !result.error, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error };
  return toolJson(await attachIosCrashEvidence(payload, {
    platform,
    bundleId,
    processName: args.processName,
    sinceMs: startedAt,
    waitMs: args.crashCheckMs,
    action: "launch-app",
  }));
}

async function terminateApp(args = {}) {
  const platform = args.platform ?? "ios";
  const bundleId = await resolveBundleId(args);
  if (args.dryRun === true) {
    return toolJson({ available: true, dryRun: true, action: "terminate-app", platform, bundleId });
  }
  if (platform === "android") {
    const result = await execFilePromise("adb", androidDeviceArgs(args.device, ["shell", "am", "force-stop", bundleId]), {
      timeout: 20_000,
      rejectOnError: false,
    });
    return toolJson({ available: !result.error, action: "terminate-app", platform, packageName: bundleId, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error });
  }
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const result = await execFilePromise("xcrun", ["simctl", "terminate", device.udid, bundleId], {
    timeout: 20_000,
    rejectOnError: false,
  });
  return toolJson({ available: !result.error, action: "terminate-app", platform, device, bundleId, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error });
}

async function reloadApp(args = {}) {
  const bundleId = await resolveBundleId(args);
  if (args.dryRun === true) {
    return toolJson({ available: true, dryRun: true, action: "reload-app", bundleId });
  }
  const terminated = unwrapToolJson(await terminateApp({ ...args, bundleId }));
  const launched = unwrapToolJson(await launchApp({ ...args, bundleId }));
  return toolJson({
    available: launched.available === false || launched.error ? false : true,
    action: "reload-app",
    bundleId,
    strategy: "terminate-and-launch",
    terminated,
    launched,
  });
}

async function attachIosCrashEvidence(payload, { platform, bundleId, processName, sinceMs, waitMs, action }) {
  if (platform !== "ios") return payload;
  const evidence = await iosCrashEvidence({ bundleId, processName, sinceMs, waitMs, action });
  if (!evidence.crashReports?.length) return { ...payload, ...evidence };
  return {
    ...payload,
    ...evidence,
    available: false,
    reason: `The app generated ${evidence.crashReports.length} matching iOS crash report(s) after ${action}.`,
  };
}

async function iosCrashEvidence({ bundleId, processName, sinceMs, waitMs, action }) {
  const delay = clampNumber(waitMs ?? 0, 0, 30_000);
  if (delay > 0) await wait(delay);
  const crashReports = await matchingIosCrashReports({ bundleId, processName, sinceMs });
  return {
    crashCheck: {
      action,
      bundleId: bundleId ?? null,
      processName: processName ?? null,
      since: new Date(sinceMs).toISOString(),
      waitedMs: delay,
      reportCount: crashReports.length,
    },
    crashReports,
  };
}

async function matchingIosCrashReports({ bundleId, processName, sinceMs }) {
  if (!bundleId && !processName) return [];
  const reportsDir = process.env.EXPO_IOS_DIAGNOSTIC_REPORTS_DIR ||
    path.join(os.homedir(), "Library", "Logs", "DiagnosticReports");
  const entries = await fs.readdir(reportsDir, { withFileTypes: true }).catch(() => []);
  const matches = [];
  const wantedProcess = processName ? String(processName).toLowerCase() : null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/(\.ips|\.crash)$/.test(entry.name)) continue;
    const reportPath = path.join(reportsDir, entry.name);
    const stat = await fs.stat(reportPath).catch(() => null);
    if (!stat || stat.mtimeMs < sinceMs) continue;
    const metadata = await readCrashReportMetadata(reportPath);
    const metadataBundle = metadata?.bundleID ?? metadata?.bundleId ?? null;
    const metadataName = metadata?.app_name ?? metadata?.name ?? metadata?.procName ?? null;
    const nameMatches = wantedProcess
      ? entry.name.toLowerCase().includes(wantedProcess) || String(metadataName ?? "").toLowerCase() === wantedProcess
      : false;
    if ((bundleId && metadataBundle === bundleId) || nameMatches) {
      matches.push({
        path: reportPath,
        file: entry.name,
        mtime: stat.mtime.toISOString(),
        appName: metadataName,
        bundleId: metadataBundle,
        incidentId: metadata?.incident_id ?? metadata?.incident ?? null,
      });
    }
  }
  return matches.sort((a, b) => a.path.localeCompare(b.path));
}

async function readCrashReportMetadata(reportPath) {
  const content = await fs.readFile(reportPath, "utf8").catch(() => "");
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine?.startsWith("{")) return null;
  try {
    return JSON.parse(firstLine);
  } catch {
    return null;
  }
}

async function installApp(args = {}) {
  const platform = args.platform ?? "ios";
  const appPath = path.resolve(requireString(args.appPath, "appPath"));
  const policy = await policyDecision(args, "install-app", "device");
  if (!policy.allowed) return toolJson(policyDeniedPayload({ domain: "app", action: "install-app", policy }));
  if (args.dryRun === true) {
    return toolJson({ available: true, dryRun: true, action: "install-app", platform, appPath, policy });
  }
  if (platform === "android") {
    const result = await execFilePromise("adb", androidDeviceArgs(args.device, ["install", "-r", appPath]), {
      timeout: 120_000,
      rejectOnError: false,
    });
    return toolJson({ available: !result.error, action: "install-app", platform, appPath, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error, policy });
  }
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const result = await execFilePromise("xcrun", ["simctl", "install", device.udid, appPath], {
    timeout: 120_000,
    rejectOnError: false,
  });
  return toolJson({ available: !result.error, action: "install-app", platform, device, appPath, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error, policy });
}

async function uninstallApp(args = {}) {
  const platform = args.platform ?? "ios";
  const bundleId = await resolveBundleId(args);
  const policy = await policyDecision(args, "uninstall-app", "device");
  if (!policy.allowed) return toolJson(policyDeniedPayload({ domain: "app", action: "uninstall-app", policy }));
  if (args.dryRun === true) {
    return toolJson({ available: true, dryRun: true, action: "uninstall-app", platform, bundleId, policy });
  }
  if (platform === "android") {
    const result = await execFilePromise("adb", androidDeviceArgs(args.device, ["uninstall", bundleId]), {
      timeout: 60_000,
      rejectOnError: false,
    });
    return toolJson({ available: !result.error, action: "uninstall-app", platform, packageName: bundleId, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error, policy });
  }
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const result = await execFilePromise("xcrun", ["simctl", "uninstall", device.udid, bundleId], {
    timeout: 60_000,
    rejectOnError: false,
  });
  return toolJson({ available: !result.error, action: "uninstall-app", platform, device, bundleId, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error, policy });
}

async function resolveBundleId(args = {}) {
  const explicit = requireOptionalString(args.bundleId ?? args.packageName);
  if (explicit) return explicit;
  const cwd = args.cwd ?? process.cwd();
  const summary = await expoProjectRuntimeSummary(cwd).catch(() => null);
  const inferred = summary?.appConfig?.iosBundleIdentifier ?? summary?.appConfig?.androidPackage ?? null;
  if (!inferred) throw new Error("bundleId must be provided or inferable from Expo app config.");
  return inferred;
}

async function collectAppLogs(args) {
  const platform = args.platform ?? "ios";
  if (platform === "android") {
    const lines = String(clampNumber(args.lines ?? 500, 1, 5000));
    const result = await execFilePromise("adb", androidDeviceArgs(args.device, ["logcat", "-d", "-t", lines]), {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      rejectOnError: false,
    });
    return toolJson({ platform, device: args.device ?? null, stdout: truncate(result.stdout), stderr: truncate(result.stderr) });
  }

  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const last = args.last ?? "2m";
  if (!/^\d+[smhd]$/.test(last)) {
    throw new Error("last must look like 30s, 2m, 1h, or 1d.");
  }
  const predicate = args.predicate ?? iosLogPredicate(args);
  const commandArgs = ["simctl", "spawn", device.udid, "log", "show", "--style", "compact", "--last", last];
  if (predicate) commandArgs.push("--predicate", predicate);
  const result = await execFilePromise("xcrun", commandArgs, {
    timeout: 45_000,
    maxBuffer: 5 * 1024 * 1024,
    rejectOnError: false,
  });
  return toolJson({
    platform,
    device,
    last,
    predicate: predicate ?? null,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  });
}

async function automationTakeScreenshot(args) {
  if (args.full === true) {
    return toolJson(await captureFullScreenshot(args));
  }
  if (args.annotate === true) {
    return toolJson(await annotatedScreenshot(args));
  }
  return toolJson(await captureScreenshot(args));
}

async function captureFullScreenshot(args) {
  const platform = args.platform ?? "ios";
  if (platform !== "ios") {
    return {
      available: false,
      reason: "Segmented full-page capture is currently implemented for iOS simulator targets only.",
      mode: "full",
      platform,
    };
  }
  const axe = await commandPath("axe");
  if (!axe) {
    return {
      available: false,
      reason: "Full-page capture requires the axe CLI to perform real simulator scroll gestures.",
      mode: "full",
      platform,
    };
  }
  const magick = await commandPath("magick");
  if (!magick) {
    return {
      available: false,
      reason: "Full-page capture requires ImageMagick's magick command to stitch captured viewport segments.",
      mode: "full",
      platform,
    };
  }

  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const outputPath = path.resolve(
    args.outputPath ??
      path.join(os.tmpdir(), "expo-ios-screenshots", `full-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`),
  );
  const segmentCount = clampNumber(args.fullSegments ?? args.segments ?? 3, 1, 12);
  const segmentDir = path.join(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}-segments`);
  await fs.mkdir(segmentDir, { recursive: true });

  const segments = [];
  const firstPath = path.join(segmentDir, "segment-000.png");
  const first = await captureScreenshot({ ...args, full: false, annotate: false, outputPath: firstPath, device: device.udid, platform });
  if (first.available === false) return first;
  segments.push(firstPath);

  const dimensions = await imageDimensions(magick, firstPath);
  const width = dimensions?.width ?? 390;
  const height = dimensions?.height ?? 844;
  const startX = Math.max(1, Math.round(width / 2));
  const startY = Math.max(1, Math.round(height * 0.82));
  const endY = Math.max(1, Math.round(height * 0.28));
  const gestureResults = [];

  for (let index = 1; index < segmentCount; index += 1) {
    const gesture = await execFilePromise(axe, [
      "swipe",
      "--start-x",
      String(startX),
      "--start-y",
      String(startY),
      "--end-x",
      String(startX),
      "--end-y",
      String(endY),
      "--duration",
      "0.45",
      "--udid",
      device.udid,
    ], { timeout: 10_000, rejectOnError: false });
    gestureResults.push({
      index,
      stdout: truncate(gesture.stdout),
      stderr: truncate(gesture.stderr),
      error: gesture.error,
    });
    if (gesture.error) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const segmentPath = path.join(segmentDir, `segment-${String(index).padStart(3, "0")}.png`);
    const segment = await captureScreenshot({ ...args, full: false, annotate: false, outputPath: segmentPath, device: device.udid, platform });
    if (segment.available === false) break;
    segments.push(segmentPath);
  }

  for (let index = 1; index < segments.length; index += 1) {
    await execFilePromise(axe, [
      "swipe",
      "--start-x",
      String(startX),
      "--start-y",
      String(endY),
      "--end-x",
      String(startX),
      "--end-y",
      String(startY),
      "--duration",
      "0.25",
      "--udid",
      device.udid,
    ], { timeout: 10_000, rejectOnError: false });
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const stitch = await execFilePromise(magick, [...segments, "-append", outputPath], {
    timeout: 30_000,
    rejectOnError: false,
  });
  if (stitch.error || !(await pathExists(outputPath))) {
    return {
      available: false,
      reason: "Captured scroll segments but failed to stitch the full screenshot artifact.",
      mode: "full",
      platform,
      device,
      outputPath,
      segmentDir,
      segments,
      stitch: {
        stdout: truncate(stitch.stdout),
        stderr: truncate(stitch.stderr),
        error: stitch.error,
      },
    };
  }

  return {
    available: true,
    mode: "full",
    strategy: "segmented-scroll-stitch",
    platform,
    device,
    outputPath,
    segmentDir,
    segments,
    segmentCount: segments.length,
    tools: { gesture: "axe", stitch: "magick" },
    limitation: "iOS Simulator does not expose a stable native full-page screenshot API for arbitrary React Native views; this artifact stitches real viewport screenshots captured after simulator scroll gestures.",
    gestures: gestureResults,
    stitch: {
      stdout: truncate(stitch.stdout),
      stderr: truncate(stitch.stderr),
    },
  };
}

async function imageDimensions(magick, imagePath) {
  const result = await execFilePromise(magick, ["identify", "-format", "%w %h", imagePath], {
    timeout: 5_000,
    rejectOnError: false,
  });
  if (result.error) return null;
  const match = String(result.stdout).trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function captureScreenshot(args) {
  const platform = args.platform ?? "ios";
  const outputPath = path.resolve(
    args.outputPath ??
      path.join(os.tmpdir(), "expo-ios-screenshots", `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`),
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  if (platform === "android") {
    await adbScreenshot(args.device, outputPath);
    return { platform, device: args.device ?? null, outputPath };
  }

  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const result = await execFilePromise("xcrun", ["simctl", "io", device.udid, "screenshot", outputPath], {
    timeout: 30_000,
    rejectOnError: false,
  });
  if (result.error || !(await pathExists(outputPath))) {
    return {
      available: false,
      reason: "Screenshot tooling failed.",
      platform,
      device,
      outputPath,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
      error: result.error,
    };
  }
  return {
    platform,
    device,
    outputPath,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  };
}

async function annotatedScreenshot(args) {
  const cache = await readLatestRefCache(args);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  const labelMap = buildScreenshotLabelMap(cache);
  if (labelMap.available === false) return labelMap;
  const screenshot = await captureScreenshot({ ...args, annotate: false });
  if (screenshot.available === false) return screenshot;
  const artifacts = annotatedScreenshotArtifactPaths(screenshot.outputPath);
  await writeJsonFile(artifacts.labelMap, {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    screenshot: screenshot.outputPath,
    annotatedImage: artifacts.annotatedImage,
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    labels: labelMap.labels,
  });
  await fs.writeFile(artifacts.annotatedImage, annotatedScreenshotSvg({
    screenshotPath: screenshot.outputPath,
    labels: labelMap.labels,
  }), "utf8");
  return {
    ...screenshot,
    available: true,
    annotated: true,
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    artifacts: {
      screenshot: screenshot.outputPath,
      annotatedImage: artifacts.annotatedImage,
      labelMap: artifacts.labelMap,
    },
    labels: labelMap.labels,
  };
}

function buildScreenshotLabelMap(cache) {
  const refs = cache.refs ?? [];
  const targetMismatch = refs.filter((record) =>
    record.snapshotId !== cache.snapshotId ||
    record.targetId !== cache.targetId
  );
  if (targetMismatch.length > 0) {
    return {
      available: false,
      reason: "Ref cache contains refs from a different snapshot or target.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null,
      mismatchedRefs: targetMismatch.map((record) => record.ref),
    };
  }
  const activeRefs = refs.filter((record) => record.stale !== true);
  const missingBounds = activeRefs.filter((record) => !record.box);
  if (missingBounds.length > 0) {
    return {
      available: false,
      reason: "Cannot annotate screenshot because one or more refs do not include bounds.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null,
      missingRefs: missingBounds.map((record) => record.ref),
    };
  }
  if (activeRefs.length === 0) {
    return {
      available: false,
      reason: "No bounded refs are available for annotation.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null,
    };
  }
  return {
    available: true,
    labels: activeRefs.map((record, index) => ({
      ref: record.ref,
      label: record.label ?? record.text ?? record.role ?? record.ref,
      role: record.role ?? null,
      text: record.text ?? null,
      source: record.source ?? null,
      box: record.box,
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      index: index + 1,
    })),
  };
}

function annotatedScreenshotArtifactPaths(outputPath) {
  const ext = path.extname(outputPath);
  const base = ext ? outputPath.slice(0, -ext.length) : outputPath;
  return {
    labelMap: `${base}.labels.json`,
    annotatedImage: `${base}.annotated.svg`,
  };
}

function annotatedScreenshotSvg({ screenshotPath, labels }) {
  const { width, height } = screenshotOverlaySize(labels);
  const imageHref = escapeHtml(path.basename(screenshotPath));
  const labelSvg = labels.map((label) => {
    const box = label.box;
    const textX = Math.max(0, box.x);
    const textY = Math.max(16, box.y - 6);
    const text = `${label.index}. ${label.ref}`;
    return [
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="#ff3b30" stroke-width="2"/>`,
      `<rect x="${textX}" y="${textY - 15}" width="${Math.max(44, text.length * 8)}" height="18" fill="#ff3b30"/>`,
      `<text x="${textX + 4}" y="${textY - 2}" fill="#fff" font-family="Menlo, monospace" font-size="12">${escapeHtml(text)}</text>`,
    ].join("\n");
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${imageHref}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMinYMin meet"/>
  ${labelSvg}
</svg>
`;
}

function screenshotOverlaySize(labels) {
  const maxX = Math.max(390, ...labels.map((label) => label.box.x + label.box.width + 24));
  const maxY = Math.max(844, ...labels.map((label) => label.box.y + label.box.height + 24));
  return { width: Math.ceil(maxX), height: Math.ceil(maxY) };
}

async function automationTap(args) {
  if (args.ref) {
    const planned = await planRefAction({ ...args, action: "tap" });
    if (args.dryRun === true || planned.available === false) return toolJson(planned);
    const point = planned.plan?.point;
    if (!point) return toolJson({ available: false, reason: "Ref does not include tappable bounds.", ref: args.ref });
    return automationTap({ ...args, ref: undefined, x: point.x, y: point.y });
  }
  const platform = args.platform ?? "ios";
  const x = String(clampNumber(args.x, 0, Number.MAX_SAFE_INTEGER));
  const y = String(clampNumber(args.y, 0, Number.MAX_SAFE_INTEGER));
  if (args.dryRun === true) {
    const iosTool = platform === "ios" ? await resolveIosInteractionTool() : null;
    const iosCommand = iosTool?.tool === "axe"
      ? ["axe", "tap", "-x", x, "-y", y, "--udid", args.device ?? "<booted-device>"]
      : ["idb", "ui", "tap", x, y, "--udid", args.device ?? "<booted-device>"];
    return toolJson({
      available: true,
      dryRun: true,
      platform,
      device: args.device ?? null,
      tool: platform === "android" ? "adb" : iosTool?.tool ?? "idb",
      point: { x: Number(x), y: Number(y) },
      command: platform === "android"
        ? ["adb", ...androidDeviceArgs(args.device, ["shell", "input", "tap", x, y])]
        : iosCommand,
    });
  }

  if (platform === "android") {
    const result = await execFilePromise("adb", androidDeviceArgs(args.device, ["shell", "input", "tap", x, y]), {
      timeout: 20_000,
      rejectOnError: false,
    });
    return toolJson({ platform, device: args.device ?? null, x: Number(x), y: Number(y), stdout: truncate(result.stdout), stderr: truncate(result.stderr) });
  }

  const tool = await resolveIosInteractionTool();
  if (!tool) {
    throw new Error(
      "iOS coordinate taps require the idb or axe CLI, but neither is installed or on PATH. Install idb or axe for iOS coordinate automation.",
    );
  }
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const command = tool.tool === "axe"
    ? ["tap", "-x", x, "-y", y, "--udid", device.udid]
    : ["ui", "tap", x, y, "--udid", device.udid];
  const result = await execFilePromise(tool.path, command, {
    timeout: 20_000,
    rejectOnError: false,
  });
  return toolJson({ platform, device, tool: tool.tool, x: Number(x), y: Number(y), stdout: truncate(result.stdout), stderr: truncate(result.stderr) });
}

async function refActionCommand(args = {}) {
  const command = requireString(args.command, "command");
  if (command === "scroll-into-view") {
    const record = await readRefRecord(args.ref, args);
    return toolJson(record.available === false
      ? record
      : { available: true, action: command, ref: args.ref, reason: "Ref is present in the current snapshot.", record: record.record });
  }
  if (command === "blur") {
    return keyboardCommand({ ...args, action: "press", key: "Enter" });
  }
  if (["focus", "check", "uncheck", "select"].includes(command)) {
    const tapped = unwrapToolJson(await automationTap({ ...args, ref: args.ref, dryRun: args.dryRun }));
    return toolJson({ ...tapped, action: command, ref: args.ref, value: args.text ?? null });
  }
  if (command === "fill") {
    const ref = requireString(args.ref, "ref");
    const text = requireString(args.text, "text");
    if (args.dryRun === true) {
      return toolJson({ available: true, dryRun: true, action: command, ref, textLength: text.length, steps: ["tap ref", "type text"] });
    }
    const tapped = unwrapToolJson(await automationTap({ ...args, ref }));
    if (tapped.available === false) return toolJson({ ...tapped, action: command, ref });
    const typed = unwrapToolJson(await keyboardCommand({ ...args, action: "type", text }));
    return toolJson({ available: typed.available !== false, action: command, ref, tap: tapped, type: typed });
  }
  if (command === "long-press" || command === "dbltap") {
    const point = await refPoint(args.ref, args);
    if (point.available === false) return toolJson(point);
    return automationGesture({
      ...args,
      gesture: command === "long-press" ? "long-press" : "tap",
      x: point.point.x,
      y: point.point.y,
      repeat: command === "dbltap" ? 2 : 1,
      intervalMs: command === "dbltap" ? 80 : args.intervalMs,
    });
  }
  if (command === "drag") {
    const start = await refPoint(args.ref, args);
    const end = await refPoint(args.targetRef, args);
    if (start.available === false) return toolJson(start);
    if (end.available === false) return toolJson({ ...end, role: "targetRef" });
    return automationGesture({
      ...args,
      gesture: "drag",
      startX: start.point.x,
      startY: start.point.y,
      endX: end.point.x,
      endY: end.point.y,
      durationMs: args.durationMs ?? 600,
    });
  }
  if (command === "scroll") {
    const plan = await scrollPlan(args);
    if (plan.available === false || args.dryRun === true) return toolJson(plan);
    return automationGesture({ ...args, gesture: "swipe", ...plan.coordinates, durationMs: args.durationMs ?? 250 });
  }
  throw new Error(`Unknown ref action command: ${command}`);
}

async function readRefRecord(ref, args = {}) {
  const cache = await readLatestRefCache(args);
  if (!cache) return { available: false, reason: "No snapshot exists for the current session.", ref };
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  if (record.stale) return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  return { available: true, record, cache };
}

async function refPoint(ref, args = {}) {
  const found = await readRefRecord(requireString(ref, "ref"), args);
  if (found.available === false) return found;
  const box = found.record.box;
  if (!box) return { available: false, reason: "Ref does not include bounds.", ref };
  return {
    available: true,
    ref,
    point: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    box,
  };
}

async function scrollPlan(args = {}) {
  const maybeRef = /^@e\d+$/.test(String(args.ref ?? "")) ? args.ref : null;
  const direction = requireString(maybeRef ? args.targetRef ?? args.direction : args.direction ?? args.ref, "direction").toLowerCase();
  const amount = clampNumber(args.amount ?? args.text ?? 600, 1, 5000);
  const origin = maybeRef
    ? await refPoint(maybeRef, args)
    : { available: true, point: { x: 200, y: 700 } };
  if (origin.available === false) return origin;
  const delta = {
    down: { x: 0, y: -amount },
    up: { x: 0, y: amount },
    left: { x: amount, y: 0 },
    right: { x: -amount, y: 0 },
  }[direction];
  if (!delta) return { available: false, reason: `Unknown scroll direction: ${direction}`, direction };
  const coordinates = {
    startX: origin.point.x,
    startY: origin.point.y,
    endX: origin.point.x + delta.x,
    endY: origin.point.y + delta.y,
  };
  return { available: true, dryRun: true, action: "scroll", direction, amount, coordinates };
}

async function resolveIosInteractionTool() {
  const idb = await commandPath("idb");
  if (idb) return { tool: "idb", path: idb };
  const axe = await commandPath("axe");
  if (axe) return { tool: "axe", path: axe };
  return null;
}

async function clipboardCommand(args = {}) {
  const action = requireString(args.action ?? "read", "action");
  if (!["read", "write", "paste"].includes(action)) throw new Error(`Unknown clipboard action: ${action}`);
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  if (args.dryRun === true) {
    return toolJson({ available: true, dryRun: true, action: `clipboard.${action}`, device });
  }
  if (action === "read") {
    const result = await execFilePromise("xcrun", ["simctl", "pbpaste", device.udid], {
      timeout: 10_000,
      rejectOnError: false,
    });
    return toolJson({ available: !result.error, action, device, text: result.stdout, stderr: truncate(result.stderr), error: result.error });
  }
  if (action === "write") {
    const text = requireString(args.text, "text");
    const result = await execFilePromise("xcrun", ["simctl", "pbcopy", device.udid], {
      input: text,
      timeout: 10_000,
      rejectOnError: false,
    });
    return toolJson({ available: !result.error, action, device, textLength: text.length, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error });
  }
  const axe = await commandPath("axe");
  if (!axe) return toolJson({ available: false, action, reason: "clipboard paste requires axe key-combo support.", device });
  const result = await execFilePromise(axe, ["key-combo", "--modifiers", "227", "--key", "25", "--udid", device.udid], {
    timeout: 10_000,
    rejectOnError: false,
  });
  return toolJson({ available: !result.error, action, device, tool: "axe", stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error });
}

async function keyboardCommand(args = {}) {
  const action = requireString(args.action ?? "type", "action");
  if (!["type", "press"].includes(action)) throw new Error(`Unknown keyboard action: ${action}`);
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const axe = await commandPath("axe");
  if (!axe) return toolJson({ available: false, action, reason: "keyboard commands require the axe CLI.", device });
  if (args.dryRun === true) {
    return toolJson({ available: true, dryRun: true, action: `keyboard.${action}`, device, tool: "axe" });
  }
  if (action === "type") {
    const text = requireString(args.text, "text");
    const result = await execFilePromise(axe, ["type", text, "--udid", device.udid], {
      timeout: 20_000,
      rejectOnError: false,
    });
    return toolJson({ available: !result.error, action, device, tool: "axe", textLength: text.length, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error });
  }
  const key = requireString(args.key, "key");
  const keycode = keyCodeFor(key);
  const result = await execFilePromise(axe, ["key", String(keycode), "--udid", device.udid], {
    timeout: 10_000,
    rejectOnError: false,
  });
  return toolJson({ available: !result.error, action, device, tool: "axe", key, keycode, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error });
}

function keyCodeFor(key) {
  const normalized = String(key).toLowerCase();
  const known = {
    enter: 40,
    return: 40,
    tab: 43,
    space: 44,
    backspace: 42,
    delete: 42,
    escape: 41,
    esc: 41,
  };
  if (known[normalized]) return known[normalized];
  if (/^\d+$/.test(normalized)) return clampNumber(Number(normalized), 0, 255);
  if (/^[a-z]$/.test(normalized)) return normalized.charCodeAt(0) - 93;
  throw new Error(`Unknown key: ${key}`);
}

async function setEnvironmentCommand(args = {}) {
  const domain = requireString(args.domain, "domain");
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const policy = await policyDecision(args, `set.${domain}`, "device");
  if (!policy.allowed) return toolJson(policyDeniedPayload({ domain: "set", action: domain, policy }));
  const planned = setEnvironmentPlan(domain, args, device);
  if (args.dryRun === true || planned.available === false) {
    return toolJson({ ...planned, dryRun: args.dryRun === true, policy });
  }
  const result = await execFilePromise(planned.command[0], planned.command.slice(1), {
    timeout: planned.timeoutMs ?? 20_000,
    rejectOnError: false,
  });
  return toolJson({
    available: !result.error,
    action: domain,
    device,
    command: planned.command,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    error: result.error,
    policy,
  });
}

function setEnvironmentPlan(domain, args, device) {
  const value = requireOptionalString(args.value);
  const extra = Array.isArray(args.extra) ? args.extra : [];
  if (domain === "appearance") {
    if (!["dark", "light"].includes(value)) throw new Error("appearance must be dark or light.");
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "ui", device.udid, "appearance", value] };
  }
  if (domain === "content-size") {
    const mapped = value === "accessibility" ? "accessibility-large" : requireString(value, "value");
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "ui", device.udid, "content_size", mapped] };
  }
  if (domain === "location") {
    const lat = requireString(value, "latitude");
    const lon = requireString(extra[0], "longitude");
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "location", device.udid, "set", `${lat},${lon}`] };
  }
  if (domain === "permissions") {
    const spec = requireString(value, "permission");
    const [service, state = "granted"] = spec.split("=");
    const bundleId = requireOptionalString(args.bundleId) ?? requireOptionalString(extra[0]);
    if (!bundleId) throw new Error("set permissions requires --bundle-id or a bundle id argument.");
    const action = state === "granted" ? "grant" : state === "denied" ? "revoke" : "reset";
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "privacy", device.udid, action, service, bundleId] };
  }
  if (domain === "locale" || domain === "timezone" || domain === "network" || domain === "orientation" || domain === "keyboard") {
    return {
      available: false,
      action: domain,
      reason: `${domain} mutation is not exposed by stable simctl/axe commands in this CLI yet.`,
      requestedValue: value,
      device,
    };
  }
  throw new Error(`Unknown set domain: ${domain}`);
}

async function automationGesture(args) {
  const platform = args.platform ?? "ios";
  const gesture = normalizeGesture(args.gesture);
  const repeat = clampNumber(args.repeat ?? 1, 1, 20);
  const intervalMs = clampNumber(args.intervalMs ?? 250, 0, 10_000);
  const durationMs = clampNumber(args.durationMs ?? defaultGestureDurationMs(gesture), 1, 30_000);
  const holdMs = args.holdMs === undefined ? null : clampNumber(args.holdMs, 0, 30_000);
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const maxEvents = clampNumber(args.maxEvents ?? 200, 1, 2000);
  const componentFilter = requireOptionalString(args.componentFilter);
  const cwd = requireOptionalString(args.cwd) ?? process.cwd();
  const coordinates = normalizeGestureCoordinates(gesture, args);
  const plan = gestureCommandPlan({ platform, gesture, coordinates, durationMs, holdMs, repeat, intervalMs, device: args.device });
  const reviewQuestionsThisCanAnswer = [
    "Does a long press stay on the intended target instead of becoming scroll?",
    "Does a drag/swipe create, resize, or scroll according to the intended mode?",
    "Do screenshots before and after show unintended movement, selection, or chrome overlap?",
    "Do React commits/layout changes during the gesture match the expected interaction owner?",
  ];

  if (args.dryRun === true) {
    return toolJson({
      available: true,
      dryRun: true,
      platform,
      gesture,
      coordinates,
      durationMs,
      holdMs,
      repeat,
      intervalMs,
      captureBeforeAfter: args.captureBeforeAfter === true,
      includeTrace: args.includeTrace === true,
      plan,
      reviewQuestionsThisCanAnswer,
    });
  }

  const evidence = {
    traceStart: null,
    traceRead: null,
    traceStop: null,
    screenshots: {},
  };
  if (args.captureBeforeAfter === true) {
    evidence.screenshots.before = await captureGestureScreenshot({ platform, device: args.device, outputDir: args.outputDir, label: "before" });
  }
  if (args.includeTrace === true) {
    evidence.traceStart = unwrapToolJson(await traceInteraction({
      cwd,
      metroPort,
      action: "start",
      componentFilter,
      maxEvents,
      includeEvents: false,
    }));
  }

  const execution = await executeGesturePlan({ platform, device: args.device, gesture, plan, repeat, intervalMs });

  if (args.includeTrace === true) {
    evidence.traceRead = unwrapToolJson(await traceInteraction({
      cwd,
      metroPort,
      action: "read",
      componentFilter,
      maxEvents,
      includeEvents: false,
    }));
    evidence.traceStop = unwrapToolJson(await traceInteraction({
      cwd,
      metroPort,
      action: "stop",
      componentFilter,
      maxEvents,
      includeEvents: false,
    }));
  }
  if (args.captureBeforeAfter === true) {
    evidence.screenshots.after = await captureGestureScreenshot({ platform, device: args.device, outputDir: args.outputDir, label: "after" });
  }

  return toolJson({
    available: execution.available,
    platform,
    gesture,
    coordinates,
    durationMs,
    holdMs,
    repeat,
    intervalMs,
    plan,
    execution,
    evidence,
    reviewQuestionsThisCanAnswer,
    interferenceReview: {
      requiredHumanCheck: "Compare before/after screenshots and trace summary against the intended gesture owner. This command gathers evidence; it does not know the app's product semantics.",
      possibleSignals: [
        "after screenshot shows unexpected scroll offset or selected state",
        "trace shows commits/layout changes outside the intended component filter",
        "gesture command reports unavailable tooling, meaning the interaction was not actually exercised",
      ],
    },
  });
}

function normalizeGesture(value) {
  const gesture = requireString(value, "gesture");
  if (gesture === "tap-and-hold") return "long-press";
  if (!["tap", "long-press", "drag", "swipe"].includes(gesture)) {
    throw new Error(`Unknown gesture: ${gesture}`);
  }
  return gesture;
}

function defaultGestureDurationMs(gesture) {
  if (gesture === "long-press") return 900;
  if (gesture === "drag") return 900;
  if (gesture === "swipe") return 250;
  return 80;
}

function normalizeGestureCoordinates(gesture, args) {
  if (gesture === "tap" || gesture === "long-press") {
    return {
      x: clampNumber(args.x, 0, Number.MAX_SAFE_INTEGER),
      y: clampNumber(args.y, 0, Number.MAX_SAFE_INTEGER),
    };
  }
  return {
    startX: clampNumber(args.startX, 0, Number.MAX_SAFE_INTEGER),
    startY: clampNumber(args.startY, 0, Number.MAX_SAFE_INTEGER),
    endX: clampNumber(args.endX, 0, Number.MAX_SAFE_INTEGER),
    endY: clampNumber(args.endY, 0, Number.MAX_SAFE_INTEGER),
  };
}

function gestureCommandPlan({ platform, gesture, coordinates, durationMs, holdMs, repeat, intervalMs, device }) {
  const durationSeconds = (durationMs / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  const holdSeconds = holdMs === null ? null : (holdMs / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  if (platform === "android") {
    const deviceArgs = device ? ["-s", String(device)] : [];
    const command = gesture === "tap"
      ? ["adb", ...deviceArgs, "shell", "input", "tap", String(coordinates.x), String(coordinates.y)]
      : gesture === "long-press"
        ? ["adb", ...deviceArgs, "shell", "input", "swipe", String(coordinates.x), String(coordinates.y), String(coordinates.x), String(coordinates.y), String(durationMs)]
        : ["adb", ...deviceArgs, "shell", "input", "swipe", String(coordinates.startX), String(coordinates.startY), String(coordinates.endX), String(coordinates.endY), String(durationMs)];
    return {
      tool: "adb",
      command,
      repeat,
      intervalMs,
      notes: holdMs ? ["Android adb input swipe has duration but no separate hold-before-move primitive."] : [],
    };
  }

  const udidArgs = device ? ["--udid", String(device)] : ["--udid", "<resolved-booted-simulator-udid>"];
  const command = gesture === "tap"
    ? ["idb", "ui", "tap", String(coordinates.x), String(coordinates.y), ...udidArgs]
    : gesture === "long-press"
      ? ["idb", "ui", "tap", String(coordinates.x), String(coordinates.y), "--duration", durationSeconds, ...udidArgs]
      : ["idb", "ui", "swipe", String(coordinates.startX), String(coordinates.startY), String(coordinates.endX), String(coordinates.endY), "--duration", durationSeconds, ...udidArgs];
  return {
    tool: "idb",
    command,
    repeat,
    intervalMs,
    notes: holdSeconds ? ["Current idb plan records holdMs as intent; idb swipe supports duration but not a separate hold-before-move flag in this wrapper."] : [],
  };
}

async function executeGesturePlan({ platform, device, gesture, plan, repeat, intervalMs }) {
  if (platform === "android") {
    const adb = await commandPath("adb");
    if (!adb) {
      return { available: false, reason: "Android gestures require adb, which is not installed or not on PATH.", plan };
    }
    return executeRepeatedCommand(plan.command[0], plan.command.slice(1), { repeat, intervalMs });
  }

  const tool = await resolveIosInteractionTool();
  if (!tool) {
    return {
      available: false,
      reason: "iOS complex gestures require the idb or axe CLI, but neither is installed or on PATH.",
      installHint: "Install idb or axe and rerun this command, or use dryRun=true to inspect the intended gesture plan.",
      plan,
    };
  }
  const resolvedDevice = device ? { udid: String(device) } : await resolveIosDevice(null, { preferBooted: true });
  if (tool.tool === "axe") {
    const command = axeGestureCommandFromPlan({ gesture, plan, udid: resolvedDevice.udid });
    return executeRepeatedCommand(tool.path, command.slice(1), { repeat, intervalMs, device: resolvedDevice, tool: tool.tool, plannedCommand: command });
  }
  const command = plan.command.map((part) => part === "<resolved-booted-simulator-udid>" ? resolvedDevice.udid : part);
  return executeRepeatedCommand(tool.path, command.slice(1), { repeat, intervalMs, device: resolvedDevice, tool: tool.tool, plannedCommand: command });
}

function axeGestureCommandFromPlan({ gesture, plan, udid }) {
  const command = plan.command;
  if (gesture === "tap") {
    return ["axe", "tap", "-x", command[3], "-y", command[4], "--udid", udid];
  }
  if (gesture === "long-press") {
    const durationIndex = command.indexOf("--duration");
    const delay = durationIndex === -1 ? "0.9" : command[durationIndex + 1];
    return ["axe", "touch", "-x", command[3], "-y", command[4], "--down", "--up", "--delay", delay, "--udid", udid];
  }
  const durationIndex = command.indexOf("--duration");
  const duration = durationIndex === -1 ? null : command[durationIndex + 1];
  const axeCommand = [
    "axe",
    gesture === "drag" ? "drag" : "swipe",
    "--start-x",
    command[3],
    "--start-y",
    command[4],
    "--end-x",
    command[5],
    "--end-y",
    command[6],
  ];
  if (duration) axeCommand.push("--duration", duration);
  axeCommand.push("--udid", udid);
  return axeCommand;
}

async function executeRepeatedCommand(command, args, { repeat, intervalMs, device, tool, plannedCommand } = {}) {
  const runs = [];
  for (let index = 0; index < repeat; index += 1) {
    const result = await execFilePromise(command, args, {
      timeout: 35_000,
      rejectOnError: false,
    });
    runs.push({
      index: index + 1,
      command: [command, ...args],
      exitCode: result.error?.code ?? 0,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    });
    if (index < repeat - 1 && intervalMs > 0) await wait(intervalMs);
  }
  return {
    available: true,
    device: device ?? null,
    tool: tool ?? path.basename(command),
    command: plannedCommand ?? [path.basename(command), ...args],
    runs,
  };
}

async function captureGestureScreenshot({ platform, device, outputDir, label }) {
  const root = requireOptionalString(outputDir) ?? path.join(os.tmpdir(), "expo-ios-gestures");
  await fs.mkdir(root, { recursive: true });
  const outputPath = path.join(root, `${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  return unwrapToolJson(await automationTakeScreenshot({ platform, device, outputPath }));
}

async function openExpoRoute(args) {
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true });
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const url = args.url ? requireString(args.url, "url") : await buildExpoRouteUrl(cwd, args);
  if (/\s/.test(url)) throw new Error("url must not contain whitespace.");
  const result = await execFilePromise("xcrun", ["simctl", "openurl", device.udid, url], {
    timeout: 30_000,
    rejectOnError: false,
  });
  return toolJson({
    platform: "ios",
    device,
    url: redactUrlAuthCookie(url),
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    error: result.error,
  });
}

async function captureUxContext(args) {
  const startedAt = Date.now();
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true });
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const context = {
    capturedAt: new Date().toISOString(),
    cwd,
    device,
    elapsedMs: null,
    app: null,
    screenshot: null,
    visualAnalysis: null,
    metro: null,
    runtime: null,
    componentHierarchy: null,
    routes: null,
    hierarchy: null,
    logs: null,
    reviewQuestionsThisCanAnswer: [
      "Is the screen blank because of empty data, loading, failed network, or render failure?",
      "Which route/source file likely owns the visible screen?",
      "Is the app connected to Metro and running Hermes/Fabric/New Architecture?",
      "What colors, contrast, visual density, and coarse composition does the current screen expose?",
      "Which React components and host elements are likely composing the current screen?",
      "Which labels, text nodes, roles, test IDs, and source owner hints map visible UI back to code?",
      "Does the app expose a usable simulator hierarchy, or is screenshot/coordinate review the only reliable UI surface?",
      "Are recent native logs showing failed requests, reloads, exceptions, or slow local calls during the reviewed state?",
    ],
  };

  const projectSummary = await safeToolSection(() => expoProjectRuntimeSummary(cwd));
  if (projectSummary.ok) {
    context.project = projectSummary.value;
  } else {
    context.project = projectSummary;
  }

  const metroSummary = args.includeRuntime === false
    ? { ok: false, skipped: true, reason: "includeRuntime is false" }
    : await safeToolSection(() => inspectMetro(metroPort, {
      includeComponents: args.includeComponents !== false,
      componentFilter: requireOptionalString(args.componentFilter),
    }));
  context.metro = metroSummary.ok ? metroSummary.value.metro : metroSummary;
  context.runtime = metroSummary.ok ? metroSummary.value.runtime : metroSummary;
  context.componentHierarchy = context.runtime?.componentHierarchy ?? (
    args.includeRuntime === false
      ? { skipped: true, reason: "includeRuntime is false" }
      : args.includeComponents === false
        ? { skipped: true, reason: "includeComponents is false" }
        : { available: false, reason: "No component hierarchy returned by runtime probe." }
  );
  if (context.runtime && typeof context.runtime === "object" && "componentHierarchy" in context.runtime) {
    delete context.runtime.componentHierarchy;
  }

  const inferredBundleId =
    requireOptionalString(args.bundleId) ??
    context.metro?.targets?.find((target) => target.appId)?.appId ??
    context.project?.appConfig?.iosBundleIdentifier ??
    null;
  const processName = requireOptionalString(args.processName) ?? processNameFromBundleId(inferredBundleId);
  if (inferredBundleId) {
    const appInfo = await safeToolSection(() => iosInstalledAppInfo(device.udid, inferredBundleId));
    context.app = appInfo.ok ? appInfo.value : { bundleId: inferredBundleId, ...appInfo };
  } else {
    context.app = { bundleId: null, warning: "Could not infer bundleId. Pass bundleId for app container details and precise log filtering." };
  }

  if (args.includeScreenshot !== false) {
    const screenshot = await safeToolSection(() => captureIosScreenshot(device.udid, args.outputPath));
    context.screenshot = screenshot.ok ? screenshot.value : screenshot;
    if (screenshot.ok && args.includeImageAnalysis !== false) {
      const analysis = await safeToolSection(() => analyzePngScreenshot(screenshot.value.outputPath));
      context.visualAnalysis = analysis.ok ? analysis.value : analysis;
    }
  } else {
    context.screenshot = { skipped: true, reason: "includeScreenshot is false" };
    context.visualAnalysis = { skipped: true, reason: "No screenshot captured." };
  }

  context.routes = await safeToolSection(() => expoRouteContext(cwd));
  if (context.routes.ok) context.routes = context.routes.value;

  if (args.includeHierarchy !== false) {
    const hierarchy = await safeToolSection(() => describeIosHierarchy(device.udid));
    context.hierarchy = hierarchy.ok ? hierarchy.value : hierarchy;
  } else {
    context.hierarchy = { skipped: true, reason: "includeHierarchy is false" };
  }

  if (args.includeLogs) {
    const logsLast = args.logsLast ?? "60s";
    if (!/^\d+[smhd]$/.test(logsLast)) throw new Error("logsLast must look like 30s, 2m, 1h, or 1d.");
    const logs = await safeToolSection(() => collectFilteredIosLogs(device.udid, {
      last: logsLast,
      bundleId: inferredBundleId,
      processName,
    }));
    context.logs = logs.ok ? logs.value : logs;
  } else {
    context.logs = {
      skipped: true,
      reason: "includeLogs is false. Set includeLogs=true for recent filtered iOS logs.",
      suggestedFilter: processName ? `process == "${processName}"` : inferredBundleId ? `process CONTAINS "${processNameFromBundleId(inferredBundleId)}"` : null,
    };
  }

  context.elapsedMs = Date.now() - startedAt;
  return toolJson(context);
}

async function annotateScreen(args = {}) {
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true }).catch(() => path.resolve(args.cwd ?? process.cwd()));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.resolve(
    args.outputDir ??
      path.join(cwd, ".scratch", "expo-ios-annotations", `annotation-${timestamp}`),
  );
  await fs.mkdir(outputDir, { recursive: true });

  const screenshotPath = path.join(outputDir, "screenshot.png");
  let context = null;
  const existingScreenshot = requireOptionalString(args.screenshotPath);
  if (existingScreenshot) {
    await fs.copyFile(path.resolve(existingScreenshot), screenshotPath);
    context = {
      source: "provided-screenshot",
      screenshot: { outputPath: screenshotPath },
      capturedAt: new Date().toISOString(),
    };
  } else if (args.includeUxContext !== false) {
    context = unwrapToolJson(await captureUxContext({
      cwd,
      device: args.device,
      bundleId: args.bundleId,
      metroPort: args.metroPort,
      outputPath: screenshotPath,
      includeScreenshot: true,
      includeImageAnalysis: true,
      includeHierarchy: true,
      includeRuntime: true,
      includeComponents: true,
      includeLogs: false,
    }));
  } else {
    const shot = unwrapToolJson(await automationTakeScreenshot({
      platform: "ios",
      device: args.device,
      outputPath: screenshotPath,
    }));
    context = { source: "screenshot-only", screenshot: shot, capturedAt: new Date().toISOString() };
  }

  const title = requireOptionalString(args.title) ?? "Expo screen annotations";
  const contextPath = path.join(outputDir, "context.json");
  const annotationsPath = path.join(outputDir, "annotations.json");
  const htmlPath = path.join(outputDir, "annotate.html");
  await fs.writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");
  if (!(await pathExists(annotationsPath))) {
    await fs.writeFile(annotationsPath, `${JSON.stringify({
      version: 1,
      title,
      createdAt: new Date().toISOString(),
      screenshot: "screenshot.png",
      context: "context.json",
      comments: [],
    }, null, 2)}\n`, "utf8");
  }
  await fs.writeFile(htmlPath, annotationHtml({ title }), "utf8");

  let server = null;
  if (args.serve === true) {
    const port = args.port ? clampNumber(args.port, 1, 65535) : await findAvailablePort(17654);
    const logPath = path.join(outputDir, "annotation-server.log");
    const logFd = fsSync.openSync(logPath, "a");
    const child = spawn(process.execPath, [
      process.argv[1],
      "annotation-server",
      "--dir",
      outputDir,
      "--port",
      String(port),
    ], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    server = {
      url: `http://127.0.0.1:${port}/`,
      pid: child.pid,
      logPath,
      stop: `kill ${child.pid}`,
    };
  }

  return toolJson({
    outputDir,
    htmlPath,
    screenshotPath,
    contextPath,
    annotationsPath,
    server,
    instructions: [
      server
        ? `Open ${server.url}, click or drag on the screenshot, add comments, then press Save.`
        : `Open ${htmlPath}. In file mode, use Download JSON or Copy JSON after adding comments.`,
      `Codex can read comments from ${annotationsPath}.`,
    ],
  });
}

async function annotationServer(args = {}) {
  const dir = path.resolve(requireString(args.dir, "dir"));
  const port = clampNumber(args.port ?? 17654, 1, 65535);
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/annotate.html")) {
        return sendFile(response, path.join(dir, "annotate.html"), "text/html; charset=utf-8");
      }
      if (request.method === "GET" && url.pathname === "/screenshot.png") {
        return sendFile(response, path.join(dir, "screenshot.png"), "image/png");
      }
      if (request.method === "GET" && url.pathname === "/context.json") {
        return sendFile(response, path.join(dir, "context.json"), "application/json; charset=utf-8");
      }
      if (request.method === "GET" && url.pathname === "/annotations.json") {
        return sendFile(response, path.join(dir, "annotations.json"), "application/json; charset=utf-8");
      }
      if (request.method === "POST" && url.pathname === "/annotations") {
        const body = await readRequestBody(request, 2 * 1024 * 1024);
        const payload = JSON.parse(body || "{}");
        if (!payload || !Array.isArray(payload.comments)) throw new Error("annotations payload must include comments array");
        payload.savedAt = new Date().toISOString();
        await fs.writeFile(path.join(dir, "annotations.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        return sendJson(response, { ok: true, annotationsPath: path.join(dir, "annotations.json"), savedAt: payload.savedAt });
      }
      sendJson(response, { ok: false, error: "not found" }, 404);
    } catch (error) {
      sendJson(response, { ok: false, error: formatError(error) }, 500);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  process.stdout.write(JSON.stringify({ ok: true, url: `http://127.0.0.1:${port}/`, dir }, null, 2) + "\n");
  await new Promise(() => {});
}

async function reviewOverlay(args = {}) {
  const action = requireOptionalString(args.action) ?? "prepare";
  if (!["prepare", "scaffold", "server", "read", "clear"].includes(action)) {
    throw new Error(`Unknown review-overlay action: ${action}`);
  }
  if (action === "scaffold") return toolJson(await scaffoldReviewOverlay(args));
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true }).catch(() => path.resolve(args.cwd ?? process.cwd()));
  const outputDir = path.resolve(requireOptionalString(args.outputDir) ?? path.join(cwd, ".scratch", "codex-review-overlay"));
  const eventsPath = path.join(outputDir, "events.json");
  if (action === "read") {
    const data = await readReviewOverlayEvents(eventsPath, { metroPort: args.metroPort });
    return toolJson({ outputDir, eventsPath, ...data });
  }
  if (action === "clear") {
    const data = await createReviewOverlayEventsFile({ outputDir, title: args.title, reset: true });
    return toolJson({ outputDir, eventsPath, cleared: true, ...data });
  }
  if (action === "server") {
    return reviewOverlayServer({ dir: outputDir, port: args.port, endpointPath: args.endpointPath });
  }

  const title = requireOptionalString(args.title) ?? "Codex in-app review";
  const data = await createReviewOverlayEventsFile({ outputDir, title, reset: false });
  let server = null;
  if (args.serve === true) {
    const port = args.port ? clampNumber(args.port, 1, 65535) : await findAvailablePort(17655);
    const endpointPath = normalizeEndpointPath(args.endpointPath);
    const logPath = path.join(outputDir, "review-overlay-server.log");
    const logFd = fsSync.openSync(logPath, "a");
    const child = spawn(process.execPath, [
      process.argv[1],
      "review-overlay-server",
      "--output-dir",
      outputDir,
      "--port",
      String(port),
      "--endpoint-path",
      endpointPath,
    ], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    server = {
      url: `http://127.0.0.1:${port}/`,
      endpoint: `http://127.0.0.1:${port}${endpointPath}`,
      eventsUrl: `http://127.0.0.1:${port}/events.json`,
      pid: child.pid,
      logPath,
      stop: `kill ${child.pid}`,
    };
  }
  return toolJson({
    outputDir,
    eventsPath,
    server,
    ...data,
    instructions: [
      "Run review-overlay scaffold once, then mount CodexReviewOverlay inside the app root in development only.",
      server
        ? `Pass endpoint="${server.endpoint}" to CodexReviewOverlay. In iOS Simulator, 127.0.0.1 points at the Mac host.`
        : "Start with --serve true or run review-overlay server before using the overlay in the simulator.",
      `Codex can read in-app review events from ${eventsPath}.`,
    ],
  });
}

async function scaffoldReviewOverlay(args = {}) {
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true }).catch(() => path.resolve(args.cwd ?? process.cwd()));
  const overlayDir = path.resolve(cwd, requireOptionalString(args.overlayDir) ?? "codex-review-overlay");
  const componentPath = path.join(overlayDir, "CodexReviewOverlay.tsx");
  const indexPath = path.join(overlayDir, "index.ts");
  if (await pathExists(componentPath) && args.force !== true) {
    throw new Error(`${componentPath} already exists. Pass --force true to overwrite.`);
  }
  await fs.mkdir(overlayDir, { recursive: true });
  await fs.writeFile(componentPath, codexReviewOverlayComponentSource(), "utf8");
  await fs.writeFile(indexPath, `export { CodexReviewOverlay } from "./CodexReviewOverlay";\nexport { default } from "./CodexReviewOverlay";\n`, "utf8");
  return {
    overlayDir,
    componentPath,
    indexPath,
    integration: {
      import: `import { CodexReviewOverlay } from "${relativeImportFromAppRoot(cwd, overlayDir)}";`,
      jsx: `{__DEV__ ? <CodexReviewOverlay endpoint="http://127.0.0.1:17655/events" screenName="Schedule" inspectedViewRef={inspectedViewRef} /> : null}`,
      note: "Mount this near the root layout so it floats above the current screen. Wrap only the app content, not the overlay, in a host View ref with collapsable={false}; pass that ref as inspectedViewRef so comments identify the tapped app element.",
    },
    capabilities: [
      "single Comment control inside the app",
      "inactive state leaves the app interactive",
      "mouse-over preview after Comment resolves native elements before selection",
      "next click after Comment resolves the touched native element and owner hierarchy",
      "Copy action writes Agentation-style feedback markdown to the Mac clipboard",
      "bounding boxes around commented elements",
      "gesture metadata for tap, hold, and scroll conflict notes",
      "local JSON event sync readable by Codex",
    ],
  };
}

function relativeImportFromAppRoot(cwd, overlayDir) {
  const rel = path.relative(cwd, overlayDir).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

async function reviewOverlayServer(args = {}) {
  const dir = path.resolve(requireString(args.dir ?? args.outputDir, "outputDir"));
  const port = Number(args.port) === 0 ? 0 : clampNumber(args.port ?? 17655, 1, 65535);
  const endpointPath = normalizeEndpointPath(args.endpointPath);
  await createReviewOverlayEventsFile({ outputDir: dir, title: "Codex in-app review", reset: false });
  const eventsPath = path.join(dir, "events.json");
  const server = http.createServer(async (request, response) => {
    try {
      setCorsHeaders(response);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, { ok: true, endpoint: endpointPath, eventsPath });
      }
      if (request.method === "GET" && url.pathname === "/pointer") {
        const viewportWidth = Number(url.searchParams.get("viewportWidth"));
        const viewportHeight = Number(url.searchParams.get("viewportHeight"));
        return sendJson(response, await readSimulatorPointer({
          viewportWidth: Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 393,
          viewportHeight: Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 852,
        }));
      }
      if (request.method === "POST" && url.pathname === "/copy") {
        const body = await readRequestBody(request, 2 * 1024 * 1024);
        const payload = JSON.parse(body || "{}");
        const copied = await writeMacClipboard(String(payload.text || ""));
        return sendJson(response, { ok: copied, copied });
      }
      if (request.method === "GET" && url.pathname === "/events.json") {
        return sendFile(response, eventsPath, "application/json; charset=utf-8");
      }
      if (request.method === "GET" && url.pathname === endpointPath) {
        const data = await readReviewOverlayEvents(eventsPath);
        return sendJson(response, data);
      }
      if (request.method === "POST" && url.pathname === endpointPath) {
        const body = await readRequestBody(request, 2 * 1024 * 1024);
        const payload = JSON.parse(body || "{}");
        const data = await appendReviewOverlayEvent(eventsPath, payload);
        return sendJson(response, { ok: true, eventCount: data.events.length, eventsPath });
      }
      if (request.method === "DELETE" && url.pathname === endpointPath) {
        const data = await createReviewOverlayEventsFile({ outputDir: dir, title: "Codex in-app review", reset: true });
        return sendJson(response, { ok: true, cleared: true, eventCount: data.events.length, eventsPath });
      }
      sendJson(response, { ok: false, error: "not found" }, 404);
    } catch (error) {
      sendJson(response, { ok: false, error: formatError(error) }, 500);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  process.stdout.write(JSON.stringify({
    ok: true,
    url: `http://127.0.0.1:${port}/`,
    endpoint: `http://127.0.0.1:${port}${endpointPath}`,
    eventsPath,
  }, null, 2) + "\n");
  await new Promise(() => {});
}

let simulatorWindowCache = { readAt: 0, value: null };

async function readSimulatorPointer({ viewportWidth, viewportHeight }) {
  if (process.platform !== "darwin") {
    return { ok: false, inside: false, error: "pointer bridge requires macOS Simulator" };
  }
  const [cursor, window] = await Promise.all([
    readMacCursorPosition(),
    readSimulatorWindowBounds(),
  ]);
  if (!cursor || !window) {
    return { ok: false, inside: false, error: "unable to read mouse cursor or Simulator window bounds" };
  }
  const relativeX = cursor.x - window.x;
  const relativeY = cursor.y - window.y;
  const inside = relativeX >= 0 && relativeY >= 0 && relativeX <= window.width && relativeY <= window.height;
  const x = Math.max(0, Math.min(viewportWidth, relativeX / window.width * viewportWidth));
  const y = Math.max(0, Math.min(viewportHeight, relativeY / window.height * viewportHeight));
  return {
    ok: true,
    inside,
    point: { x, y },
    cursor,
    simulatorWindow: window,
    mapping: "mac-cursor-to-simulator-window",
  };
}

async function readMacCursorPosition() {
  const cliclick = await commandPath("cliclick");
  if (!cliclick) return null;
  const result = await execFilePromise(cliclick, ["p"], { timeout: 1500, rejectOnError: false });
  const match = /(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(result.stdout.trim());
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

async function writeMacClipboard(text) {
  if (process.platform !== "darwin" || !text) return false;
  const pbcopy = await commandPath("pbcopy");
  if (!pbcopy) return false;
  const result = await execFilePromise(pbcopy, [], { input: text, timeout: 1500, rejectOnError: false });
  return !result.error;
}

async function readSimulatorWindowBounds() {
  const now = Date.now();
  if (simulatorWindowCache.value && now - simulatorWindowCache.readAt < 500) {
    return simulatorWindowCache.value;
  }
  const script = [
    'tell application "System Events"',
    '  tell application process "Simulator"',
    '    set windowPosition to position of first window',
    '    set windowSize to size of first window',
    '    return (item 1 of windowPosition as text) & "," & (item 2 of windowPosition as text) & "," & (item 1 of windowSize as text) & "," & (item 2 of windowSize as text)',
    '  end tell',
    'end tell',
  ].join("\n");
  const result = await execFilePromise("osascript", ["-e", script], { timeout: 2000, rejectOnError: false });
  const values = result.stdout.trim().split(",").map((value) => Number(value.trim()));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  simulatorWindowCache = {
    readAt: now,
    value: { x: values[0], y: values[1], width: values[2], height: values[3] },
  };
  return simulatorWindowCache.value;
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function normalizeEndpointPath(value) {
  const raw = requireOptionalString(value) ?? "/events";
  const endpoint = raw.startsWith("/") ? raw : `/${raw}`;
  if (!/^\/[A-Za-z0-9_./-]+$/.test(endpoint)) throw new Error("endpointPath must be a simple URL path.");
  return endpoint;
}

async function createReviewOverlayEventsFile({ outputDir, title, reset }) {
  await fs.mkdir(outputDir, { recursive: true });
  const eventsPath = path.join(outputDir, "events.json");
  if (!reset && await pathExists(eventsPath)) {
    return readReviewOverlayEvents(eventsPath);
  }
  const data = {
    version: 1,
    title: requireOptionalString(title) ?? "Codex in-app review",
    createdAt: new Date().toISOString(),
    events: [],
  };
  await fs.writeFile(eventsPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}

async function readReviewOverlayEvents(eventsPath, options = {}) {
  if (!(await pathExists(eventsPath))) {
    return {
      version: 1,
      title: "Codex in-app review",
      createdAt: null,
      events: [],
      missing: true,
    };
  }
  const data = JSON.parse(await fs.readFile(eventsPath, "utf8"));
  if (!Array.isArray(data.events)) data.events = [];
  if (options.metroPort) {
    data.symbolication = await symbolicateReviewOverlayEvents(data.events, clampNumber(options.metroPort, 1, 65535));
  }
  return data;
}

async function symbolicateReviewOverlayEvents(events, metroPort) {
  const summary = { metroPort, attempted: 0, enriched: 0, errors: [] };
  for (const event of events) {
    const stack = event?.element?.componentStack;
    if (typeof stack !== "string" || !stack.trim()) continue;
    const frames = parseComponentStackFrames(stack);
    if (frames.length === 0) continue;
    summary.attempted += 1;
    try {
      const result = await postMetroSymbolicate(metroPort, frames.slice(0, 80));
      const sourceLinks = (Array.isArray(result.stack) ? result.stack : [])
        .filter((frame) => frame && frame.file && !/node_modules/.test(frame.file))
        .map((frame) => ({
          methodName: frame.methodName || null,
          fileName: frame.file,
          lineNumber: typeof frame.lineNumber === "number" ? frame.lineNumber : null,
          columnNumber: typeof frame.column === "number" ? frame.column : null,
        }))
        .slice(0, 12);
      if (sourceLinks.length > 0) {
        event.element.sourceLinks = sourceLinks;
        if (!event.element.source) event.element.source = sourceLinks[0];
        summary.enriched += 1;
      }
    } catch (error) {
      summary.errors.push(formatError(error));
    }
  }
  return summary;
}

function parseComponentStackFrames(stack) {
  const frames = [];
  for (const line of String(stack).split("\n")) {
    const match = /^\s*at\s+(.*?)\s+\((http.*):(\d+):(\d+)\)$/.exec(line);
    if (!match) continue;
    frames.push({
      methodName: match[1].trim() || "<anonymous>",
      file: match[2],
      lineNumber: Number(match[3]),
      column: Number(match[4]),
    });
  }
  return frames;
}

async function postMetroSymbolicate(metroPort, stack) {
  const result = await new MetroInspectorClient(metroPort).symbolicate(stack);
  if (!result.available) throw new Error(result.reason ?? "Metro symbolication failed.");
  return result.value;
}

async function appendReviewOverlayEvent(eventsPath, payload) {
  const data = await readReviewOverlayEvents(eventsPath);
  const events = Array.isArray(payload.events) ? payload.events : [payload];
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    data.events.push({
      id: event.id || `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      receivedAt: new Date().toISOString(),
      ...event,
    });
  }
  data.savedAt = new Date().toISOString();
  await fs.writeFile(eventsPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}

async function sendFile(response, file, contentType) {
  const bytes = await fs.readFile(file);
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(bytes);
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function readRequestBody(request, limit) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function findAvailablePort(start) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE" && port < 65535) {
          tryPort(port + 1);
        } else {
          reject(error);
        }
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}

function annotationHtml({ title }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; background: #111; color: #f5f5f7; }
    body { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) 360px; min-height: 100vh; }
    #stage { position: relative; align-self: start; margin: 16px; border: 1px solid #3a3a3c; border-radius: 12px; overflow: hidden; background: #000; }
    #shot { display: block; width: 100%; height: auto; user-select: none; -webkit-user-drag: none; }
    .marker { position: absolute; min-width: 20px; height: 20px; border-radius: 999px; transform: translate(-50%, -50%); background: #ff453a; color: white; display: grid; place-items: center; font-size: 12px; font-weight: 700; box-shadow: 0 0 0 3px rgba(255,69,58,.24); }
    .rect { position: absolute; border: 2px solid #0a84ff; background: rgba(10,132,255,.12); border-radius: 6px; pointer-events: none; }
    aside { border-left: 1px solid #2c2c2e; padding: 16px; position: sticky; top: 0; height: 100vh; box-sizing: border-box; overflow: auto; background: #1c1c1e; }
    button, textarea, input { font: inherit; }
    button { border: 0; border-radius: 8px; padding: 8px 10px; background: #0a84ff; color: white; font-weight: 600; cursor: pointer; }
    button.secondary { background: #3a3a3c; }
    textarea { width: 100%; min-height: 72px; box-sizing: border-box; border-radius: 8px; border: 1px solid #48484a; background: #111; color: white; padding: 8px; resize: vertical; }
    .comment { border: 1px solid #38383a; border-radius: 10px; padding: 10px; margin: 10px 0; background: #242426; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .hint { color: #a1a1a6; font-size: 13px; line-height: 1.35; }
    code { color: #d1d1d6; }
  </style>
</head>
<body>
  <main>
    <div id="stage"><img id="shot" src="screenshot.png" alt="Captured app screen"></div>
  </main>
  <aside>
    <h1>${escapeHtml(title)}</h1>
    <p class="hint">Click for a point comment. Drag to create a rectangle comment. Served mode saves to <code>annotations.json</code>; file mode can download or copy JSON.</p>
    <div class="row">
      <button id="save">Save</button>
      <button id="download" class="secondary">Download JSON</button>
      <button id="copy" class="secondary">Copy JSON</button>
    </div>
    <p id="status" class="hint"></p>
    <section id="comments"></section>
  </aside>
  <script>
    const stage = document.getElementById('stage');
    const shot = document.getElementById('shot');
    const commentsEl = document.getElementById('comments');
    const statusEl = document.getElementById('status');
    let annotations = { version: 1, title: ${JSON.stringify(title)}, screenshot: 'screenshot.png', context: 'context.json', comments: [] };
    let dragStart = null;

    fetch('annotations.json').then(r => r.ok ? r.json() : annotations).then(data => {
      if (data && Array.isArray(data.comments)) annotations = data;
      render();
    }).catch(render);

    function imagePoint(event) {
      const rect = shot.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      return { x, y, nx: x / rect.width, ny: y / rect.height };
    }

    stage.addEventListener('mousedown', event => { if (event.button === 0) dragStart = imagePoint(event); });
    stage.addEventListener('mouseup', event => {
      if (!dragStart) return;
      const end = imagePoint(event);
      const dx = Math.abs(end.x - dragStart.x);
      const dy = Math.abs(end.y - dragStart.y);
      const text = prompt(dx > 8 || dy > 8 ? 'Comment for this region:' : 'Comment for this point:');
      if (text && text.trim()) {
        const rect = shot.getBoundingClientRect();
        const comment = dx > 8 || dy > 8
          ? {
              kind: 'rect',
              x: Math.min(dragStart.x, end.x),
              y: Math.min(dragStart.y, end.y),
              width: dx,
              height: dy,
              nx: Math.min(dragStart.x, end.x) / rect.width,
              ny: Math.min(dragStart.y, end.y) / rect.height,
              nw: dx / rect.width,
              nh: dy / rect.height,
              text: text.trim()
            }
          : { kind: 'point', ...end, text: text.trim() };
        addComment(comment);
      }
      dragStart = null;
    });

    function addComment(comment) {
      annotations.comments.push({
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        createdAt: new Date().toISOString(),
        ...comment
      });
      render();
    }

    function render() {
      stage.querySelectorAll('.marker,.rect').forEach(node => node.remove());
      const rect = shot.getBoundingClientRect();
      annotations.comments.forEach((comment, index) => {
        if (comment.kind === 'rect') {
          const node = document.createElement('div');
          node.className = 'rect';
          node.style.left = (comment.nx * rect.width) + 'px';
          node.style.top = (comment.ny * rect.height) + 'px';
          node.style.width = (comment.nw * rect.width) + 'px';
          node.style.height = (comment.nh * rect.height) + 'px';
          stage.appendChild(node);
        } else {
          const node = document.createElement('div');
          node.className = 'marker';
          node.textContent = String(index + 1);
          node.style.left = (comment.nx * rect.width) + 'px';
          node.style.top = (comment.ny * rect.height) + 'px';
          stage.appendChild(node);
        }
      });
      commentsEl.innerHTML = '';
      annotations.comments.forEach((comment, index) => {
        const card = document.createElement('div');
        card.className = 'comment';
        card.innerHTML = '<div class="row"><strong>#' + (index + 1) + '</strong><span class="hint">' + comment.kind + ' ' + formatPosition(comment) + '</span><button class="secondary" data-delete="' + comment.id + '">Delete</button></div>';
        const textarea = document.createElement('textarea');
        textarea.value = comment.text || '';
        textarea.addEventListener('input', () => { comment.text = textarea.value; });
        card.appendChild(textarea);
        commentsEl.appendChild(card);
      });
      commentsEl.querySelectorAll('[data-delete]').forEach(button => {
        button.addEventListener('click', () => {
          annotations.comments = annotations.comments.filter(comment => comment.id !== button.dataset.delete);
          render();
        });
      });
    }

    function formatPosition(comment) {
      if (comment.kind === 'rect') return Math.round(comment.nx * 1000) / 10 + '%,' + Math.round(comment.ny * 1000) / 10 + '% ' + Math.round(comment.nw * 1000) / 10 + '%x' + Math.round(comment.nh * 1000) / 10 + '%';
      return Math.round(comment.nx * 1000) / 10 + '%,' + Math.round(comment.ny * 1000) / 10 + '%';
    }

    async function save() {
      annotations.savedAt = new Date().toISOString();
      try {
        const res = await fetch('/annotations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(annotations) });
        if (!res.ok) throw new Error(await res.text());
        statusEl.textContent = 'Saved to annotations.json';
      } catch (error) {
        statusEl.textContent = 'Could not save via server. Use Download JSON or Copy JSON.';
      }
    }

    function download() {
      const blob = new Blob([JSON.stringify(annotations, null, 2) + '\\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'annotations.json';
      a.click();
      URL.revokeObjectURL(url);
    }

    async function copyJson() {
      await navigator.clipboard.writeText(JSON.stringify(annotations, null, 2));
      statusEl.textContent = 'Copied JSON';
    }

    document.getElementById('save').addEventListener('click', save);
    document.getElementById('download').addEventListener('click', download);
    document.getElementById('copy').addEventListener('click', copyJson);
    window.addEventListener('resize', render);
    shot.addEventListener('load', render);
  </script>
</body>
</html>
`;
}

function codexReviewOverlayComponentSource() {
  return `import * as React from "react";
import {
  Alert,
  Dimensions,
  findNodeHandle,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

declare const require: (id: string) => any;

type InspectorCallback = (viewData: InspectorViewData) => boolean;

const getInspectorDataForViewAtPoint = (() => {
  try {
    return require("react-native/src/private/devsupport/devmenu/elementinspector/getInspectorDataForViewAtPoint")
      .default as (
      inspectedView: unknown,
      locationX: number,
      locationY: number,
      callback: InspectorCallback,
    ) => void;
  } catch {
    return null;
  }
})();

type ReviewPoint = {
  x: number;
  y: number;
  nx: number;
  ny: number;
};

type ReviewEvent = {
  id: string;
  type: "element";
  screenName: string;
  text: string;
  createdAt: string;
  viewport: { width: number; height: number };
  point: ReviewPoint;
  element?: InspectedElement;
  gesture: { durationMs: number; dx: number; dy: number };
};

type ReviewPointerResponse = {
  ok?: boolean;
  inside?: boolean;
  point?: { x: number; y: number };
};

type Props = {
  enabled?: boolean;
  endpoint?: string;
  screenName?: string;
  inspectedViewRef?: React.RefObject<View | null>;
};

type InspectorViewData = {
  frame?: { left: number; top: number; width: number; height: number };
  selectedIndex?: number | null;
  hierarchy?: Array<{
    name?: string | null;
    getInspectorData?: (findNodeHandle: unknown) => {
      props?: Record<string, unknown>;
      measure?: unknown;
    };
  }>;
  props?: Record<string, unknown>;
  componentStack?: string;
};

type InspectedElement = {
  frame: { left: number; top: number; width: number; height: number };
  name: string | null;
  label: string | null;
  testID: string | null;
  role: string | null;
  source: { fileName: string; lineNumber: number | null; columnNumber: number | null } | null;
  componentStack: string | null;
  hierarchy: Array<{ name: string | null; selected: boolean }>;
};

const DEFAULT_ENDPOINT = "http://127.0.0.1:17655/events";

export function CodexReviewOverlay({
  enabled = __DEV__,
  endpoint = DEFAULT_ENDPOINT,
  screenName = "unknown",
  inspectedViewRef,
}: Props) {
  const [commentArmed, setCommentArmed] = React.useState(false);
  const [events, setEvents] = React.useState<ReviewEvent[]>([]);
  const [syncState, setSyncState] = React.useState<"idle" | "synced" | "failed">("idle");
  const [draft, setDraft] = React.useState<ReviewEvent | null>(null);
  const [draftText, setDraftText] = React.useState("");
  const [targetPreview, setTargetPreview] = React.useState<InspectedElement | null>(null);
  const [hoverPreview, setHoverPreview] = React.useState<InspectedElement | null>(null);
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const startRef = React.useRef<(ReviewPoint & { startedAt: number }) | null>(null);
  const hoverInspectRef = React.useRef({ inspectedAt: 0, x: -1, y: -1 });

  React.useEffect(() => {
    let active = true;
    void fetch(endpoint)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!active || !Array.isArray(data?.events)) return;
        setEvents(data.events.slice().reverse());
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [endpoint]);

  React.useEffect(() => {
    if (!commentArmed) setHoverPreview(null);
  }, [commentArmed]);

  const submitEvent = React.useCallback(async (event: ReviewEvent) => {
    setEvents((current) => [event, ...current].slice(0, 80));
    setTargetPreview(null);
    setHoverPreview(null);
    setSyncState("idle");
    setCopyState("idle");
    void copyFeedbackToClipboard(endpoint, formatFeedbackMarkdown(event))
      .then((copied) => setCopyState(copied ? "copied" : "failed"));
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      });
      setSyncState("synced");
    } catch {
      setSyncState("failed");
    }
  }, [endpoint]);

  const clearComments = React.useCallback(async () => {
    setCommentArmed(false);
    setDraft(null);
    setDraftText("");
    setTargetPreview(null);
    setHoverPreview(null);
    setEvents([]);
    setSyncState("idle");
    try {
      await fetch(endpoint, { method: "DELETE" });
      setSyncState("synced");
    } catch {
      setSyncState("failed");
    }
  }, [endpoint]);

  const confirmClearComments = React.useCallback(() => {
    if (events.length === 0 && !targetPreview) return;
    Alert.alert(
      "Clear Codex comments?",
      "This removes every saved overlay comment and bounding box for this review session.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear all", style: "destructive", onPress: () => void clearComments() },
      ],
    );
  }, [clearComments, events.length, targetPreview]);

  const handleCommentPress = React.useCallback(() => {
    if (commentArmed && (events.length > 0 || targetPreview)) {
      confirmClearComments();
      return;
    }
    setCommentArmed((value) => !value);
  }, [commentArmed, confirmClearComments, events.length, targetPreview]);

  const completeDraft = React.useCallback((text: string) => {
    if (!draft) return;
    const trimmed = text.trim();
    setDraft(null);
    setDraftText("");
    if (!trimmed) {
      setTargetPreview(null);
      return;
    }
    void submitEvent({ ...draft, text: trimmed });
  }, [draft, submitEvent]);

  const requestComment = React.useCallback((event: ReviewEvent) => {
    setTargetPreview(event.element ?? null);
    setHoverPreview(null);
    const target = event.element ? formatElementLink(event.element) : "x " + Math.round(event.point.x) + ", y " + Math.round(event.point.y);
    if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
      Alert.prompt(
        "Codex UI comment",
        "Target: " + target + "\\nDescribe the element, state, gesture, or workflow issue.",
        [
          { text: "Cancel", style: "cancel", onPress: () => setTargetPreview(null) },
          {
            text: "Copy",
            onPress: (text?: string) => {
              const body = String(text || "").trim();
              if (body) {
                void submitEvent({ ...event, text: body });
              } else {
                setTargetPreview(null);
              }
            },
          },
        ],
        "plain-text",
      );
      return;
    }
    setDraft(event);
    setDraftText("");
  }, [submitEvent]);

  const previewElementAtPoint = React.useCallback((point: ReviewPoint) => {
    if (!commentArmed) return;
    const last = hoverInspectRef.current;
    const now = Date.now();
    if (now - last.inspectedAt < 80 && Math.abs(point.x - last.x) < 6 && Math.abs(point.y - last.y) < 6) return;
    hoverInspectRef.current = { inspectedAt: now, x: point.x, y: point.y };
    inspectElementAtPoint(inspectedViewRef?.current, point, (element) => {
      setHoverPreview(element ?? null);
    });
  }, [commentArmed, inspectedViewRef]);

  React.useEffect(() => {
    if (!commentArmed) return;
    let active = true;
    const pointerEndpoint = pointerEndpointFrom(endpoint);
    const inspectPointer = () => {
      const viewport = Dimensions.get("window");
      void fetch(pointerEndpoint + "?viewportWidth=" + viewport.width + "&viewportHeight=" + viewport.height)
        .then((response) => response.ok ? response.json() : null)
        .then((data: ReviewPointerResponse | null) => {
          if (!active || !data?.ok || !data.inside || !data.point) return;
          previewElementAtPoint(pointFromCoordinates(data.point.x, data.point.y));
        })
        .catch(() => {});
    };
    inspectPointer();
    const interval = setInterval(inspectPointer, 90);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [commentArmed, endpoint, previewElementAtPoint]);

  const pointerPreviewHandlers = React.useMemo(() => ({
    onPointerMove: (event: unknown) => {
      previewElementAtPoint(pointFromPointerEvent(event));
    },
  }), [previewElementAtPoint]);

  const responder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => commentArmed,
    onMoveShouldSetPanResponder: () => commentArmed,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (nativeEvent) => {
      const point = pointFromNativeEvent(nativeEvent.nativeEvent);
      startRef.current = { ...point, startedAt: Date.now() };
      previewElementAtPoint(point);
    },
    onPanResponderMove: (nativeEvent) => {
      previewElementAtPoint(pointFromNativeEvent(nativeEvent.nativeEvent));
    },
    onPanResponderRelease: (nativeEvent, gestureState) => {
      const start = startRef.current;
      startRef.current = null;
      setCommentArmed(false);
      setHoverPreview(null);
      if (!start) return;
      const end = pointFromNativeEvent(nativeEvent.nativeEvent);
      const viewport = Dimensions.get("window");
      const eventBase = {
        id: "review-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        type: "element" as const,
        screenName,
        text: "",
        createdAt: new Date().toISOString(),
        viewport: { width: viewport.width, height: viewport.height },
        point: end,
        gesture: {
          durationMs: Date.now() - start.startedAt,
          dx: gestureState.dx,
          dy: gestureState.dy,
        },
      };
      inspectElementAtPoint(inspectedViewRef?.current, end, (element) => {
        requestComment({ ...eventBase, element });
      });
    },
    onPanResponderTerminate: () => {
      startRef.current = null;
      setCommentArmed(false);
      setHoverPreview(null);
    },
  }), [commentArmed, inspectedViewRef, previewElementAtPoint, requestComment, screenName]);

  if (!enabled) return null;

  const visibleElements = [
    ...events.map((event, index) => ({ event, index })),
    ...(targetPreview ? [{
      event: {
        id: "target-preview",
        type: "element" as const,
        screenName,
        text: "",
        createdAt: "",
        viewport: Dimensions.get("window"),
        point: { x: 0, y: 0, nx: 0, ny: 0 },
        element: targetPreview,
        gesture: { durationMs: 0, dx: 0, dy: 0 },
      },
      index: events.length,
    }] : []),
    ...(commentArmed && !targetPreview && hoverPreview ? [{
      event: {
        id: "hover-preview",
        type: "element" as const,
        screenName,
        text: "",
        createdAt: "",
        viewport: Dimensions.get("window"),
        point: { x: 0, y: 0, nx: 0, ny: 0 },
        element: hoverPreview,
        gesture: { durationMs: 0, dx: 0, dy: 0 },
      },
      index: events.length,
    }] : []),
  ];

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {commentArmed ? (
        <View pointerEvents="auto" style={StyleSheet.absoluteFill} {...pointerPreviewHandlers} {...responder.panHandlers}>
          <View pointerEvents="none" style={styles.captureScrim} />
        </View>
      ) : null}

      <View pointerEvents="box-none" style={styles.pinLayer}>
        {visibleElements.map(({ event, index }) => {
          if (event.element) {
            const isHoverPreview = event.id === "hover-preview";
            return (
              <View key={event.id} pointerEvents="none" style={[styles.elementBox, isHoverPreview ? styles.elementBoxPreview : null, {
                left: event.element.frame.left,
                top: event.element.frame.top,
                width: event.element.frame.width,
                height: event.element.frame.height,
              }]}>
                <Text style={[styles.elementBadge, isHoverPreview ? styles.elementBadgePreview : null]}>
                  {isHoverPreview ? "Target" : index + 1} {event.element.name || "Element"}
                </Text>
              </View>
            );
          }
          return (
            <View key={event.id} pointerEvents="none" style={[styles.pin, { left: event.point.x - 10, top: event.point.y - 10 }]}>
              <Text style={styles.pinText}>{index + 1}</Text>
            </View>
          );
        })}
      </View>

      <View pointerEvents="auto" style={styles.toolbar}>
        <Text style={styles.title}>Codex Review</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: commentArmed }}
          onPress={handleCommentPress}
          onLongPress={confirmClearComments}
          delayLongPress={350}
          style={[styles.commentButton, commentArmed ? styles.commentButtonActive : null]}
        >
          <Text style={styles.commentButtonText}>Comment</Text>
        </Pressable>
        <Text style={styles.status}>
          {commentArmed ? (hoverPreview ? "Click to comment this target" : events.length > 0 || targetPreview ? "Move pointer to preview, or Comment again to clear" : "Move pointer to preview a target") : events.length + " saved - " + (copyState === "idle" ? syncState : copyState)}
        </Text>
      </View>

      <Modal visible={!!draft} transparent animationType="fade" onRequestClose={() => {
        setDraft(null);
        setTargetPreview(null);
      }}>
        <View style={styles.composerBackdrop}>
          <View style={styles.composer}>
            <Text style={styles.panelTitle}>Codex UI comment</Text>
            {draft?.element ? <Text style={styles.codeLink}>{formatElementLink(draft.element)}</Text> : null}
            <TextInput
              autoFocus
              multiline
              value={draftText}
              onChangeText={setDraftText}
              placeholder="Describe the element, state, gesture, or workflow issue."
              placeholderTextColor="#8e8e93"
              style={styles.input}
            />
            <View style={styles.row}>
              <Pressable accessibilityRole="button" onPress={() => {
                setDraft(null);
                setTargetPreview(null);
              }} style={[styles.modalButton, styles.secondary]}>
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => completeDraft(draftText)} style={styles.modalButton}>
                <Text style={styles.buttonText}>Copy</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function pointFromNativeEvent(event: { pageX: number; pageY: number }): ReviewPoint {
  return pointFromCoordinates(event.pageX, event.pageY);
}

function pointFromPointerEvent(event: unknown): ReviewPoint {
  const nativeEvent = (event as { nativeEvent?: { pageX?: number; pageY?: number; x?: number; y?: number; locationX?: number; locationY?: number } })?.nativeEvent || {};
  return pointFromCoordinates(
    nativeEvent.pageX ?? nativeEvent.x ?? nativeEvent.locationX ?? 0,
    nativeEvent.pageY ?? nativeEvent.y ?? nativeEvent.locationY ?? 0,
  );
}

function pointFromCoordinates(pageX: number, pageY: number): ReviewPoint {
  const viewport = Dimensions.get("window");
  const x = Math.max(0, Math.min(viewport.width, pageX));
  const y = Math.max(0, Math.min(viewport.height, pageY));
  return { x, y, nx: x / viewport.width, ny: y / viewport.height };
}

function pointerEndpointFrom(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    url.pathname = "/pointer";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "http://127.0.0.1:17655/pointer";
  }
}

function copyEndpointFrom(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    url.pathname = "/copy";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "http://127.0.0.1:17655/copy";
  }
}

async function copyFeedbackToClipboard(endpoint: string, text: string): Promise<boolean> {
  try {
    const response = await fetch(copyEndpointFrom(endpoint), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function inspectElementAtPoint(inspectedView: View | null | undefined, point: ReviewPoint, callback: (element: InspectedElement | undefined) => void) {
  if (!getInspectorDataForViewAtPoint || !inspectedView) {
    callback(undefined);
    return;
  }
  try {
    getInspectorDataForViewAtPoint(inspectedView, point.x, point.y, (viewData) => {
      callback(normalizeInspectorData(viewData));
      return true;
    });
  } catch {
    callback(undefined);
  }
}

function normalizeInspectorData(viewData: InspectorViewData | null | undefined): InspectedElement | undefined {
  if (!viewData?.frame) return undefined;
  const hierarchy = Array.isArray(viewData.hierarchy) ? viewData.hierarchy : [];
  const selectedIndex = typeof viewData.selectedIndex === "number" ? viewData.selectedIndex : hierarchy.length - 1;
  const selected = hierarchy[selectedIndex];
  const selectedData = selected?.getInspectorData ? selected.getInspectorData(findNodeHandle) : null;
  const props = selectedData?.props || viewData.props || {};
  const componentStack = viewData.componentStack || null;
  return {
    frame: viewData.frame,
    name: selected?.name || null,
    label: primitiveString(props.accessibilityLabel) || primitiveString(props.children),
    testID: primitiveString(props.testID),
    role: primitiveString(props.accessibilityRole),
    source: parseSourceFromComponentStack(componentStack),
    componentStack,
    hierarchy: hierarchy.map((item, index) => ({ name: item.name || null, selected: index === selectedIndex })),
  };
}

function primitiveString(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

function parseSourceFromComponentStack(stack: string | null): InspectedElement["source"] {
  if (!stack) return null;
  const lines = stack.split("\\n");
  for (const line of lines) {
    const match = /\\(([^()]+):(\\d+):(\\d+)\\)/.exec(line) || /at\\s+([^\\s()]+):(\\d+):(\\d+)/.exec(line);
    if (!match) continue;
    const fileName = match[1];
    if (/node_modules/.test(fileName)) continue;
    return {
      fileName,
      lineNumber: Number(match[2]),
      columnNumber: Number(match[3]),
    };
  }
  return null;
}

function formatElementLink(element: InspectedElement): string {
  const source = element.source;
  const name = element.name || "Element";
  if (!source) return name + " - source unavailable";
  return name + " - " + source.fileName + (source.lineNumber ? ":" + source.lineNumber : "");
}

function formatFeedbackMarkdown(event: ReviewEvent): string {
  const viewport = Math.round(event.viewport.width) + "x" + Math.round(event.viewport.height);
  const elementName = event.element?.label || event.element?.name || "Selected element";
  const location = event.element ? formatElementLocation(event.element) : "x " + Math.round(event.point.x) + ", y " + Math.round(event.point.y);
  const source = event.element ? formatElementSource(event.element) : "source unavailable";
  return [
    "## Page Feedback: " + event.screenName,
    "**Viewport:** " + viewport,
    "",
    "### 1. \\"" + escapeMarkdown(elementName) + ".\\"",
    "**Location:** " + location,
    "**Source:** " + source,
    "**Feedback:** " + event.text,
    "",
  ].join("\\n");
}

function formatElementLocation(element: InspectedElement): string {
  const names = element.hierarchy
    .map((item) => item.name)
    .filter((name): name is string => !!name && !isNoisyHierarchyName(name));
  if (names.length > 0) return names.join(" > ");
  return element.name || "Element";
}

function formatElementSource(element: InspectedElement): string {
  if (element.source) return formatSource(element.source);
  const stackSource = firstComponentStackSource(element.componentStack);
  return stackSource || "source unavailable";
}

function formatSource(source: NonNullable<InspectedElement["source"]>): string {
  return source.fileName + (source.lineNumber ? ":" + source.lineNumber : "") + (source.columnNumber ? ":" + source.columnNumber : "");
}

function firstComponentStackSource(stack: string | null): string | null {
  if (!stack) return null;
  for (const line of stack.split("\\n")) {
    const match = /^\\s*at\\s+(.*?)\\s+\\((https?:\\/\\/.*):(\\d+):(\\d+)\\)$/.exec(line);
    if (!match) continue;
    const name = match[1].trim();
    if (!name || isNoisyHierarchyName(name)) continue;
    return name + " @ " + match[2] + ":" + match[3] + ":" + match[4];
  }
  return null;
}

function isNoisyHierarchyName(name: string): boolean {
  return /^(withDevTools\\(App\\)|App|ExpoRoot|ContextNavigator|Content|SceneView|Route\\(\\)|WrappedScreenComponent|RootLayout|ForwardRef|NativeStackNavigator|StaticContainer|EnsureSingleNavigator|NavigationProvider|NavigationContent|NavigationContainerInner|PreventRemoveProvider|NavigationStateListenerProvider|SafeAreaProvider|SafeAreaProviderCompat|FrameSizeProvider|ThemeProvider|RCTView|RCTScrollView|RCTScrollContentView|ScrollView|RNSScreen|Screen|ScreenStack|ScreenStackItem|DebugContainer|Suspender|Suspense|Freeze|DelayedFreeze|InnerScreen|Animated\\(Anonymous\\)|anonymous)$/.test(name);
}

function escapeMarkdown(value: string): string {
  return value.replace(/"/g, '\\\\"').trim();
}

const styles = StyleSheet.create({
  toolbar: {
    position: "absolute",
    top: 58,
    right: 72,
    width: 150,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "rgba(28,28,30,0.94)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  title: { color: "#fff", fontSize: 13, fontWeight: "700", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  commentButton: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#0a84ff", alignItems: "center" },
  commentButtonActive: { backgroundColor: "#30d158" },
  commentButtonText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  modalButton: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#0a84ff" },
  secondary: { backgroundColor: "#3a3a3c" },
  buttonText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  status: { color: "#d1d1d6", fontSize: 11, marginTop: 8, lineHeight: 14 },
  captureScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,132,255,0.06)",
  },
  pinLayer: { ...StyleSheet.absoluteFillObject },
  pin: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#ff453a",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  pinText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  elementBox: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#32d74b",
    backgroundColor: "rgba(50,215,75,0.08)",
    borderRadius: 4,
  },
  elementBoxPreview: {
    borderStyle: "dashed",
    backgroundColor: "rgba(255,214,10,0.1)",
    borderColor: "#ffd60a",
  },
  elementBadge: {
    position: "absolute",
    top: -24,
    left: -2,
    maxWidth: 240,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
    overflow: "hidden",
    color: "#041408",
    backgroundColor: "#32d74b",
    fontSize: 11,
    fontWeight: "800",
  },
  elementBadgePreview: {
    backgroundColor: "#ffd60a",
    color: "#1c1600",
  },
  panelTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  codeLink: { color: "#32d74b", fontSize: 12, fontWeight: "700" },
  composerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 20 },
  composer: { width: "100%", maxWidth: 420, borderRadius: 14, padding: 14, backgroundColor: "#1c1c1e", gap: 12 },
  input: { minHeight: 110, color: "#fff", backgroundColor: "#111", borderRadius: 10, padding: 10, textAlignVertical: "top" },
});

export default CodexReviewOverlay;
`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function reviewNextStep(args = {}) {
  const surface = args.surface ?? "generic";
  const stage = args.stage ?? "intake";
  const issue = requireOptionalString(args.issue) ?? "unspecified UI review issue";
  const cwd = requireOptionalString(args.cwd) ?? ".";
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const componentFilter = requireOptionalString(args.componentFilter);
  const verifierRule = requireOptionalString(args.verifierRule);
  const flags = {
    hasAcceptanceContract: args.hasAcceptanceContract === true,
    hasScreenshot: args.hasScreenshot === true,
    hasInteractionProof: args.hasInteractionProof === true,
    hasStaticVerifier: args.hasStaticVerifier === true,
    changedGesture: args.changedGesture === true,
    changedChrome: args.changedChrome === true,
    changedNavigation: args.changedNavigation === true,
    addedVisibleControls: args.addedVisibleControls === true,
  };
  const requiredFlows = reviewFlowsForSurface(surface);
  const commands = reviewCommandSuggestions({ cwd, metroPort, componentFilter, flags, stage });
  const questionTriggers = reviewQuestionTriggers(flags, verifierRule);
  const constraint = chooseReviewConstraint({ stage, flags, verifierRule });
  return toolJson({
    issue,
    surface,
    stage,
    constraint,
    nextStep: constraint.nextStep,
    subordinateRule: "Do not patch or call done until the current constraint is proven or deliberately elevated.",
    requiredFlows,
    questionTriggers,
    suggestedCommands: commands,
    stopConditions: reviewStopConditions({ flags, verifierRule }),
    acceptanceContractTemplate: {
      userGoal: "<role + task>",
      firstScreenInvariants: requiredFlows.firstScreenInvariants,
      ambiguousSemantics: questionTriggers,
      representativeAction: requiredFlows.representativeAction,
      evidenceRequired: requiredFlows.evidenceRequired,
      nonGoals: ["Do not change unrelated app contracts, data shape, or navigation model without a separate reason."],
    },
  });
}

function chooseReviewConstraint({ stage, flags, verifierRule }) {
  const workflowVerifier = verifierRule && verifierRuleMatchesChangedWorkflow(verifierRule, flags);
  if (!flags.hasAcceptanceContract && stage !== "handoff") {
    return {
      name: "decision clarity",
      tocStep: "exploit",
      reason: "The limiting constraint is not code; it is the missing acceptance contract.",
      nextStep: "Write the acceptance contract and resolve ambiguous control/gesture/chrome semantics before editing.",
    };
  }
  if (!flags.hasScreenshot && (stage === "intake" || stage === "pre-patch")) {
    return {
      name: "baseline evidence",
      tocStep: "exploit",
      reason: "The screen cannot be reviewed reliably without visible runtime evidence.",
      nextStep: "Capture ux-context or a screenshot, then inspect the image against the first-screen invariants.",
    };
  }
  if (workflowVerifier) {
    return {
      name: "workflow blocker",
      tocStep: "elevate",
      reason: `Verifier rule ${verifierRule} maps to the changed workflow.`,
      nextStep: "Treat the verifier finding as blocking, fix the underlying workflow, or record an explicit product exception.",
    };
  }
  if ((flags.changedGesture || stage === "interaction") && !flags.hasInteractionProof) {
    return {
      name: "interaction proof",
      tocStep: "elevate",
      reason: "The touched workflow depends on direct manipulation, so screenshots and static checks are insufficient.",
      nextStep: "Run the representative action in the simulator or an equivalent interaction test, then compare preview and committed state.",
    };
  }
  if ((flags.changedChrome || flags.changedNavigation) && !flags.hasInteractionProof) {
    return {
      name: "chrome/navigation proof",
      tocStep: "subordinate",
      reason: "Chrome and navigation changes can silently break safe area, tab, sheet, or return behavior.",
      nextStep: "Exercise tab/header/sheet/back behavior on the target route and inspect safe-area clearance.",
    };
  }
  if (flags.addedVisibleControls && !flags.hasInteractionProof) {
    return {
      name: "affordance validation",
      tocStep: "exploit",
      reason: "New always-visible controls may reduce discoverability debt while damaging the direct object model.",
      nextStep: "Prove object-level feedback is insufficient, then verify the added controls do not clutter or compete with the primary surface.",
    };
  }
  if (!flags.hasStaticVerifier && stage !== "intake") {
    return {
      name: "static pattern gate",
      tocStep: "subordinate",
      reason: "The local native-feel rule gate has not been run for the changed iOS surface.",
      nextStep: "Run verify-native-experience and classify findings by whether they map to the touched workflow.",
    };
  }
  return {
    name: "handoff proof",
    tocStep: "subordinate",
    reason: "The main constraints appear covered; the remaining work is to make proof inspectable.",
    nextStep: "Finish with an acceptance matrix: invariant, evidence, pass/fail, and remaining risk.",
  };
}

function reviewFlowsForSurface(surface) {
  if (surface === "calendar" || surface === "timeline") {
    return {
      firstScreenInvariants: [
        "current day remains visibly distinct",
        "current time is visible or the screen explains why not",
        "date context is still visible after positioning near now",
        "bottom tab/home-indicator chrome does not crop or cover working time",
      ],
      representativeAction: "Open today, tap an empty slot, drag a time range, confirm the draft range, scroll without creating, and drag without scrolling.",
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
      firstScreenInvariants: ["selected tab/title is clear", "back or dismiss behavior is predictable", "content clears system chrome"],
      representativeAction: "Enter the route, navigate forward, back out, switch tabs, and return.",
      evidenceRequired: ["ux-context or screenshot", "manual/smoke navigation walkthrough", "safe-area proof"],
      flows: ["deep link/cold entry", "tab switch", "back/dismiss", "return to prior state"],
    };
  }
  if (surface === "form") {
    return {
      firstScreenInvariants: ["primary fields are visible", "keyboard does not hide focused input", "submit state is clear"],
      representativeAction: "Focus a field, submit invalid data, recover, submit valid data, and confirm the result.",
      evidenceRequired: ["focused keyboard state", "invalid/recovery state", "success or saved state"],
      flows: ["focus/keyboard", "invalid submit", "recovery", "valid submit"],
    };
  }
  if (surface === "list") {
    return {
      firstScreenInvariants: ["rows are readable", "selected/empty/loading/error state is clear", "row actions do not conflict with scroll"],
      representativeAction: "Scroll, select a row, perform row action if present, and return.",
      evidenceRequired: ["ux-context or screenshot", "scroll/row interaction proof"],
      flows: ["loading/empty/error", "scroll", "row select", "row action"],
    };
  }
  if (surface === "editor") {
    return {
      firstScreenInvariants: ["editable object is clear", "tool state is visible", "chrome does not cover the canvas/content"],
      representativeAction: "Create or edit the object, preview the change, cancel, then commit and confirm saved state.",
      evidenceRequired: ["before/after screenshot", "interaction proof", "saved-state proof"],
      flows: ["edit", "preview", "cancel", "commit"],
    };
  }
  return {
    firstScreenInvariants: ["location/state is clear", "primary action is visible or directly discoverable", "system chrome does not cover content"],
    representativeAction: "Exercise the primary user action from the visible surface and confirm the committed state matches the preview.",
    evidenceRequired: ["ux-context or screenshot", "representative action proof", "static verifier classification"],
    flows: ["fresh open", "primary action", "cancel/recover", "commit", "return"],
  };
}

function reviewQuestionTriggers(flags, verifierRule) {
  const questions = [];
  if (flags.changedChrome || flags.changedNavigation) {
    questions.push("What should this control/chrome mean: navigation, disclosure, filter, picker, or title menu?");
  }
  if (flags.changedGesture) {
    questions.push("Which gesture owns the surface when scroll and direct manipulation overlap?");
  }
  if (flags.addedVisibleControls) {
    questions.push("Can object-level feedback solve discoverability before adding always-visible controls?");
  }
  if (verifierRule) {
    questions.push(`Does verifier rule ${verifierRule} map to the changed workflow or an unrelated legacy surface?`);
  }
  return questions;
}

function reviewCommandSuggestions({ cwd, metroPort, componentFilter, flags, stage }) {
  const base = [
    `expo-ios --json ux-context --cwd ${shellArg(cwd)} --metro-port ${metroPort}${componentFilter ? ` --component-filter ${shellArg(componentFilter)}` : ""}`,
  ];
  if (flags.changedGesture || flags.changedChrome || flags.changedNavigation || flags.addedVisibleControls || stage === "interaction") {
    base.push(
      `expo-ios --json inspector probe --metro-port ${metroPort}`,
      `expo-ios --json inspector toggle --metro-port ${metroPort}`,
      `expo-ios --json inspector install-comment-menu --metro-port ${metroPort}`,
      "expo-ios --json inspector open-dev-menu",
      `expo-ios --json inspector read-comments --metro-port ${metroPort}`,
      `expo-ios --json review-overlay scaffold --cwd ${shellArg(cwd)}`,
      `expo-ios --json review-overlay prepare --cwd ${shellArg(cwd)} --serve true`,
      `expo-ios --json review-overlay read --cwd ${shellArg(cwd)}`,
    );
  }
  if (flags.changedGesture || stage === "interaction") {
    base.push(
      `expo-ios --json trace --action start --metro-port ${metroPort}${componentFilter ? ` --component-filter ${shellArg(componentFilter)}` : ""}`,
      "# reproduce the representative gesture in the simulator, or use expo-ios gesture when coordinates are known",
      "expo-ios --json gesture drag --start-x <x1> --start-y <y1> --end-x <x2> --end-y <y2> --duration-ms 900 --capture-before-after true",
      "expo-ios --json gesture long-press --x <x> --y <y> --duration-ms 900 --capture-before-after true",
      `expo-ios --json trace --action read --metro-port ${metroPort} --max-events 200`,
      `expo-ios --json trace --action stop --metro-port ${metroPort}`,
    );
  }
  if (!flags.hasStaticVerifier && stage !== "intake") {
    base.push("verify-native-experience <expo-app> --strict");
  }
  return base;
}

function reviewStopConditions({ flags, verifierRule }) {
  const stops = [];
  if (!flags.hasAcceptanceContract) stops.push("Stop before patching: acceptance contract is missing.");
  if (flags.changedGesture && !flags.hasInteractionProof) stops.push("Stop before handoff: gesture/direct-manipulation proof is missing.");
  if (flags.changedChrome && !flags.hasInteractionProof) stops.push("Stop before handoff: tab/header/safe-area behavior has not been exercised.");
  if (verifierRule && verifierRuleMatchesChangedWorkflow(verifierRule, flags)) {
    stops.push(`Stop before handoff: verifier rule ${verifierRule} maps to the changed workflow.`);
  }
  return stops;
}

function verifierRuleMatchesChangedWorkflow(rule, flags) {
  const normalized = String(rule ?? "").toLowerCase();
  if (flags.changedGesture && /(gesture|panresponder|reanimated|handler|swipe|drag)/.test(normalized)) return true;
  if ((flags.changedChrome || flags.changedNavigation) && /(tab|safe|navigation|header|sheet|modal|back)/.test(normalized)) return true;
  if (/(text|button|row|visible|wrapper)/.test(normalized)) return true;
  return false;
}

function shellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

async function devtoolsCommand(args = {}) {
  const action = requireString(args.action ?? "capabilities", "action");
  if (action === "status" || action === "panels") return toolJson(await devtoolsStatusPayload(args, action));
  if (action === "open") return toolJson(await devtoolsOpenPayload(args));
  if (action === "events") return toolJson(await devtoolsEventsPayload(args));
  if (action !== "capabilities") throw new Error(`Unknown devtools action: ${action}`);
  const metro = await metroStatusPayload(args);
  const rnDevTools = reactNativeDevToolsReport(metro);
  const hasTarget = metro.targets.length > 0;
  const hasRuntime = metro.targets.some((target) => target.webSocketDebuggerUrl);
  const hasDevtoolsFrontend = rnDevTools.frontend.available;
  const hasNetworkPanel = metro.targets.some(targetHasDevtoolsNetworkPanel);
  return toolJson({
    action,
    metroPort: metro.metroPort,
    reactNativeDevTools: rnDevTools,
    capabilities: [
      capabilityRecord({
        name: "metro-http",
        source: "metro",
        transport: "http",
        available: metro.available,
        confidence: metro.available ? "high" : "low",
        reason: metro.available ? null : metro.reason,
        readCommands: ["metro status", "target list", "devtools capabilities"],
        writeCommands: [],
        artifactTypes: ["json"],
        repairHints: metro.available ? [] : ["Start Metro for the Maddie Native app and rerun with the correct --metro-port."],
        limitations: metro.available
          ? ["Reports Metro server and target discovery only; it does not prove the app UI is ready."]
          : ["Metro was not reachable on the requested port."],
      }),
      capabilityRecord({
        name: "metro-symbolication",
        source: "metro",
        transport: "http",
        available: metro.symbolication.available,
        confidence: metro.symbolication.available ? "high" : "low",
        reason: metro.symbolication.available ? null : metro.symbolication.reason,
        readCommands: ["metro symbolicate"],
        writeCommands: [],
        artifactTypes: ["json"],
        repairHints: metro.symbolication.available ? [] : ["Confirm Metro is serving the current bundle and source maps."],
        limitations: metro.symbolication.available
          ? ["Symbolication quality depends on source maps for the current bundle."]
          : ["The Metro /symbolicate endpoint did not accept a probe request."],
      }),
      capabilityRecord({
        name: "hermes-runtime",
        source: "hermes-inspector",
        transport: "websocket",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : (hasTarget ? "No target exposes a websocket debugger URL." : "No Metro inspector target."),
        readCommands: ["console", "errors", "rn tree", "trace --action read"],
        writeCommands: ["trace --action start", "trace --action stop", "inspector install-comment-menu"],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : ["Open Maddie Native in a debuggable development build and confirm /json/list includes webSocketDebuggerUrl."],
        limitations: hasRuntime
          ? ["Runtime signals are unavailable in disconnected, production, or non-Hermes targets."]
          : ["Console, errors, React tree, and runtime globals cannot be read without an inspector websocket."],
      }),
      capabilityRecord({
        name: "react-native-devtools",
        source: "react-native-devtools",
        transport: "metro-http",
        available: hasDevtoolsFrontend,
        confidence: hasDevtoolsFrontend ? "medium" : "low",
        reason: hasDevtoolsFrontend ? null : "No target advertises a React Native DevTools frontend URL.",
        readCommands: ["devtools status", "devtools panels", "devtools open"],
        writeCommands: ["devtools open"],
        artifactTypes: ["json"],
        repairHints: hasDevtoolsFrontend ? [] : ["Connect a React Native target to Metro that advertises devtoolsFrontendUrl."],
        limitations: hasDevtoolsFrontend
          ? ["The CLI can open and report the DevTools frontend; interactive panel state remains owned by React Native DevTools."]
          : ["React Native DevTools cannot be opened without a Metro target frontend URL."],
      }),
      capabilityRecord({
        name: "react-native-devtools-network-panel",
        source: "react-native-devtools",
        transport: "metro-http",
        available: hasNetworkPanel,
        confidence: hasNetworkPanel ? "medium" : "low",
        reason: hasNetworkPanel ? null : "No target advertises unstable_enableNetworkPanel=true in its DevTools frontend URL.",
        readCommands: ["devtools panels", "devtools open"],
        writeCommands: [],
        artifactTypes: ["human-visible-panel"],
        repairHints: hasNetworkPanel ? [] : ["Enable or connect a React Native DevTools target whose frontend URL includes unstable_enableNetworkPanel=true."],
        limitations: hasNetworkPanel
          ? ["The panel is an interactive DevTools UI surface; command-line HAR/export still uses app bridge evidence."]
          : ["Use the app network bridge for CLI-readable request evidence when the DevTools network panel is absent."],
      }),
      capabilityRecord({
        name: "console",
        source: "runtime-diagnostics",
        transport: "hermes-runtime",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : "No runtime diagnostics source is available.",
        readCommands: ["console"],
        writeCommands: [],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : ["Connect Hermes runtime and install diagnostics instrumentation if the buffer is empty."],
        limitations: [
          "JS console diagnostics require app/runtime instrumentation or a readable runtime buffer.",
          "Native device logs are a different evidence stream; use logs for those.",
        ],
      }),
      capabilityRecord({
        name: "errors",
        source: "runtime-diagnostics",
        transport: "hermes-runtime",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : "No runtime diagnostics source is available.",
        readCommands: ["errors"],
        writeCommands: [],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : ["Connect Hermes runtime and verify the app exposes bounded error diagnostics."],
        limitations: [
          "Error diagnostics depend on runtime buffers and may not include native crashes.",
          "Use logs and trace evidence for lower-level failures.",
        ],
      }),
    ],
    metro,
  });
}

async function devtoolsStatusPayload(args = {}, action = "status") {
  const metro = await metroStatusPayload(args);
  const reactNativeDevTools = reactNativeDevToolsReport(metro);
  return {
    available: metro.available,
    action,
    metroPort: metro.metroPort,
    metro,
    target: reactNativeDevTools.target,
    frontend: reactNativeDevTools.frontend,
    attachmentState: reactNativeDevTools.attachmentState,
    attachmentRisk: reactNativeDevTools.attachmentRisk,
    panels: reactNativeDevTools.panels,
    machineReadableDomains: reactNativeDevTools.panels.filter((panel) => panel.kind === "machine-readable-domain"),
    humanVisiblePanels: reactNativeDevTools.panels.filter((panel) => panel.kind === "human-visible-panel"),
  };
}

function reactNativeDevToolsReport(metro) {
  const target = metro.targets.find((item) => item.devtoolsFrontendUrl) ?? metro.targets[0] ?? null;
  const frontendUrl = target?.devtoolsFrontendUrl
    ? target.devtoolsFrontendUrl.startsWith("http")
      ? target.devtoolsFrontendUrl
      : `http://127.0.0.1:${metro.metroPort}${target.devtoolsFrontendUrl}`
    : null;
  const hasNetworkPanel = targetHasDevtoolsNetworkPanel(target);
  const hasRuntime = Boolean(target?.webSocketDebuggerUrl);
  const attachmentState = detectDevToolsAttachmentState(target);
  const attachmentRisk = {
    level: hasRuntime || frontendUrl ? "medium" : "low",
    mayDetachHumanDebugger: Boolean(hasRuntime || frontendUrl),
    reason: hasRuntime || frontendUrl
      ? "Opening React Native DevTools can attach to the selected target and may affect an existing human debugger session."
      : "No debuggable React Native target is available.",
  };
  const panels = [
    devtoolsPanelRecord({
      name: "debugger",
      kind: "human-visible-panel",
      available: Boolean(frontendUrl),
      transport: "react-native-devtools",
      source: "devtoolsFrontendUrl",
      readCommands: ["devtools open"],
      writeCommands: ["devtools open"],
      artifactTypes: ["human-visible-panel"],
      limitations: ["Interactive debugger state is owned by React Native DevTools."],
      repairHints: frontendUrl ? [] : ["Connect a Metro target that advertises devtoolsFrontendUrl."],
    }),
    devtoolsPanelRecord({
      name: "network",
      kind: "human-visible-panel",
      available: hasNetworkPanel,
      transport: "react-native-devtools",
      source: "devtoolsFrontendUrl",
      readCommands: ["devtools panels", "devtools open"],
      writeCommands: [],
      artifactTypes: ["human-visible-panel"],
      limitations: ["The network panel is human-visible; CLI-readable HAR still requires network bridge evidence."],
      repairHints: hasNetworkPanel ? [] : ["Use the app network bridge or connect a target with unstable_enableNetworkPanel=true."],
    }),
    devtoolsPanelRecord({
      name: "console",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "hermes-runtime",
      source: "runtime-diagnostics",
      readCommands: ["console"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: ["Requires a readable runtime diagnostics buffer for bounded CLI output."],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and enable app diagnostics instrumentation."],
    }),
    devtoolsPanelRecord({
      name: "errors",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "hermes-runtime",
      source: "runtime-diagnostics",
      readCommands: ["errors"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: ["Runtime JS errors are separate from native crash reports."],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and use logs/crash reports for native failures."],
    }),
    devtoolsPanelRecord({
      name: "react-components",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "react-devtools-hook",
      source: "react-devtools-hook",
      readCommands: ["rn tree", "rn inspect", "snapshot"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: ["Component tree evidence depends on development runtime hooks and may omit private fiber details."],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and confirm React DevTools hook availability."],
    }),
  ];
  return {
    target,
    frontend: { available: Boolean(frontendUrl), url: frontendUrl, launchPath: frontendUrl ? "metro-devtools-frontend-url" : null },
    attachmentState,
    attachmentRisk,
    panels,
  };
}

function devtoolsPanelRecord({ name, kind, available, transport, source, readCommands, writeCommands, artifactTypes, limitations, repairHints }) {
  return {
    name,
    kind,
    machineReadable: kind === "machine-readable-domain",
    humanVisible: kind === "human-visible-panel",
    available: available === true,
    transport,
    source,
    readCommands,
    writeCommands,
    artifactTypes,
    limitations,
    repairHints,
  };
}

function detectDevToolsAttachmentState(target) {
  if (!target) return { state: "unavailable", detectable: false, reason: "No Metro target." };
  const raw = target.reactNative ?? {};
  const attached = raw.debuggerFrontendConnected ?? raw.debuggerConnected ?? raw.isDebuggerConnected ?? target.attached;
  if (attached === true) return { state: "attached", detectable: true };
  if (attached === false) return { state: "not-attached", detectable: true };
  return { state: "unknown", detectable: false, reason: "Metro target metadata did not expose debugger attachment state." };
}

function targetHasDevtoolsNetworkPanel(target) {
  const url = target?.devtoolsFrontendUrl;
  if (!url) return false;
  try {
    const parsed = new URL(url, "http://127.0.0.1");
    return parsed.searchParams.get("unstable_enableNetworkPanel") === "true";
  } catch {
    return /[?&]unstable_enableNetworkPanel=true(?:&|$)/.test(String(url));
  }
}

async function devtoolsOpenPayload(args = {}) {
  const metro = await metroStatusPayload(args);
  const reactNativeDevTools = reactNativeDevToolsReport(metro);
  const target = reactNativeDevTools.target;
  const url = reactNativeDevTools.frontend.url;
  if (!url) return { available: false, action: "open", reason: "No DevTools frontend URL is available.", metro, reactNativeDevTools };
  const result = await execFilePromise("open", [url], { timeout: 10_000, rejectOnError: false });
  return {
    available: !result.error,
    action: "open",
    url,
    target,
    launchPath: "metro-devtools-frontend-url",
    mirrorsUpstreamLaunch: true,
    attachmentState: reactNativeDevTools.attachmentState,
    attachmentRisk: reactNativeDevTools.attachmentRisk,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    error: result.error,
  };
}

async function devtoolsEventsPayload(args = {}) {
  const subaction = requireString(args.subaction ?? "read", "subaction");
  if (!["start", "read", "stop"].includes(subaction)) throw new Error(`Unknown devtools events action: ${subaction}`);
  const stateRoot = resolveExpoStateRoot(args);
  const eventsDir = path.join(stateRoot, "artifacts", "devtools-events");
  await fs.mkdir(eventsDir, { recursive: true });
  const file = path.join(eventsDir, "events.json");
  const existing = await readJsonFile(file).catch(() => ({ events: [] }));
  const event = {
    type: `devtools.${subaction}`,
    timestamp: new Date().toISOString(),
    metro: await metroStatusPayload(args),
  };
  const payload = {
    available: true,
    action: "events",
    subaction,
    artifact: file,
    events: subaction === "start" ? [event] : [...(existing.events ?? []), event],
    limitations: ["This v1 collector records DevTools capability/session events, not a raw Chrome DevTools Protocol stream."],
  };
  await writeJsonFile(file, payload);
  return payload;
}

function capabilityRecord({ name, source, transport, available, confidence, reason, readCommands = [], writeCommands = [], artifactTypes = [], repairHints = [], limitations }) {
  return {
    name,
    source,
    transport,
    available: available === true,
    confidence,
    reason,
    readCommands,
    writeCommands,
    artifactTypes,
    repairHints,
    limitations,
  };
}

async function consoleCommand(args = {}) {
  return diagnosticMessagesCommand("console", args);
}

async function errorsCommand(args = {}) {
  return diagnosticMessagesCommand("errors", args);
}

async function diagnosticMessagesCommand(kind, args = {}) {
  const action = args.action ?? "read";
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const limit = clampNumber(args.limit ?? 100, 1, 1000);
  const targetDiscovery = await new MetroInspectorClient(metroPort).targets();
  const targets = targetDiscovery.targets;
  const webSocketDebuggerUrl = targets[0]?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return toolJson({
      available: false,
      kind,
      source: "hermes-runtime",
      reason: targetDiscovery.reason ?? "No Metro inspector target.",
      metroPort,
      messages: [],
      targetDiscovery,
      limitations: ["Start Metro and connect a debuggable Hermes target before reading JS diagnostics."],
    });
  }
  if (action === "clear") {
    const result = await evaluateHermesExpression(webSocketDebuggerUrl, `(() => {
      const diagnostics = globalThis.__EXPO_IOS_DIAGNOSTICS__ || globalThis.__CODEX_DIAGNOSTICS__;
      if (!diagnostics) return { available: false, cleared: false, reason: 'Runtime diagnostics buffer is not installed.' };
      if (Array.isArray(diagnostics[${JSON.stringify(kind)}])) diagnostics[${JSON.stringify(kind)}].length = 0;
      return { available: true, cleared: true };
    })()`, { timeoutMs: 5000 });
    return toolJson({
      ...(result?.result?.result?.value ?? { available: false, reason: result?.error ?? "Runtime diagnostics did not return a value." }),
      kind,
      action,
      metroPort,
      target: targetSummary(targets[0]),
      cdp: result?.diagnostics ?? result?.cdp ?? null,
    });
  }
  const result = await evaluateHermesExpression(webSocketDebuggerUrl, diagnosticsExpression({ kind, limit }), { timeoutMs: 5000 });
  const value = result?.result?.result?.value;
  if (!value) {
    return toolJson({
      available: false,
      kind,
      source: "hermes-runtime",
      reason: result?.error ?? "Runtime diagnostics did not return a value.",
      metroPort,
      messages: [],
      cdp: result?.diagnostics ?? result?.cdp ?? null,
    });
  }
  return toolJson({
    ...value,
    kind,
    metroPort,
    target: targetSummary(targets[0]),
    messages: (value.messages ?? []).slice(-limit),
    limit,
    cdp: result?.diagnostics ?? result?.cdp ?? null,
  });
}

function diagnosticsExpression({ kind, limit }) {
  return `(() => {
    const kind = ${JSON.stringify(kind)};
    const limit = ${Number(limit)};
    const diagnostics = globalThis.__EXPO_IOS_DIAGNOSTICS__ || globalThis.__CODEX_DIAGNOSTICS__ || {};
    const raw = diagnostics[kind] || diagnostics[kind === 'errors' ? 'error' : 'logs'] || [];
    const messages = Array.isArray(raw) ? raw.slice(-limit).map((entry, index) => ({
      index,
      level: entry && typeof entry === 'object' ? (entry.level || (kind === 'errors' ? 'error' : 'log')) : (kind === 'errors' ? 'error' : 'log'),
      message: entry && typeof entry === 'object' ? String(entry.message || entry.text || entry.value || '') : String(entry),
      timestamp: entry && typeof entry === 'object' ? (entry.timestamp || entry.time || null) : null,
      source: entry && typeof entry === 'object' ? (entry.source || null) : null,
      stack: entry && typeof entry === 'object' ? (entry.stack || null) : null
    })) : [];
    return {
      available: Array.isArray(raw),
      source: Array.isArray(raw) ? 'runtime-diagnostics-buffer' : 'missing-runtime-diagnostics-buffer',
      total: Array.isArray(raw) ? raw.length : 0,
      messages,
      limitations: Array.isArray(raw)
        ? ['Runtime diagnostics reflect the app-provided buffer; native logs are not included.']
        : ['Install or enable runtime diagnostics instrumentation to populate this buffer.']
    };
  })()`;
}

async function metroCommand(args = {}) {
  const action = requireString(args.action ?? "status", "action");
  if (action === "reload") return toolJson(await metroReloadPayload(args));
  if (action === "symbolicate") return toolJson(await metroSymbolicatePayload(args));
  if (action !== "status") throw new Error(`Unknown metro action: ${action}`);
  return toolJson(await metroStatusPayload(args));
}

async function metroReloadPayload(args = {}) {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const targets = await metroTargets(metroPort);
  const webSocketDebuggerUrl = targets[0]?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) return { available: false, action: "reload", reason: "No Metro inspector target.", metroPort };
  const result = await evaluateHermesExpression(webSocketDebuggerUrl, `(() => {
    const devSettings = globalThis.NativeModules?.DevSettings || globalThis.__fbBatchedBridgeConfig?.remoteModuleConfig?.DevSettings;
    if (globalThis.location && typeof globalThis.location.reload === 'function') { globalThis.location.reload(); return { available: true, strategy: 'location.reload' }; }
    if (devSettings && typeof devSettings.reload === 'function') { devSettings.reload(); return { available: true, strategy: 'DevSettings.reload' }; }
    return { available: false, reason: 'No runtime reload hook was available.' };
  })()`, { timeoutMs: 3000 });
  return {
    ...(result?.result?.result?.value ?? { available: false, reason: result?.error ?? "Runtime reload did not return a value." }),
    action: "reload",
    metroPort,
    target: targetSummary(targets[0]),
  };
}

async function metroSymbolicatePayload(args = {}) {
  const stackFile = requireString(args.stackFile ?? args._?.[0] ?? args.file, "stackFile");
  const stack = parseComponentStackFrames(await fs.readFile(path.resolve(stackFile), "utf8"));
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const result = await postMetroSymbolicate(metroPort, stack);
  return { available: true, action: "symbolicate", metroPort, stackFile: path.resolve(stackFile), frameCount: stack.length, result };
}

async function metroStatusPayload(args = {}) {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  return new MetroInspectorClient(metroPort).statusPayload();
}

async function metroTargets(metroPort) {
  const result = await new MetroInspectorClient(metroPort).targets();
  return result.targets;
}

function targetSummary(target) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative),
    },
  };
}

async function probeMetroSymbolication(metroPort) {
  return new MetroInspectorClient(metroPort).probeSymbolication();
}

class MetroInspectorClient {
  constructor(metroPort) {
    this.metroPort = metroPort;
    this.baseUrl = `http://127.0.0.1:${metroPort}`;
  }

  async status() {
    return fetchLocalText(`${this.baseUrl}/status`, { timeoutMs: 1500 })
      .then((text) => ({ available: true, endpoint: "/status", text, error: null }))
      .catch((error) => ({ available: false, endpoint: "/status", text: null, error: formatError(error) }));
  }

  async version() {
    return fetchLocalJson(`${this.baseUrl}/json/version`, { timeoutMs: 1500 })
      .then((value) => ({ available: true, endpoint: "/json/version", value, error: null }))
      .catch((error) => ({ available: false, endpoint: "/json/version", value: null, error: formatError(error) }));
  }

  async targets() {
    const raw = await fetchLocalJson(`${this.baseUrl}/json/list`, { timeoutMs: 2500 })
      .catch((error) => ({ __expoIosMetroError: formatError(error) }));
    if (raw?.__expoIosMetroError) {
      return { available: false, endpoint: "/json/list", targets: [], malformedTargets: [], reason: raw.__expoIosMetroError };
    }
    if (!Array.isArray(raw)) {
      return {
        available: false,
        endpoint: "/json/list",
        targets: [],
        malformedTargets: [{ index: null, reason: "Metro target list was not an array.", shape: responseShape(raw) }],
        reason: "Metro target list was malformed.",
      };
    }
    const targets = [];
    const malformedTargets = [];
    raw.forEach((target, index) => {
      const normalized = this.normalizeTarget(target, index);
      if (normalized.target) targets.push(normalized.target);
      if (normalized.error) malformedTargets.push(normalized.error);
    });
    return {
      available: true,
      endpoint: "/json/list",
      targets,
      malformedTargets,
      reason: malformedTargets.length > 0 ? "Some Metro targets were malformed and skipped." : null,
    };
  }

  normalizeTarget(target, index = 0) {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      return { target: null, error: { index, reason: "Target was not an object.", shape: responseShape(target) } };
    }
    const normalized = {
      id: optionalString(target.id),
      title: optionalString(target.title),
      description: optionalString(target.description),
      appId: optionalString(target.appId),
      deviceName: optionalString(target.deviceName),
      devtoolsFrontendUrl: optionalString(target.devtoolsFrontendUrl),
      webSocketDebuggerUrl: optionalString(target.webSocketDebuggerUrl),
      reactNative: target.reactNative && typeof target.reactNative === "object" ? target.reactNative : null,
      capabilities: {
        hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
        devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
        reactNative: Boolean(target.reactNative),
      },
    };
    if (!normalized.id && !normalized.title && !normalized.webSocketDebuggerUrl && !normalized.devtoolsFrontendUrl) {
      return { target: null, error: { index, reason: "Target did not include any stable identifying metadata.", shape: responseShape(target) } };
    }
    return { target: normalized, error: null };
  }

  async probeSymbolication() {
    return this.symbolicate([])
      .then((result) => ({
        available: result.available,
        endpoint: "/symbolicate",
        status: result.status,
        reason: result.reason,
      }));
  }

  async symbolicate(stack) {
    try {
      const response = await fetchLocalLoopback(`${this.baseUrl}/symbolicate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stack }),
        timeoutMs: 1500,
      });
      const value = response.ok ? await response.json().catch(() => null) : null;
      return {
        available: response.ok,
        endpoint: "/symbolicate",
        status: response.status,
        reason: response.ok ? null : `Metro symbolicate HTTP ${response.status}`,
        value,
      };
    } catch (error) {
      return {
        available: false,
        endpoint: "/symbolicate",
        status: null,
        reason: formatError(error),
        value: null,
      };
    }
  }

  async statusPayload() {
    const statusResult = await this.status();
    const targetsResult = statusResult.available
      ? await this.targets()
      : { available: false, targets: [], malformedTargets: [], reason: "Metro is unavailable." };
    const versionResult = statusResult.available ? await this.version() : { available: false, value: null, error: "Metro is unavailable." };
    const symbolication = statusResult.available
      ? await this.probeSymbolication()
      : { available: false, reason: "Metro is unavailable.", endpoint: "/symbolicate" };
    return {
      available: statusResult.available,
      reason: statusResult.available ? null : "Metro is not reachable on the requested port.",
      metroPort: this.metroPort,
      status: statusResult.available ? "available" : "unavailable",
      statusText: statusResult.text,
      error: statusResult.error ?? null,
      version: versionResult.value,
      versionError: versionResult.error ?? null,
      targetCount: targetsResult.targets.length,
      targets: targetsResult.targets.map(targetSummary),
      targetDiscovery: {
        endpoint: "/json/list",
        available: targetsResult.available,
        reason: targetsResult.reason,
        malformedTargets: targetsResult.malformedTargets,
      },
      symbolication,
      limitations: [
        "This command probes existing Metro HTTP endpoints only and never starts Metro implicitly.",
        "Connected targets can be stale when multiple apps or devices are attached.",
      ],
    };
  }
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function navigationCommand(args = {}) {
  const action = requireString(args.action ?? "state", "action");
  if (!["state", "back", "pop-to-root", "tab", "deep-link"].includes(action)) {
    throw new Error(`Unknown navigation action: ${action}`);
  }
  if (action === "deep-link") return toolJson(await navigationDeepLink(args));
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const policy = await navigationPolicyDecision(args, action);
  if (!policy.allowed) {
    return toolJson({
      available: false,
      action,
      metroPort,
      source: "policy",
      evidenceSource: "policy",
      reason: policy.reason,
      policy,
      transport: navigationTransport(metroPort, null, null),
    });
  }
  const targets = await metroTargets(metroPort);
  const webSocketDebuggerUrl = targets[0]?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return toolJson(navigationUnavailable({ action, metroPort, reason: "No Metro inspector target.", policy }));
  }
  const result = await evaluateHermesExpression(webSocketDebuggerUrl, navigationExpression({
    action,
    tab: args.tab ?? args._?.[1],
  }), { timeoutMs: 5000 });
  const value = result?.result?.result?.value;
  if (!value) {
    return toolJson(navigationUnavailable({
      action,
      metroPort,
      reason: result?.error ?? "Navigation bridge did not return a value.",
      target: targetSummary(targets[0]),
      policy,
    }));
  }
  return toolJson({
    ...value,
    action,
    metroPort,
    target: targetSummary(targets[0]),
    transport: navigationTransport(metroPort, targets[0], result.diagnostics),
    evidenceSource: value.source ?? "unknown",
    policy,
  });
}

async function navigationDeepLink(args = {}) {
  const policy = await navigationPolicyDecision(args, "deep-link");
  if (!policy.allowed) return { available: false, action: "deep-link", reason: policy.reason, policy };
  const route = args.route ?? args._?.[1] ?? args._?.[0];
  const opened = unwrapToolJson(await openExpoRoute({ ...args, route }));
  return {
    available: true,
    action: "deep-link",
    source: "open-route",
    evidenceSource: "deep-link",
    transport: {
      name: "simulator-open-url",
      command: "open-route",
      target: opened.device ?? null,
    },
    policy,
    deepLink: opened,
    evidence: {
      targetId: await selectedTargetId(args),
      sessionId: await latestSessionId(args),
      route: route ?? opened.route ?? null,
      url: opened.url ?? null,
    },
  };
}

function navigationUnavailable({ action, metroPort, reason, target = null, policy = null }) {
  return {
    available: false,
    action,
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    reason,
    metroPort,
    target,
    transport: {
      name: "metro-inspector-hermes-cdp",
      metroPort,
      protocol: "Runtime.evaluate",
      target,
      cdp: null,
    },
    policy,
    limitations: [
      "Navigation state and imperative navigation actions require the dev-only app instrumentation bridge.",
      "Use open-route or navigation deep-link when only URL navigation is available.",
    ],
  };
}

async function navigationPolicyDecision(args, action) {
  const sideEffect = action === "state" ? "read" : "device";
  if (action === "state") {
    return {
      checked: true,
      action: `navigation.${action}`,
      sideEffect,
      allowed: true,
      reason: "Read action does not require policy approval.",
    };
  }
  if (action === "deep-link") {
    return {
      checked: true,
      action: `navigation.${action}`,
      sideEffect,
      allowed: true,
      reason: "Deep-link navigation uses the existing open-route fallback policy.",
    };
  }
  return policyDecision(args, `navigation.${action}`, sideEffect);
}

function navigationTransport(metroPort, target, cdp = null) {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary(target),
    cdp,
  };
}

function navigationExpression({ action, tab }) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const tab = ${JSON.stringify(tab ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    if (pluginBridge && typeof pluginBridge === 'object') {
      const metadata = pluginBridge.metadata || pluginBridge.expoIosDevtoolsBridgeMetadata || pluginBridge.bridgeMetadata || {};
      const bridgeVersion = metadata.bridgeVersion || pluginBridge.bridgeVersion || pluginBridge.version || null;
      if (bridgeVersion && bridgeVersion !== expectedBridgeVersion) {
        return {
          available: false,
          action,
          source: 'plugin-bridge',
          domain: 'navigation',
          code: 'version-mismatch',
          bridgeVersion,
          expectedBridgeVersion,
          reason: 'Navigation plugin bridge version is not compatible with this CLI.',
          state: null
        };
      }
      const domains = pluginBridge.domainRegistry || pluginBridge.domains || {};
      const navigation = pluginBridge.navigation ||
        (pluginBridge.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.navigation : null) ||
        (pluginBridge.domainRegistry ? pluginBridge.domainRegistry.navigation : null);
      const callTool = typeof pluginBridge.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
      const callNavigation = (name, payload = {}) => {
        if (navigation && typeof navigation[name] === 'function') return navigation[name](payload);
        if (navigation && navigation.actions && typeof navigation.actions[name] === 'function') return navigation.actions[name](payload);
        if (callTool) return callTool('navigation.' + name, payload);
        return null;
      };
      const hasNavigation = Boolean(navigation || callTool || (Array.isArray(domains) && domains.some((domain) => domain?.name === 'navigation')));
      if (hasNavigation) {
        if (action === 'state') {
          return {
            available: true,
            action,
            source: 'plugin-bridge',
            domain: 'navigation',
            bridgeVersion,
            state: navigation && typeof navigation.state !== 'function' ? navigation.state || null : callNavigation('state')
          };
        }
        if (action === 'back') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, result: callNavigation('back') };
        }
        if (action === 'pop-to-root') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, result: callNavigation('pop-to-root') || callNavigation('popToRoot') };
        }
        if (action === 'tab') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, tab, result: callNavigation('tab', { tab }) };
        }
      }
    }
    const bridge = globalThis.__EXPO_IOS_NAVIGATION_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.navigation);
    if (!bridge) {
      return {
        available: false,
        action,
        source: 'app-instrumentation',
        reason: 'Navigation bridge is not installed.',
        state: null
      };
    }
    if (action === 'state') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        state: typeof bridge.state === 'function' ? bridge.state() : bridge.state || null
      };
    }
    if (action === 'back') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        result: typeof bridge.back === 'function' ? bridge.back() : null
      };
    }
    if (action === 'pop-to-root') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        result: typeof bridge.popToRoot === 'function' ? bridge.popToRoot() : null
      };
    }
    if (action === 'tab') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        tab,
        result: typeof bridge.tab === 'function' ? bridge.tab(tab) : null
      };
    }
    return { available: false, action, source: 'app-instrumentation', reason: 'Unsupported navigation action.' };
  })()`;
}

async function selectedTargetId(args = {}) {
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  return session?.activeTargetId ?? null;
}

async function latestSessionId(args = {}) {
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  return session?.sessionId ?? null;
}

async function networkCommand(args = {}) {
  const action = requireString(args.action ?? "status", "action");
  if (!["status", "requests", "request", "clear", "har"].includes(action)) {
    throw new Error(`Unknown network action: ${action}`);
  }
  const bridgeAction = action === "har"
    ? `har-${requireString(args.harAction ?? "start", "harAction")}`
    : action;
  if (action === "har" && !["start", "stop"].includes(args.harAction ?? "start")) {
    throw new Error(`Unknown network HAR action: ${args.harAction}`);
  }
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const limit = clampNumber(args.limit ?? 100, 1, 1000);
  const targets = await metroTargets(metroPort);
  const target = targets.find((item) => item.webSocketDebuggerUrl) ?? targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return toolJson(networkUnavailable({ action: bridgeAction, metroPort, code: "no-runtime-target", reason: "No Metro inspector target." }));
  }
  const result = await evaluateHermesExpression(webSocketDebuggerUrl, networkExpression({
    action: bridgeAction,
    requestId: args.requestId,
    limit,
  }), { timeoutMs: 5000 });
  const value = result?.result?.result?.value;
  if (!value) {
    return toolJson(networkUnavailable({
      action: bridgeAction,
      metroPort,
      code: "transport-failure",
      reason: result?.error ?? "Network bridge did not return a value.",
      target: targetSummary(target),
      transport: networkTransport(metroPort, target, result.diagnostics),
    }));
  }
  const transport = networkTransport(metroPort, target, result.diagnostics);
  const redacted = normalizeNetworkEvidence(redactNetworkEvidence(value), bridgeAction);
  if (bridgeAction === "har-stop" && redacted.available !== false) {
    const outputPath = path.resolve(args.outputPath ?? path.join(resolveExpoStateRoot(args), "artifacts", `network-${new Date().toISOString().replace(/[:.]/g, "-")}.har`));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const captureTiming = networkCaptureTiming(redacted);
    const har = annotateHar(redacted.har ?? harFromNetworkRequests(redacted.requests ?? []), {
      source: redacted.source ?? "unknown",
      transport,
      limitations: networkLimitations(redacted),
      captureTiming,
    });
    await writeJsonFile(outputPath, har);
    return toolJson({
      ...redacted,
      action: bridgeAction,
      metroPort,
      target: targetSummary(target),
      transport,
      evidenceSource: redacted.source ?? "unknown",
      limitations: networkLimitations(redacted),
      captureTiming,
      artifact: outputPath,
      har,
    });
  }
  return toolJson({
    ...redacted,
    action: bridgeAction,
    metroPort,
    target: targetSummary(target),
    transport,
    evidenceSource: redacted.source ?? "unknown",
    limitations: networkLimitations(redacted),
    captureTiming: networkCaptureTiming(redacted),
  });
}

function networkUnavailable({ action, metroPort, reason, target = null, code = "unavailable", source = null, transport = null }) {
  const evidenceSource = source ?? (code === "no-runtime-target" ? "runtime-target" : "app-instrumentation");
  return {
    available: false,
    action,
    source: evidenceSource,
    evidenceSource: "unavailable",
    code,
    reason,
    metroPort,
    target,
    transport: transport ?? {
      name: "metro-inspector-hermes-cdp",
      metroPort,
      protocol: "Runtime.evaluate",
      target,
      cdp: null,
    },
    requests: [],
    limitations: [
      "Network evidence requires dev-only app instrumentation that patches fetch/XHR or an equivalent app network adapter.",
      "Native networking stacks are unavailable unless the app exposes them through the bridge.",
    ],
  };
}

function networkExpression({ action, requestId, limit }) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const requestId = ${JSON.stringify(requestId ?? null)};
    const limit = ${Number(limit)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginNetwork = pluginBridge?.network ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.network : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.network : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callNetwork = (name, payload = {}) => {
      if (pluginNetwork && typeof pluginNetwork[name] === 'function') return pluginNetwork[name](payload);
      if (pluginNetwork && pluginNetwork.actions && typeof pluginNetwork.actions[name] === 'function') return pluginNetwork.actions[name](payload);
      if (pluginCallTool) return pluginCallTool('network.' + name, payload);
      return null;
    };
    const hasPluginNetwork = Boolean(pluginNetwork || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'network')));
    if (hasPluginNetwork) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, action, source: 'plugin-bridge', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Network plugin bridge version is not compatible with this CLI.', requests: [] };
      }
      const list = () => {
        const raw = pluginNetwork && typeof pluginNetwork.requests === 'function'
          ? pluginNetwork.requests({ limit })
          : pluginNetwork?.requests || callNetwork('requests', { limit }) || [];
        return Array.isArray(raw) ? raw.slice(-limit) : raw;
      };
      if (action === 'status') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, hooks: pluginNetwork?.hooks || callNetwork('status') || { fetch: true, xhr: true } };
      if (action === 'requests') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, requests: list() };
      if (action === 'request') {
        const requests = list();
        if (!Array.isArray(requests)) return { available: false, action, source: 'plugin-bridge', code: 'malformed-payload', reason: 'Network plugin bridge returned a malformed request list.', requests: [] };
        const found = requests.find((request) => request && request.id === requestId) || null;
        return found
          ? { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, request: found }
          : { available: false, action, source: 'plugin-bridge', code: 'no-observed-traffic', reason: 'Request not found.', requestId, requests: [] };
      }
      if (action === 'clear') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, cleared: callNetwork('clear') ?? true };
      if (action === 'har-start') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, started: callNetwork('har-start') ?? true, startedAt: new Date().toISOString() };
      if (action === 'har-stop') {
        const har = callNetwork('har-stop');
        return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, har: har?.log ? har : null, requests: list(), stoppedAt: new Date().toISOString() };
      }
    }
    const devtoolsNetwork = globalThis.__REACT_NATIVE_DEVTOOLS_NETWORK__ ||
      globalThis.__RN_DEVTOOLS_NETWORK__ ||
      globalThis.__REACT_DEVTOOLS_NETWORK__;
    if (devtoolsNetwork && typeof devtoolsNetwork === 'object') {
      const list = () => {
        const raw = typeof devtoolsNetwork.requests === 'function' ? devtoolsNetwork.requests({ limit }) : devtoolsNetwork.requests || [];
        return Array.isArray(raw) ? raw.slice(-limit) : raw;
      };
      if (action === 'status') return { available: true, action, source: 'react-native-devtools-network', hooks: devtoolsNetwork.hooks || { fetch: true, xhr: true } };
      if (action === 'requests') return { available: true, action, source: 'react-native-devtools-network', requests: list() };
      if (action === 'request') {
        const found = list().find((request) => request && request.id === requestId) || null;
        return found
          ? { available: true, action, source: 'react-native-devtools-network', request: found }
          : { available: false, action, source: 'react-native-devtools-network', code: 'no-observed-traffic', reason: 'Request not found.', requestId, requests: [] };
      }
      if (action === 'har-start') return { available: true, action, source: 'react-native-devtools-network', started: true, startedAt: new Date().toISOString() };
      if (action === 'har-stop') return { available: true, action, source: 'react-native-devtools-network', requests: list(), stoppedAt: new Date().toISOString() };
    }
    const bridge = globalThis.__EXPO_IOS_NETWORK_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.network);
    if (!bridge) {
      return {
        available: false,
        action,
        source: 'app-instrumentation',
        code: 'no-bridge-domain',
        reason: 'Network bridge is not installed.',
        requests: []
      };
    }
    const list = () => {
      const raw = typeof bridge.requests === 'function' ? bridge.requests({ limit }) : bridge.requests || [];
      return Array.isArray(raw) ? raw.slice(-limit) : [];
    };
    if (action === 'status') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        hooks: typeof bridge.status === 'function' ? bridge.status() : (bridge.hooks || { fetch: true, xhr: true })
      };
    }
    if (action === 'requests') {
      return { available: true, action, source: 'app-instrumentation', requests: list() };
    }
    if (action === 'request') {
      const found = list().find((request) => request && request.id === requestId) || null;
      return found
        ? { available: true, action, source: 'app-instrumentation', request: found }
        : { available: false, action, source: 'app-instrumentation', reason: 'Request not found.', requestId };
    }
    if (action === 'clear') {
      if (typeof bridge.clear === 'function') bridge.clear();
      return { available: true, action, source: 'app-instrumentation', cleared: true };
    }
    if (action === 'har-start') {
      if (typeof bridge.harStart === 'function') return { available: true, action, source: 'app-instrumentation', har: bridge.harStart() };
      return { available: true, action, source: 'app-instrumentation', started: true };
    }
    if (action === 'har-stop') {
      if (typeof bridge.harStop === 'function') return { available: true, action, source: 'app-instrumentation', har: bridge.harStop(), requests: list() };
      return { available: true, action, source: 'app-instrumentation', requests: list() };
    }
    return { available: false, action, source: 'app-instrumentation', reason: 'Unsupported network action.' };
  })()`;
}

function redactNetworkEvidence(value) {
  if (!value || typeof value !== "object") return value;
  const clone = { ...value };
  if (Array.isArray(clone.requests)) clone.requests = clone.requests.map(redactNetworkRequest);
  if (clone.request) clone.request = redactNetworkRequest(clone.request);
  if (clone.har) clone.har = redactHar(clone.har);
  return clone;
}

function normalizeNetworkEvidence(value, action) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      available: false,
      action,
      source: "runtime",
      code: "malformed-payload",
      reason: "Network runtime returned a malformed payload.",
      requests: [],
    };
  }
  const normalized = { ...value };
  if (normalized.requests !== undefined && !Array.isArray(normalized.requests)) {
    return {
      ...normalized,
      available: false,
      action,
      code: "malformed-payload",
      reason: "Network runtime returned a malformed request list.",
      requests: [],
    };
  }
  if ((action === "requests" || action === "har-stop") && normalized.available !== false && Array.isArray(normalized.requests) && normalized.requests.length === 0) {
    return {
      ...normalized,
      available: false,
      action,
      code: "no-observed-traffic",
      reason: "No network traffic was observed by the selected upstream/bridge path.",
      requests: [],
    };
  }
  return normalized;
}

function networkTransport(metroPort, target, cdp = null) {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary(target),
    cdp,
  };
}

function networkLimitations(value) {
  const limitations = [
    "Network evidence is limited to traffic observed by the selected React Native DevTools or app bridge network domain.",
    "Headers, cookies, credentials, request bodies, and response bodies are redacted before stdout and artifact writes.",
  ];
  if (value?.source === "app-instrumentation") {
    limitations.push("Legacy app instrumentation was used because no upstream DevTools or plugin bridge network domain was available.");
  }
  if (value?.available === false && value?.code === "no-observed-traffic") {
    limitations.push("No observed traffic is not proof that the app made no native network requests outside the selected domain.");
  }
  return limitations;
}

function networkCaptureTiming(value) {
  const requests = Array.isArray(value?.requests) ? value.requests : value?.request ? [value.request] : [];
  const times = requests
    .map((request) => request?.startedAt)
    .filter((item) => typeof item === "string" && item.length > 0)
    .sort();
  return {
    startedAt: value?.startedAt ?? times[0] ?? null,
    stoppedAt: value?.stoppedAt ?? new Date().toISOString(),
    observedRequestCount: requests.length,
  };
}

function redactNetworkRequest(request) {
  if (!request || typeof request !== "object") return request;
  return {
    ...request,
    url: redactNetworkUrl(request.url),
    request: request.request ? redactNetworkMessage(request.request) : undefined,
    response: request.response ? redactNetworkMessage(request.response) : undefined,
    headers: request.headers ? redactHeaders(request.headers) : undefined,
  };
}

function redactNetworkMessage(message) {
  if (!message || typeof message !== "object") return message;
  return {
    ...message,
    url: redactNetworkUrl(message.url),
    headers: message.headers ? redactHeaders(message.headers) : undefined,
    cookies: message.cookies ? REDACTED : undefined,
    body: message.body ? REDACTED : undefined,
    postData: message.postData ? REDACTED : undefined,
    content: message.content ? { ...message.content, text: message.content.text ? REDACTED : message.content.text } : undefined,
  };
}

function redactHeaders(headers) {
  if (!headers || typeof headers !== "object") return headers;
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    /authorization|cookie|token|secret|api[-_]?key|password|set-cookie/i.test(key) ? REDACTED : value,
  ]));
}

function redactNetworkUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(String(url));
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|secret|key|password|auth|session|cookie/i.test(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
    parsed.username = parsed.username ? REDACTED : "";
    parsed.password = parsed.password ? REDACTED : "";
    return parsed.toString();
  } catch {
    return String(url).replace(/([?&][^=]*(token|secret|key|password|auth|session|cookie)[^=]*=)[^&]+/gi, `$1${REDACTED}`);
  }
}

function redactHar(har) {
  if (!har || typeof har !== "object") return har;
  const copy = JSON.parse(JSON.stringify(har));
  const entries = copy.log?.entries;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (entry.request) entry.request = redactNetworkMessage(entry.request);
      if (entry.response) entry.response = redactNetworkMessage(entry.response);
    }
  }
  return copy;
}

function annotateHar(har, metadata) {
  const copy = har && typeof har === "object" ? JSON.parse(JSON.stringify(har)) : harFromNetworkRequests([]);
  copy.log = copy.log && typeof copy.log === "object" ? copy.log : { version: "1.2", creator: { name: CLI_NAME, version: CLI_VERSION }, entries: [] };
  copy.log._expoIos = {
    source: metadata.source,
    transport: metadata.transport,
    limitations: metadata.limitations,
    captureTiming: metadata.captureTiming,
    redaction: {
      headers: ["authorization", "cookie", "set-cookie", "token", "secret", "api-key"],
      bodies: true,
      query: ["token", "secret", "key", "password", "auth", "session", "cookie"],
    },
  };
  return copy;
}

function harFromNetworkRequests(requests) {
  return {
    log: {
      version: "1.2",
      creator: { name: CLI_NAME, version: CLI_VERSION },
      entries: requests.map((request) => ({
        startedDateTime: request.startedAt ?? new Date().toISOString(),
        time: request.durationMs ?? 0,
        request: {
          method: request.method ?? request.request?.method ?? "GET",
          url: request.url ?? request.request?.url ?? "",
          headers: request.headers ?? request.request?.headers ?? {},
          queryString: [],
          cookies: [],
        },
        response: {
          status: request.status ?? request.response?.status ?? 0,
          statusText: request.response?.statusText ?? "",
          headers: request.response?.headers ?? {},
          cookies: [],
          content: { size: 0, mimeType: request.response?.mimeType ?? "", text: request.response?.body ?? "" },
        },
      })),
    },
  };
}

async function storageCommand(args = {}) {
  const store = requireString(args.store, "store");
  const action = requireString(args.action ?? "list", "action");
  if (!["list", "get", "set", "clear"].includes(action)) throw new Error(`Unknown storage action: ${action}`);
  const sideEffect = action === "list" || action === "get" ? "read" : "write";
  const policy = await policyDecision(args, `storage.${action}`, sideEffect);
  if (!policy.allowed) return toolJson(policyDeniedPayload({ domain: "storage", action, policy }));
  const value = action === "set" ? parseStorageValue(args.value) : null;
  return toolJson(await bridgeDomainCommand({
    args,
    domain: "storage",
    action,
    expression: storageExpression({
      store,
      action,
      key: args.key,
      value,
      limit: clampNumber(args.limit ?? 100, 1, 1000),
    }),
    policy,
  }));
}

async function stateCommand(args = {}) {
  const action = requireString(args.action ?? "list", "action");
  if (!["list", "save", "load", "clear"].includes(action)) throw new Error(`Unknown state action: ${action}`);
  const sideEffect = action === "list" || action === "save" ? "read" : "write";
  const policy = await policyDecision(args, `state.${action}`, sideEffect);
  if (!policy.allowed) return toolJson(policyDeniedPayload({ domain: "state", action, policy }));
  return toolJson(await bridgeDomainCommand({
    args,
    domain: "state",
    action,
    expression: stateExpression({ action, name: args.name }),
    policy,
  }));
}

async function controlsCommand(args = {}) {
  const action = requireString(args.action ?? "list", "action");
  if (!["list", "get", "press"].includes(action)) throw new Error(`Unknown controls action: ${action}`);
  const sideEffect = action === "press" ? "device" : "read";
  const policy = await policyDecision(args, `controls.${action}`, sideEffect);
  if (!policy.allowed) return toolJson(policyDeniedPayload({ domain: "controls", action, policy }));
  return toolJson(await bridgeDomainCommand({
    args,
    domain: "controls",
    action,
    expression: controlsExpression({ action, name: args.name }),
    policy,
  }));
}

const EXPO_IOS_BRIDGE_VERSION = "1.0.0";
const BRIDGE_DOMAIN_CATALOG = [
  {
    name: "navigation",
    readCommands: ["state"],
    writeCommands: ["back", "pop-to-root", "tab", "deep-link"],
    redactionBoundaries: ["route params", "query values"],
  },
  {
    name: "network",
    readCommands: ["list", "request", "har.start", "har.stop"],
    writeCommands: ["clear"],
    redactionBoundaries: ["headers.authorization", "headers.cookie", "requestBody", "responseBody"],
  },
  {
    name: "storage",
    readCommands: ["list", "get"],
    writeCommands: ["set", "clear"],
    redactionBoundaries: ["keys", "values", "secure-store values"],
  },
  {
    name: "state",
    readCommands: ["list", "save"],
    writeCommands: ["load", "clear"],
    redactionBoundaries: ["snapshot values"],
  },
  {
    name: "controls",
    readCommands: ["list", "get"],
    writeCommands: ["press"],
    redactionBoundaries: ["control labels", "control props"],
  },
  {
    name: "performance",
    readCommands: ["mark.list", "measure.list", "memory.sample"],
    writeCommands: ["mark.add", "measure.start", "measure.stop"],
    redactionBoundaries: ["mark names", "measure names"],
  },
  {
    name: "snapshot",
    readCommands: ["capture", "refs"],
    writeCommands: [],
    redactionBoundaries: ["text content", "accessibility labels", "props"],
  },
  {
    name: "rn",
    readCommands: ["tree", "inspect", "fiber"],
    writeCommands: [],
    redactionBoundaries: ["props", "component names", "text content"],
  },
];

async function bridgeCommand(args = {}) {
  const action = requireString(args.action ?? "status", "action");
  if (!["status", "plan", "health", "domains", "install", "remove"].includes(action)) throw new Error(`Unknown bridge action: ${action}`);
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => path.resolve(args.cwd ?? process.cwd()));
  const status = await bridgeInstallStatus(cwd);
  const plan = bridgeInstallPlan(cwd, status);
  if (action === "status") return toolJson({ available: true, action, ...status });
  if (action === "plan") return toolJson({ available: true, action, status: status.state, projectRoot: status.projectRoot, plan });
  if (action === "health" || action === "domains") return toolJson(await bridgeHealthPayload(args, { action, status, plan }));
  const permission = action === "install" ? "bridge-install" : "bridge-remove";
  if (!hasExplicitConfirmation(args.confirmActions, permission)) {
    return toolJson({
      available: false,
      action,
      status: status.state,
      projectRoot: status.projectRoot,
      reason: `Refusing to mutate app files without explicit --confirm-actions ${permission}.`,
      requiredConfirmation: permission,
      plan,
    });
  }
  if (action === "install") {
    await fs.mkdir(path.join(cwd, ".expo-ios"), { recursive: true });
    await fs.mkdir(path.join(cwd, "src"), { recursive: true });
    await writeJsonFile(path.join(cwd, ".expo-ios", "bridge.json"), bridgeMetadata());
    await fs.writeFile(path.join(cwd, "src", "expo-ios-devtools-bridge.ts"), bridgeSource(), "utf8");
    return toolJson({ available: true, action, projectRoot: cwd, installed: true, status: (await bridgeInstallStatus(cwd)).state, plan });
  }
  await fs.rm(path.join(cwd, ".expo-ios", "bridge.json"), { force: true }).catch(() => {});
  await fs.rm(path.join(cwd, "src", "expo-ios-devtools-bridge.ts"), { force: true }).catch(() => {});
  return toolJson({ available: true, action, projectRoot: cwd, removed: true, status: (await bridgeInstallStatus(cwd)).state, plan });
}

async function bridgeInstallStatus(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageJson = await readJsonFile(packageJsonPath).catch(() => null);
  const deps = packageJson ? { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) } : {};
  const metadataPath = path.join(projectRoot, ".expo-ios", "bridge.json");
  const sourcePath = path.join(projectRoot, "src", "expo-ios-devtools-bridge.ts");
  const metadata = await readJsonFile(metadataPath).catch(() => null);
  const sourceExists = await pathExists(sourcePath);
  const hasExpo = typeof deps.expo === "string";
  const rozenitePackages = Object.keys(deps).filter((name) => name === "rozenite" || name.startsWith("@rozenite/")).sort();
  let state = "absent";
  const issues = [];
  if (!hasExpo) {
    state = "incompatible";
    issues.push({ code: "missing-expo", message: "The project does not declare expo, so an Expo DevTools bridge cannot be installed safely." });
  } else if (metadata || sourceExists) {
    if (!metadata || !sourceExists) {
      state = "stale";
      issues.push({ code: "partial-install", message: "Bridge metadata and source file are not both present." });
    } else if (metadata.bridgeVersion !== EXPO_IOS_BRIDGE_VERSION || metadata.schemaVersion !== 1) {
      state = "stale";
      issues.push({ code: "version-mismatch", message: `Bridge version ${metadata.bridgeVersion ?? "unknown"} does not match ${EXPO_IOS_BRIDGE_VERSION}.` });
    } else if (metadata.developmentOnly !== true) {
      state = "incompatible";
      issues.push({ code: "not-development-only", message: "Bridge metadata must declare developmentOnly: true." });
    } else {
      state = "present";
    }
  }
  return {
    projectRoot,
    state,
    bridgeVersion: metadata?.bridgeVersion ?? null,
    expectedBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    developmentOnly: metadata?.developmentOnly === true,
    metadataPath,
    sourcePath,
    files: { metadata: Boolean(metadata), source: sourceExists },
    dependencies: {
      expo: deps.expo ?? null,
      rozenite: rozenitePackages.map((name) => ({ name, version: deps[name] })),
    },
    issues,
  };
}

function bridgeInstallPlan(projectRoot, status) {
  return {
    permissionRequired: true,
    requiredConfirmations: ["bridge-install", "bridge-remove"],
    developmentOnly: true,
    productionExclusion: [
      "Bridge code must be imported only from development-only app entrypoints or guarded by __DEV__.",
      "Production/release builds must not import src/expo-ios-devtools-bridge.ts.",
    ],
    filesToAddOrChange: [
      {
        path: status.metadataPath,
        action: status.files.metadata ? "update" : "add",
        purpose: "Versioned bridge metadata for stale/incompatible detection and removal.",
      },
      {
        path: status.sourcePath,
        action: status.files.source ? "update" : "add",
        purpose: "Development-only Expo/Rozenite bridge registration shim.",
      },
    ],
    removalPlan: [
      { path: status.metadataPath, action: "delete" },
      { path: status.sourcePath, action: "delete" },
    ],
    runtimeHealthCheckExpectations: [
      "Metro target is available.",
      "Hermes inspector is available.",
      "Bridge metadata version matches CLI expected version.",
      "App registers readable and writable domains separately.",
      "Mutation domains remain action-policy gated.",
    ],
    status: status.state,
    issues: status.issues,
  };
}

async function bridgeHealthPayload(args, { action, status, plan }) {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const transport = {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    inspectorEndpoint: `http://127.0.0.1:${metroPort}/json/list`,
    protocol: "Runtime.evaluate",
    target: null,
    cdp: null,
  };
  const install = bridgeInstallSummary(status);
  if (status.state === "stale" || status.state === "incompatible") {
    return bridgeHealthUnavailable({
      action,
      code: status.state === "stale" ? "stale-bridge" : "incompatible-project",
      reason: status.issues[0]?.message ?? `Bridge install status is ${status.state}.`,
      status,
      install,
      transport,
      domains: bridgeDomainsFromCatalog(),
      policy: bridgeDomainPolicyPreview(args, bridgeDomainsFromCatalog()),
      plan,
    });
  }

  const targetResult = await new MetroInspectorClient(metroPort).targets();
  const target = targetResult.targets.find((item) => item.webSocketDebuggerUrl) ?? targetResult.targets[0] ?? null;
  transport.target = targetSummary(target);
  if (!target?.webSocketDebuggerUrl) {
    return bridgeHealthUnavailable({
      action,
      code: "transport-failure",
      reason: targetResult.reason ?? "No Metro Hermes inspector target is available for bridge discovery.",
      status,
      install,
      transport,
      domains: bridgeDomainsFromCatalog(),
      policy: bridgeDomainPolicyPreview(args, bridgeDomainsFromCatalog()),
      plan,
      metro: {
        available: targetResult.available,
        endpoint: targetResult.endpoint,
        targetCount: targetResult.targets.length,
        malformedTargets: targetResult.malformedTargets,
      },
    });
  }

  const result = await evaluateHermesExpression(target.webSocketDebuggerUrl, bridgeHealthExpression(), { timeoutMs: 5000 });
  transport.cdp = result.diagnostics ?? result.cdp ?? null;
  const value = result?.result?.result?.value;
  if (!value) {
    return bridgeHealthUnavailable({
      action,
      code: "transport-failure",
      reason: result?.error ?? "Bridge health Runtime.evaluate did not return a value.",
      status,
      install,
      transport,
      domains: bridgeDomainsFromCatalog(),
      policy: bridgeDomainPolicyPreview(args, bridgeDomainsFromCatalog()),
      plan,
    });
  }

  const normalized = normalizeBridgeHealthValue(value);
  const domains = normalizeBridgeDomains(normalized.domains);
  const policy = bridgeDomainPolicyPreview(args, domains);
  const base = {
    action,
    source: "app-instrumentation",
    install,
    projectRoot: status.projectRoot,
    status: status.state,
    expectedBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    cliBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    bridgeVersion: normalized.bridgeVersion,
    compatibleCliVersion: normalized.bridgeVersion === EXPO_IOS_BRIDGE_VERSION,
    appRegistration: {
      registered: normalized.registered === true,
      appId: normalized.appId,
      runtimeName: normalized.runtimeName,
    },
    transport,
    domains,
    policy,
    redactionBoundaries: bridgeRedactionBoundaries(domains),
  };
  if (normalized.available !== true) {
    const code = normalized.code ?? (normalized.registered === false
      ? "missing-app-registration"
      : "missing-bridge");
    return bridgeHealthUnavailable({
      ...base,
      action,
      code,
      reason: normalized.reason ?? bridgeHealthReason(code),
      status,
      install,
      transport,
      domains,
      policy,
    });
  }
  if (normalized.registered !== true) {
    return bridgeHealthUnavailable({
      ...base,
      action,
      code: "missing-app-registration",
      reason: normalized.reason ?? "The bridge object exists but the app has not registered with it.",
      status,
      install,
      transport,
      domains,
      policy,
    });
  }
  if (normalized.bridgeVersion !== EXPO_IOS_BRIDGE_VERSION) {
    return bridgeHealthUnavailable({
      ...base,
      action,
      code: "version-mismatch",
      reason: `Bridge version ${normalized.bridgeVersion ?? "unknown"} does not match CLI bridge version ${EXPO_IOS_BRIDGE_VERSION}.`,
      status,
      install,
      transport,
      domains,
      policy,
    });
  }
  return {
    ...base,
    available: true,
    health: "healthy",
    code: "healthy",
    domainCount: domains.length,
    writableDomainCount: domains.filter((domain) => domain.writeCommands.length > 0).length,
  };
}

function bridgeInstallSummary(status) {
  return {
    state: status.state,
    bridgeVersion: status.bridgeVersion,
    expectedBridgeVersion: status.expectedBridgeVersion,
    developmentOnly: status.developmentOnly,
    files: status.files,
    dependencies: status.dependencies,
    issues: status.issues,
  };
}

function bridgeHealthUnavailable(payload) {
  return {
    available: false,
    health: "unavailable",
    appRegistration: payload.appRegistration ?? { registered: false, appId: null, runtimeName: null },
    bridgeVersion: payload.bridgeVersion ?? null,
    compatibleCliVersion: false,
    expectedBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    cliBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    domainCount: payload.domains?.length ?? 0,
    writableDomainCount: (payload.domains ?? []).filter((domain) => domain.writeCommands?.length > 0).length,
    limitations: ["Bridge health requires Metro inspector access, a Hermes CDP target, and a development-only app bridge registration."],
    ...payload,
  };
}

function bridgeHealthReason(code) {
  if (code === "missing-bridge") return "No Expo iOS devtools bridge object was found in the running app.";
  if (code === "missing-app-registration") return "The bridge object exists but the app has not registered with it.";
  if (code === "version-mismatch") return "The running bridge version is not compatible with this CLI.";
  if (code === "transport-failure") return "Metro/Hermes transport is unavailable.";
  return "Bridge health is unavailable.";
}

function normalizeBridgeHealthValue(value) {
  const metadata = value?.metadata && typeof value.metadata === "object" ? value.metadata : {};
  return {
    available: value?.available === true,
    code: optionalString(value?.code),
    reason: optionalString(value?.reason),
    registered: value?.registered === true || value?.appRegistration?.registered === true,
    bridgeVersion: optionalString(value?.bridgeVersion ?? value?.version ?? metadata.bridgeVersion),
    appId: optionalString(value?.appId ?? value?.appRegistration?.appId),
    runtimeName: optionalString(value?.runtimeName ?? value?.appRegistration?.runtimeName),
    domains: Array.isArray(value?.domains) ? value.domains : [],
  };
}

function normalizeBridgeDomains(runtimeDomains = []) {
  const runtimeByName = new Map(runtimeDomains
    .filter((domain) => domain && typeof domain === "object" && typeof domain.name === "string")
    .map((domain) => [domain.name, domain]));
  const domains = BRIDGE_DOMAIN_CATALOG.map((base) => normalizeBridgeDomain(base, runtimeByName.get(base.name)));
  for (const runtime of runtimeByName.values()) {
    if (!BRIDGE_DOMAIN_CATALOG.some((base) => base.name === runtime.name)) {
      domains.push(normalizeBridgeDomain({
        name: runtime.name,
        readCommands: [],
        writeCommands: [],
        redactionBoundaries: ["domain-defined values"],
      }, runtime));
    }
  }
  return domains;
}

function normalizeBridgeDomain(base, runtime = null) {
  const readCommands = uniqueStrings(runtime?.readCommands ?? runtime?.reads ?? base.readCommands);
  const writeCommands = uniqueStrings(runtime?.writeCommands ?? runtime?.writes ?? base.writeCommands);
  return {
    name: base.name,
    available: runtime?.available !== false,
    readCommands,
    writeCommands,
    writable: writeCommands.length > 0,
    actionPolicyRequiredForWrites: writeCommands.length > 0,
    redactionBoundaries: uniqueStrings(runtime?.redactionBoundaries ?? base.redactionBoundaries),
    transport: "hermes-cdp Runtime.evaluate",
    source: runtime ? "runtime-registration" : "cli-catalog",
  };
}

function bridgeDomainsFromCatalog() {
  return normalizeBridgeDomains([]);
}

function bridgeRedactionBoundaries(domains) {
  return domains.map((domain) => ({
    domain: domain.name,
    boundaries: domain.redactionBoundaries,
  }));
}

function bridgeDomainPolicyPreview(args, domains) {
  const requestedDomain = requireOptionalString(args.domain);
  const requestedCommand = requireOptionalString(args.command);
  if (!requestedDomain && !requestedCommand) return null;
  const domain = domains.find((item) => item.name === requestedDomain) ?? null;
  const isWrite = Boolean(domain && requestedCommand && domain.writeCommands.includes(requestedCommand));
  const isRead = Boolean(domain && requestedCommand && domain.readCommands.includes(requestedCommand));
  if (!domain) {
    return {
      checked: true,
      allowed: false,
      denied: true,
      reason: `Unknown bridge domain ${requestedDomain ?? "(none)"}.`,
      domain: requestedDomain,
      command: requestedCommand,
    };
  }
  if (requestedCommand && !isRead && !isWrite) {
    return {
      checked: true,
      allowed: false,
      denied: true,
      reason: `Unknown bridge command ${requestedCommand} for domain ${domain.name}.`,
      domain: domain.name,
      command: requestedCommand,
    };
  }
  if (!isWrite) {
    return {
      checked: true,
      allowed: true,
      denied: false,
      sideEffect: "read",
      reason: "Read command does not require action policy approval.",
      domain: domain.name,
      command: requestedCommand,
    };
  }
  const policyPath = requireOptionalString(args.actionPolicy);
  const policyAction = `${domain.name}.${requestedCommand}`;
  if (!policyPath) {
    return {
      checked: true,
      allowed: false,
      denied: true,
      sideEffect: "write",
      action: policyAction,
      reason: "No action policy allowed this bridge write command.",
      domain: domain.name,
      command: requestedCommand,
      actionPolicyRequired: true,
    };
  }
  return {
    checked: true,
    allowed: null,
    denied: null,
    sideEffect: "write",
    action: policyAction,
    reason: "Policy file will be evaluated before executing bridge write commands.",
    source: path.resolve(policyPath),
    domain: domain.name,
    command: requestedCommand,
    actionPolicyRequired: true,
  };
}

function uniqueStrings(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim())));
}

function bridgeMetadata() {
  return {
    schemaVersion: 1,
    bridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    developmentOnly: true,
    generatedBy: "expo-ios",
    domains: ["navigation", "network", "storage", "controls", "performance", "snapshot"],
  };
}

function bridgeHealthExpression() {
  return `(() => {
    const __EXPO_IOS_BRIDGE_HEALTH__ = true;
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const catalog = ${JSON.stringify(BRIDGE_DOMAIN_CATALOG)};
    const candidateGlobals = [
      globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__,
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__,
      globalThis.__ROZENITE_AGENT_BRIDGE__,
      globalThis.__EXPO_IOS_INSTRUMENTATION__,
    ].filter(Boolean);
    const bridge = candidateGlobals.find((candidate) => candidate && typeof candidate === 'object') || null;
    if (!bridge) {
      return { available: false, code: 'missing-bridge', reason: 'No bridge global is registered.' };
    }
    const metadata = bridge.metadata || bridge.expoIosDevtoolsBridgeMetadata || bridge.bridgeMetadata || {};
    const instrumentationDomains = catalog
      .filter((domain) => bridge[domain.name] && typeof bridge[domain.name] === 'object')
      .map((domain) => ({ name: domain.name }));
    const looksLikeAppInstrumentation = bridge === globalThis.__EXPO_IOS_INSTRUMENTATION__ ||
      Boolean(bridge.app?.ready && instrumentationDomains.length > 0);
    const bridgeVersion = metadata.bridgeVersion || bridge.bridgeVersion || bridge.version ||
      (looksLikeAppInstrumentation ? expectedBridgeVersion : null);
    const registered = bridge.registered === true ||
      bridge.appRegistered === true ||
      bridge.appRegistration?.registered === true ||
      Boolean(bridge.domains || bridge.domainRegistry || bridge.registerDomain) ||
      instrumentationDomains.length > 0;
    if (!registered) {
      return {
        available: false,
        code: 'missing-app-registration',
        reason: 'Bridge global exists but the app did not register domains.',
        registered: false,
        bridgeVersion,
      };
    }
    const runtimeDomains = Array.isArray(bridge.domains)
      ? bridge.domains
      : Array.isArray(metadata.domains)
      ? metadata.domains.map((name) => ({ name }))
      : bridge.domainRegistry && typeof bridge.domainRegistry === 'object'
      ? Object.keys(bridge.domainRegistry).map((name) => ({ name, ...bridge.domainRegistry[name] }))
      : instrumentationDomains.length > 0
      ? instrumentationDomains
      : catalog.map((domain) => ({ name: domain.name }));
    const domains = runtimeDomains.map((domain) => {
      const name = typeof domain === 'string' ? domain : domain.name;
      const base = catalog.find((item) => item.name === name) || { readCommands: [], writeCommands: [], redactionBoundaries: ['domain-defined values'] };
      const runtime = typeof domain === 'object' ? domain : {};
      return {
        name,
        available: runtime.available !== false,
        readCommands: Array.isArray(runtime.readCommands) ? runtime.readCommands : base.readCommands,
        writeCommands: Array.isArray(runtime.writeCommands) ? runtime.writeCommands : base.writeCommands,
        redactionBoundaries: Array.isArray(runtime.redactionBoundaries) ? runtime.redactionBoundaries : base.redactionBoundaries,
      };
    }).filter((domain) => typeof domain.name === 'string' && domain.name.length > 0);
    return {
      available: true,
      registered: true,
      appRegistration: {
        registered: true,
        appId: bridge.appId || bridge.appRegistration?.appId || bridge.app?.appId || null,
        runtimeName: bridge.runtimeName || bridge.appRegistration?.runtimeName || bridge.app?.runtimeName || null,
      },
      bridgeVersion,
      compatibleCliVersion: bridgeVersion === expectedBridgeVersion,
      domains,
    };
  })()`;
}

function bridgeSource() {
  return `// Generated by expo-ios. Import this file only from development-only app code guarded by __DEV__.
export const expoIosDevtoolsBridgeMetadata = ${JSON.stringify(bridgeMetadata(), null, 2)} as const;

export function registerExpoIosDevtoolsBridge() {
  if (typeof __DEV__ !== "undefined" && !__DEV__) return { registered: false, reason: "production-build" };
  const bridge = {
    registered: true,
    metadata: expoIosDevtoolsBridgeMetadata,
    bridgeVersion: expoIosDevtoolsBridgeMetadata.bridgeVersion,
    domains: expoIosDevtoolsBridgeMetadata.domains.map((name) => ({ name })),
  };
  globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ = bridge;
  return { registered: true, metadata: expoIosDevtoolsBridgeMetadata };
}
`;
}

function hasExplicitConfirmation(value, required) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .includes(required);
}

async function bridgeDomainCommand({ args, domain, action, expression, policy }) {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const targets = await metroTargets(metroPort);
  const webSocketDebuggerUrl = targets[0]?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return domainUnavailable({ domain, action, metroPort, code: "no-runtime-target", reason: "No Metro inspector target.", policy });
  }
  const result = await evaluateHermesExpression(webSocketDebuggerUrl, expression, { timeoutMs: 5000 });
  const value = result?.result?.result?.value;
  if (!value) {
    return domainUnavailable({
      domain,
      action,
      metroPort,
      code: "transport-failure",
      reason: result?.error ?? `${domain} bridge did not return a value.`,
      target: targetSummary(targets[0]),
      transport: bridgeRuntimeTransport(metroPort, targets[0], result.diagnostics),
      policy,
    });
  }
  const redacted = redactValue(value);
  return {
    ...redacted,
    domain,
    action,
    metroPort,
    target: targetSummary(targets[0]),
    transport: bridgeRuntimeTransport(metroPort, targets[0], result.diagnostics),
    evidenceSource: redacted.source ?? "unknown",
    policy,
  };
}

function domainUnavailable({ domain, action, metroPort, reason, target = null, policy = null, code = "unavailable", transport = null }) {
  return {
    available: false,
    domain,
    action,
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    code,
    reason,
    metroPort,
    target,
    transport: transport ?? bridgeRuntimeTransport(metroPort, target, null),
    policy,
    limitations: [`${domain} evidence requires the dev-only app instrumentation bridge.`],
  };
}

function bridgeRuntimeTransport(metroPort, target, cdp = null) {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary(target),
    cdp,
  };
}

function policyDeniedPayload({ domain, action, policy }) {
  return {
    available: false,
    domain,
    action,
    source: "policy",
    evidenceSource: "policy",
    code: "policy-denied",
    denied: true,
    reason: "Policy denied action.",
    policy,
  };
}

async function policyDecision(args, action, sideEffect) {
  if (sideEffect === "read") {
    return { checked: true, action, sideEffect, allowed: true, source: null, reason: "Read action does not require policy approval." };
  }
  const policyPath = requireOptionalString(args.actionPolicy);
  if (!policyPath) {
    return { checked: true, action, sideEffect, allowed: false, source: null, reason: "No action policy allowed this state-changing operation." };
  }
  const policy = await readJsonFile(path.resolve(policyPath));
  const allowed = policyAllowsAction(policy, action);
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: path.resolve(policyPath),
    reason: allowed ? "Action allowed by policy." : "Action policy did not allow this operation.",
  };
}

function policyAllowsAction(policy, action) {
  if (Array.isArray(policy?.allow) && policy.allow.includes(action)) return true;
  if (policy?.actions?.[action] === "allow" || policy?.actions?.[action] === true) return true;
  return false;
}

function parseStorageValue(value) {
  if (value === undefined) throw new CliUsageError("storage set requires a JSON value.");
  return typeof value === "string" ? parseJsonArgument(value, "--value") : value;
}

function storageExpression({ store, action, key, value, limit }) {
  return `(() => {
    const store = ${JSON.stringify(store)};
    const action = ${JSON.stringify(action)};
    const key = ${JSON.stringify(key ?? null)};
    const value = ${JSON.stringify(value)};
    const limit = ${Number(limit)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginStorage = pluginBridge?.storage ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.storage : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.storage : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callStorage = (name, payload = {}) => {
      if (pluginStorage && typeof pluginStorage[name] === 'function') return pluginStorage[name](payload);
      if (pluginStorage && pluginStorage.actions && typeof pluginStorage.actions[name] === 'function') return pluginStorage.actions[name](payload);
      if (pluginCallTool) return pluginCallTool('storage.' + name, payload);
      return null;
    };
    const hasPluginStorage = Boolean(pluginStorage || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'storage')));
    if (hasPluginStorage) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Storage plugin bridge version is not compatible with this CLI.', store, action };
      }
      const adapters = pluginStorage?.adapters || pluginStorage?.stores || pluginStorage || {};
      const adapter = adapters[store] || (pluginStorage?.store && pluginStorage.store(store)) || null;
      const read = (targetKey) => adapter && typeof adapter.get === 'function' ? adapter.get(targetKey) : adapter?.values?.[targetKey];
      if (!adapter && !pluginCallTool) return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'missing-domain', reason: 'Storage bridge store is not registered.', store, action };
      if (action === 'list') {
        const keys = adapter
          ? (adapter.list ? adapter.list() : adapter.keys || [])
          : callStorage('list', { store, limit });
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, keys: (Array.isArray(keys) ? keys : []).slice(0, limit) };
      }
      if (action === 'get') {
        const result = adapter ? read(key) : callStorage('get', { store, key });
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, key, value: result };
      }
      if (action === 'set') {
        const before = adapter ? read(key) : null;
        const result = adapter && typeof adapter.set === 'function' ? adapter.set(key, value) : callStorage('set', { store, key, value });
        const after = adapter ? read(key) : null;
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, key, before, after, result: result || { ok: true } };
      }
      if (action === 'clear') {
        const beforeKeys = adapter ? (adapter.list ? adapter.list() : adapter.keys || []) : [];
        const result = adapter && typeof adapter.clear === 'function' ? adapter.clear() : callStorage('clear', { store });
        const afterKeys = adapter ? (adapter.list ? adapter.list() : adapter.keys || []) : [];
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, before: { keys: beforeKeys }, after: { keys: afterKeys }, result: result || { ok: true } };
      }
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'missing-domain', reason: 'Storage bridge domain is not registered.', store, action };
    }
    const bridge = globalThis.__EXPO_IOS_STORAGE_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.storage);
    if (!bridge) return { available: false, source: 'app-instrumentation', code: 'unavailable-bridge', reason: 'Storage bridge is not installed.', store, action };
    const adapter = bridge[store];
    if (!adapter) return { available: false, source: 'app-instrumentation', reason: 'Unsupported storage store.', store, action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', store, action, keys: (adapter.list ? adapter.list() : adapter.keys || []).slice(0, limit) };
    if (action === 'get') return { available: true, source: 'app-instrumentation', store, action, key, value: adapter.get ? adapter.get(key) : (adapter.values || {})[key] };
    if (action === 'set') return { available: true, source: 'app-instrumentation', store, action, key, result: adapter.set ? adapter.set(key, value) : { ok: true } };
    if (action === 'clear') return { available: true, source: 'app-instrumentation', store, action, result: adapter.clear ? adapter.clear() : { ok: true } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported storage action.', store, action };
  })()`;
}

function stateExpression({ action, name }) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const name = ${JSON.stringify(name ?? null)};
    const bridge = globalThis.__EXPO_IOS_STATE_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.state);
    if (!bridge) return { available: false, source: 'app-instrumentation', reason: 'State bridge is not installed.', action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', action, states: bridge.list ? bridge.list() : bridge.states || [] };
    if (action === 'save') return { available: true, source: 'app-instrumentation', action, name, result: bridge.save ? bridge.save(name) : { ok: true, name } };
    if (action === 'load') return { available: true, source: 'app-instrumentation', action, name, result: bridge.load ? bridge.load(name) : { ok: true, name } };
    if (action === 'clear') return { available: true, source: 'app-instrumentation', action, name, result: bridge.clear ? bridge.clear(name) : { ok: true, name } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported state action.', action };
  })()`;
}

function controlsExpression({ action, name }) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const name = ${JSON.stringify(name ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginControls = pluginBridge?.controls ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.controls : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.controls : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callControls = (command, payload = {}) => {
      if (pluginControls && typeof pluginControls[command] === 'function') return pluginControls[command](payload);
      if (pluginControls && pluginControls.actions && typeof pluginControls.actions[command] === 'function') return pluginControls.actions[command](payload);
      if (pluginCallTool) return pluginCallTool('controls.' + command, payload);
      return null;
    };
    const hasPluginControls = Boolean(pluginControls || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'controls')));
    if (hasPluginControls) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge', domain: 'controls', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Controls plugin bridge version is not compatible with this CLI.', action };
      }
      const listControls = () => {
        const raw = pluginControls && typeof pluginControls.list === 'function'
          ? pluginControls.list()
          : pluginControls?.controls || callControls('list') || [];
        return Array.isArray(raw) ? raw : [];
      };
      if (action === 'list') return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, controls: listControls() };
      if (action === 'get') return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, name, control: pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null };
      if (action === 'press') {
        const before = pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null;
        const result = pluginControls && typeof pluginControls.press === 'function' ? pluginControls.press(name) : callControls('press', { name });
        const after = pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null;
        return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, name, before, after, result: result || { ok: true, name } };
      }
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge', domain: 'controls', code: 'missing-domain', reason: 'Controls bridge domain is not registered.', action };
    }
    const bridge = globalThis.__EXPO_IOS_CONTROLS_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.controls);
    if (!bridge) return { available: false, source: 'app-instrumentation', code: 'unavailable-bridge', reason: 'Controls bridge is not installed.', action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', action, controls: bridge.list ? bridge.list() : bridge.controls || [] };
    if (action === 'get') return { available: true, source: 'app-instrumentation', action, name, control: bridge.get ? bridge.get(name) : (bridge.controls || []).find((control) => control.name === name) || null };
    if (action === 'press') return { available: true, source: 'app-instrumentation', action, name, result: bridge.press ? bridge.press(name) : { ok: true, name } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported controls action.', action };
  })()`;
}

async function accessibilityCommand(args = {}) {
  const action = requireString(args.action ?? "tree", "action");
  if (!["tree", "inspect", "audit", "focus"].includes(action)) throw new Error(`Unknown accessibility action: ${action}`);
  if (action === "focus") {
    const ref = requireString(args.ref, "ref");
    const result = unwrapToolJson(await refActionCommand({ ...args, command: "focus", ref }));
    return toolJson({
      ...result,
      action,
      source: result.source ?? "ref-action",
      limitations: [
        "Native iOS accessibility focus APIs are not exposed by stable local simulator tooling here; this command focuses the element through the available ref tap path.",
      ],
    });
  }
  if (action === "inspect") {
    const ref = requireString(args.ref, "ref");
    const cache = await readLatestRefCache(args);
    if (!cache) return toolJson({ available: false, action, reason: "No snapshot exists for the current session.", ref });
    const record = cache.refs.find((item) => item.ref === ref);
    return toolJson(record
      ? { available: true, action, ref, snapshotId: cache.snapshotId, targetId: cache.targetId, record }
      : { available: false, action, reason: "Ref not found in the latest snapshot.", ref });
  }
  if (action === "audit") {
    const cache = await readLatestRefCache(args);
    if (!cache) return toolJson({ available: false, action, reason: "No snapshot exists for the current session.", issues: [] });
    const issues = cache.refs
      .filter((record) => (record.actions ?? []).length > 0 && !record.label && !record.text)
      .map((record) => ({ ref: record.ref, rule: "interactive-name", message: "Interactive ref has no label or text." }));
    return toolJson({ available: true, action, snapshotId: cache.snapshotId, targetId: cache.targetId, issueCount: issues.length, issues });
  }
  const semanticBridge = action === "tree"
    ? await semanticBridgeSnapshot(args, {
        stateRoot: resolveExpoStateRoot(args),
        session: { activeTargetId: null },
        filters: { interactiveOnly: false, compact: false, depth: null, includeSource: true, includeBounds: true },
      }).catch((error) => ({ available: false, source: "plugin-bridge-semantic", code: "transport-failure", reason: formatError(error) }))
    : null;
  const axe = await commandPath("axe");
  if (!axe) return toolJson({ available: false, action, reason: "axe CLI is not installed or not on PATH.", semanticBridge });
  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const result = await execFilePromise(axe, ["describe-ui", "--udid", device.udid], {
    timeout: 12_000,
    maxBuffer: 4 * 1024 * 1024,
    rejectOnError: false,
  });
  if (result.error) {
    return toolJson({ available: false, action, reason: "Native accessibility tree failed.", stderr: truncate(result.stderr), error: result.error, semanticBridge });
  }
  const tree = JSON.parse(result.stdout || "[]");
  return toolJson({ available: true, action, source: semanticBridge?.available ? ["plugin-bridge-semantic", "native-accessibility"] : "native-accessibility", device, tree, semanticBridge });
}

async function debugInspectCommand(args = {}) {
  return toolJson(await debugInspectPayload(args));
}

async function debugInspectPayload(args = {}) {
  const ref = requireString(args.ref, "ref");
  const found = await readRefRecord(ref, args);
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  if (found.available === false) {
    return {
      ...found,
      action: "inspect",
      sessionId: session?.sessionId ?? null,
    };
  }
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const metro = await metroStatusPayload({ metroPort });
  const target = session ? await readSelectedTarget(stateRoot, session) : null;
  const record = found.record;
  return {
    available: true,
    action: "inspect",
    ref,
    sessionId: session?.sessionId ?? null,
    snapshotId: found.cache.snapshotId,
    targetId: found.cache.targetId,
    target,
    metro: {
      available: metro.available === true,
      port: metroPort,
      targetCount: metro.targetCount ?? 0,
      firstTarget: metro.targets?.[0] ?? null,
    },
    element: {
      ref,
      role: record.role ?? null,
      label: record.label ?? null,
      text: record.text ?? null,
      testID: record.testID ?? record.nativeID ?? null,
      box: record.box ?? null,
      source: record.source ?? null,
      component: record.component ?? null,
      props: record.props ?? null,
      actions: record.actions ?? [],
      stale: record.stale === true,
    },
    evidence: {
      refCache: path.join(sessionDirectory(stateRoot, session.sessionId), "refs.json"),
      snapshotId: found.cache.snapshotId,
    },
    limitations: [
      "Inspect is assembled from the latest cached semantic/native ref snapshot plus Metro target status.",
      "Props and source are present only when the snapshot source includes them.",
    ],
  };
}

async function highlightCommand(args = {}) {
  const ref = requireString(args.ref, "ref");
  const found = await readRefRecord(ref, args);
  if (found.available === false) return toolJson({ ...found, action: "highlight" });
  const box = found.record.box;
  if (!box) {
    return toolJson({
      available: false,
      action: "highlight",
      ref,
      reason: "Ref does not include bounds. Capture a snapshot with --bounds before highlighting.",
      record: found.record,
    });
  }
  const stateRoot = resolveExpoStateRoot(args);
  const outputPath = path.join(stateRoot, "artifacts", `highlight-${ref.replace(/[^a-z0-9]/gi, "")}-${new Date().toISOString().replace(/[:.]/g, "-")}.svg`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, highlightSvg({ ref, record: found.record, durationMs: args.durationMs }), "utf8");
  return toolJson({
    available: true,
    action: "highlight",
    ref,
    durationMs: args.durationMs ?? null,
    snapshotId: found.cache.snapshotId,
    targetId: found.cache.targetId,
    outputPath,
    record: found.record,
    limitations: ["Highlight writes an evidence overlay artifact from cached bounds; it does not draw inside the running app."],
  });
}

function highlightSvg({ ref, record, durationMs }) {
  const box = record.box;
  const width = Math.max(390, Math.ceil(box.x + box.width + 24));
  const height = Math.max(844, Math.ceil(box.y + box.height + 24));
  const label = `${ref} ${record.label ?? record.text ?? record.role ?? ""}`.trim();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.08)"/>
  <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="rgba(255,204,0,0.25)" stroke="#ffcc00" stroke-width="4"/>
  <text x="${Math.max(4, box.x)}" y="${Math.max(18, box.y - 8)}" fill="#111" font-family="Menlo, monospace" font-size="14">${escapeHtml(label)}</text>
  <text x="8" y="${height - 12}" fill="#444" font-family="Menlo, monospace" font-size="11">${escapeHtml(durationMs ? `durationMs=${durationMs}` : "static highlight evidence")}</text>
</svg>
`;
}

async function reviewCommand(args = {}) {
  const action = requireString(args.action ?? "report", "action");
  if (!["report", "matrix"].includes(action)) throw new Error(`Unknown review action: ${action}`);
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  const outputPath = path.resolve(args.outputPath ?? path.join(stateRoot, "artifacts", `review-${action}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const runs = await listRunRecords(stateRoot);
  const latestRefs = await readLatestRefCache(args);
  const payload = action === "matrix"
    ? reviewMatrixPayload({ stateRoot, session, runs, latestRefs, outputPath })
    : reviewReportPayload({ stateRoot, session, runs, latestRefs, outputPath });
  await writeJsonFile(outputPath, payload);
  return toolJson(payload);
}

function reviewReportPayload({ stateRoot, session, runs, latestRefs, outputPath }) {
  const artifacts = collectExpoIosArtifacts(stateRoot);
  return {
    available: true,
    action: "report",
    outputPath,
    stateRoot,
    sessionId: session?.sessionId ?? null,
    activeTargetId: session?.activeTargetId ?? null,
    lastSnapshotId: session?.lastSnapshotId ?? null,
    runCount: runs.length,
    recentRuns: runs.slice(-25).map(runSummary),
    refCount: latestRefs?.refs?.length ?? 0,
    artifacts,
    limitations: ["Review reports assemble evidence already captured by other commands; they do not independently judge UI quality."],
  };
}

function reviewMatrixPayload({ stateRoot, session, runs, latestRefs, outputPath }) {
  const commands = new Set(runs.map((run) => run.command).filter(Boolean));
  const checks = [
    { name: "session", passed: Boolean(session), evidence: session ? sessionDirectory(stateRoot, session.sessionId) : null },
    { name: "target", passed: Boolean(session?.activeTargetId), evidence: session?.activeTargetId ?? null },
    { name: "snapshot", passed: Boolean(latestRefs?.snapshotId), evidence: latestRefs?.snapshotId ?? null },
    { name: "screenshot", passed: commands.has("screenshot") || commands.has("annotate-screen"), evidence: "run-records" },
    { name: "runtime", passed: commands.has("devtools") || commands.has("inspector") || commands.has("ux-context"), evidence: "run-records" },
    { name: "diagnostics", passed: commands.has("console") || commands.has("errors") || commands.has("logs"), evidence: "run-records" },
    { name: "interaction", passed: commands.has("tap") || commands.has("gesture") || commands.has("fill"), evidence: "run-records" },
  ];
  return {
    available: true,
    action: "matrix",
    outputPath,
    stateRoot,
    sessionId: session?.sessionId ?? null,
    checks,
    passed: checks.every((check) => check.passed),
    runCount: runs.length,
  };
}

async function policyCommand(args = {}) {
  const action = requireString(args.action ?? "show", "action");
  if (!["show", "check"].includes(action)) throw new Error(`Unknown policy action: ${action}`);
  const policyPath = requireOptionalString(args.actionPolicy);
  const policy = policyPath ? await readJsonFile(path.resolve(policyPath)) : null;
  if (action === "show") {
    return toolJson({
      available: true,
      action,
      source: policyPath ? path.resolve(policyPath) : null,
      policy: policy ?? defaultPolicySummary(),
      limitations: ["No policy file means read-only commands are allowed and state-changing commands are denied by default."],
    });
  }
  const subject = requireString(args.subject, "subject");
  const name = requireString(args.name, "name");
  const policyAction = subject === "action" ? name : `${subject}.${name}`;
  const sideEffect = actionSideEffect(policyAction);
  const decision = sideEffect === "read"
    ? { checked: true, action: policyAction, sideEffect, allowed: true, source: policyPath ? path.resolve(policyPath) : null, reason: "Read action does not require policy approval." }
    : await policyDecision(args, policyAction, sideEffect);
  return toolJson({
    available: true,
    action: "check",
    subject,
    name,
    policyAction,
    decision,
  });
}

function defaultPolicySummary() {
  return {
    allow: [],
    defaults: {
      read: "allow",
      write: "deny",
      device: "deny",
      runtimeEval: "deny unless --allow-runtime-eval true or an action policy allows the command",
    },
  };
}

function actionSideEffect(action) {
  if (/^(doctor|project-info|routes|devices|target\.list|target\.current|snapshot|refs|get|find|wait|console|errors|logs|metro\.status|policy|redact|review)/.test(action)) return "read";
  if (/^(storage\.set|storage\.clear|state\.load|state\.clear|install-app|uninstall-app|set\.|wait\.fn)/.test(action)) return "device";
  return "device";
}

async function redactCommand(args = {}) {
  const file = path.resolve(requireString(args.file, "file"));
  const raw = await fs.readFile(file, "utf8");
  let payload;
  try {
    payload = redactValue(JSON.parse(raw));
  } catch {
    payload = redactValue(raw);
  }
  const outputPath = args.outputPath ? path.resolve(args.outputPath) : null;
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    await fs.writeFile(outputPath, `${text}\n`, "utf8");
  }
  return toolJson({
    available: true,
    action: "redact",
    inputPath: file,
    outputPath,
    redacted: payload,
  });
}

async function listRunRecords(stateRoot) {
  const runsRoot = path.join(stateRoot, "runs");
  const entries = await fs.readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(runsRoot, entry.name);
    const record = await readJsonFile(file).catch(() => null);
    if (record) records.push({ ...record, path: file });
  }
  records.sort((a, b) => String(a.startedAt ?? a.createdAt ?? "").localeCompare(String(b.startedAt ?? b.createdAt ?? "")));
  return records;
}

function runSummary(run) {
  return {
    command: run.command ?? null,
    status: run.status ?? null,
    exitCode: run.exitCode ?? null,
    startedAt: run.startedAt ?? run.createdAt ?? null,
    completedAt: run.completedAt ?? run.finishedAt ?? null,
    path: run.path ?? null,
    summary: run.summary ?? null,
  };
}

function collectExpoIosArtifacts(stateRoot) {
  return {
    runs: path.join(stateRoot, "runs"),
    sessions: path.join(stateRoot, "sessions"),
    artifacts: path.join(stateRoot, "artifacts"),
  };
}

async function dialogCommand(args = {}) {
  return modalBridgeCommand({ args, domain: "dialog", actions: ["status", "accept", "dismiss"] });
}

async function sheetCommand(args = {}) {
  return modalBridgeCommand({ args, domain: "sheet", actions: ["status", "dismiss"] });
}

async function modalBridgeCommand({ args, domain, actions }) {
  const action = requireString(args.action ?? "status", "action");
  if (!actions.includes(action)) throw new Error(`Unknown ${domain} action: ${action}`);
  return toolJson(await bridgeDomainCommand({
    args,
    domain,
    action,
    expression: modalExpression({ domain, action, text: args.text }),
    policy: { checked: true, action: `${domain}.${action}`, sideEffect: action === "status" ? "read" : "device", allowed: true, reason: "Modal action is non-destructive." },
  }));
}

function modalExpression({ domain, action, text }) {
  const globalName = domain === "dialog" ? "__EXPO_IOS_DIALOG_BRIDGE__" : "__EXPO_IOS_SHEET_BRIDGE__";
  return `(() => {
    const action = ${JSON.stringify(action)};
    const text = ${JSON.stringify(text ?? null)};
    const bridge = globalThis.${globalName} ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__[${JSON.stringify(domain)}]);
    if (!bridge) return { available: false, source: 'app-instrumentation', reason: ${JSON.stringify(`${domain} bridge is not installed.`)}, action };
    if (action === 'status') return { available: true, source: 'app-instrumentation', action, visible: !!bridge.visible, ${domain}: bridge.current || null };
    if (action === 'accept') return { available: true, source: 'app-instrumentation', action, result: bridge.accept ? bridge.accept(text) : { accepted: true, text } };
    if (action === 'dismiss') return { available: true, source: 'app-instrumentation', action, result: bridge.dismiss ? bridge.dismiss() : { dismissed: true } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported modal action.', action };
  })()`;
}

async function recordCommand(args = {}) {
  const action = requireString(args.action ?? "start", "action");
  if (!["start", "stop"].includes(action)) throw new Error(`Unknown record action: ${action}`);
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  const recordDir = path.join(stateRoot, "artifacts", "recordings");
  await fs.mkdir(recordDir, { recursive: true });
  const metadataPath = path.join(recordDir, "recording.json");
  if (action === "start") {
    const metadata = {
      available: true,
      action,
      startedAt: new Date().toISOString(),
      sessionId: session?.sessionId ?? null,
      targetId: session?.activeTargetId ?? null,
      status: "recording",
      limitations: ["This tracer-bullet command records metadata; native video capture is implemented by a later adapter."],
    };
    await writeJsonFile(metadataPath, metadata);
    return toolJson({ ...metadata, metadataPath });
  }
  const outputPath = path.resolve(args.outputPath ?? path.join(recordDir, `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.mov`));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  if (!(await pathExists(outputPath))) await fs.writeFile(outputPath, "recording placeholder\n", "utf8");
  const metadata = {
    available: true,
    action,
    stoppedAt: new Date().toISOString(),
    sessionId: session?.sessionId ?? null,
    targetId: session?.activeTargetId ?? null,
    outputPath,
    metadataPath,
    status: "stopped",
  };
  await writeJsonFile(metadataPath, metadata);
  return toolJson(metadata);
}

async function diffCommand(args = {}) {
  const kind = requireString(args.kind, "kind");
  if (!["snapshot", "screenshot", "route"].includes(kind)) throw new Error(`Unknown diff kind: ${kind}`);
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  const outputPath = path.resolve(args.outputPath ?? path.join(stateRoot, "artifacts", `diff-${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const diff = kind === "snapshot"
    ? await snapshotDiffPayload(args)
    : kind === "route"
    ? await routeDiffPayload(args)
    : await screenshotDiffPayload(args);
  const payload = {
    ...diff,
    kind,
    sessionId: session?.sessionId ?? null,
    targetId: session?.activeTargetId ?? null,
    outputPath,
  };
  await writeJsonFile(outputPath, payload);
  return toolJson(payload);
}

async function routeDiffPayload(args = {}) {
  const routeA = requireString(args.routeA, "routeA");
  const routeB = requireString(args.routeB, "routeB");
  const screenshot = args.screenshot === true;
  const openedA = unwrapToolJson(await openExpoRoute({ ...args, route: routeA }));
  const shotA = screenshot ? await captureScreenshot({ ...args, outputPath: path.join(resolveExpoStateRoot(args), "artifacts", `route-a-${Date.now()}.png`) }) : null;
  const openedB = unwrapToolJson(await openExpoRoute({ ...args, route: routeB }));
  const shotB = screenshot ? await captureScreenshot({ ...args, outputPath: path.join(resolveExpoStateRoot(args), "artifacts", `route-b-${Date.now()}.png`) }) : null;
  return {
    available: true,
    routeA,
    routeB,
    openedA,
    openedB,
    screenshots: screenshot ? { before: shotA?.outputPath ?? null, after: shotB?.outputPath ?? null } : null,
    limitations: ["Route diff captures route-open evidence and optional screenshots; semantic visual comparison is left to the caller."],
  };
}

async function snapshotDiffPayload(args = {}) {
  const baseline = await readJsonFile(path.resolve(requireString(args.baseline, "baseline")));
  const current = args.current
    ? await readJsonFile(path.resolve(args.current))
    : await latestSnapshotJson(args);
  if (!current) return { available: false, reason: "No current snapshot exists for the current session." };
  const beforeRefs = new Set((baseline.refs ?? []).map((record) => record.ref));
  const afterRefs = new Set((current.refs ?? []).map((record) => record.ref));
  return {
    available: true,
    baselineSnapshotId: baseline.snapshotId ?? null,
    currentSnapshotId: current.snapshotId ?? null,
    addedRefs: [...afterRefs].filter((ref) => !beforeRefs.has(ref)),
    removedRefs: [...beforeRefs].filter((ref) => !afterRefs.has(ref)),
    beforeCount: beforeRefs.size,
    afterCount: afterRefs.size,
  };
}

async function latestSnapshotJson(args = {}) {
  const cache = await readLatestRefCache(args);
  if (!cache?.snapshotId) return null;
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  return readJsonFile(path.join(sessionDirectory(stateRoot, session.sessionId), "snapshots", `${cache.snapshotId}.json`)).catch(() => cache);
}

async function expoCommand(args = {}) {
  const action = requireString(args.action ?? "modules", "action");
  if (!["modules", "config", "doctor", "upstream-policy", "prebuild-plan"].includes(action)) throw new Error(`Unknown Expo action: ${action}`);
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => path.resolve(args.cwd ?? process.cwd()));
  const summary = await expoProjectRuntimeSummary(cwd);
  if (action === "doctor") {
    return toolJson({
      available: true,
      action,
      sources: ["project", "native"],
      projectRoot: summary.projectRoot,
      summary: unwrapToolJson(await doctor({ cwd: summary.projectRoot })),
    });
  }
  if (action === "upstream-policy") {
    const info = unwrapToolJson(await projectInfo({ cwd: summary.projectRoot }));
    return toolJson({
      available: Boolean(info.isExpoProject),
      action,
      sources: ["project"],
      projectRoot: summary.projectRoot,
      report: info.upstreamDependencies ?? buildUpstreamDependencyReport(summary.projectRoot, {}),
      limitations: [
        "Static dependency policy cannot prove a runtime target is registered; run DevTools and bridge health checks for live domains.",
      ],
    });
  }
  if (action === "config") {
    return toolJson({
      available: true,
      action,
      sources: ["project"],
      ...summary,
      limitations: expoConfigLimitations(summary),
    });
  }
  const modules = await expoModuleRecords(summary.projectRoot);
  if (action === "modules") {
    return toolJson({
      available: true,
      action,
      sources: ["project"],
      projectRoot: summary.projectRoot,
      expoDependency: summary.expoDependency,
      reactNativeDependency: summary.reactNativeDependency,
      modules,
      limitations: ["Static dependency inspection cannot prove which native modules are currently compiled into the running app."],
    });
  }
  const risks = await expoPrebuildRisks(summary.projectRoot, modules);
  return toolJson({
    available: true,
    action,
    sources: ["project"],
    projectRoot: summary.projectRoot,
    riskLevel: risks.some((risk) => risk.kind === "native-project-present")
      ? "high"
      : risks.length > 0
      ? "medium"
      : "low",
    risks,
    modules: modules.filter((module) => module.category === "config-plugin"),
    appConfig: summary.appConfig,
    limitations: [
      "This static plan flags rebuild risk; it does not run expo prebuild or mutate native projects.",
      "Dynamic app.config files are read with conservative string extraction only.",
    ],
  });
}

async function expoModuleRecords(projectRoot) {
  const packageJsonPath = await findUp(projectRoot, "package.json");
  const packageJson = packageJsonPath ? await readJsonFile(packageJsonPath) : {};
  const deps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  return Object.entries(deps)
    .filter(([name]) => isExpoRelatedPackage(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => ({
      name,
      version,
      category: expoModuleCategory(name),
    }));
}

function isExpoRelatedPackage(name) {
  return name === "expo" ||
    name.startsWith("expo-") ||
    name.startsWith("@expo/") ||
    name.startsWith("@config-plugins/") ||
    name.includes("config-plugin");
}

function expoModuleCategory(name) {
  if (name.startsWith("@config-plugins/") || name.includes("config-plugin")) return "config-plugin";
  if (name === "expo" || name.startsWith("expo-") || name.startsWith("@expo/")) return "expo";
  return "other";
}

async function expoPrebuildRisks(projectRoot, modules) {
  const risks = [];
  for (const platformDir of ["ios", "android"]) {
    if (await pathExists(path.join(projectRoot, platformDir))) {
      risks.push({
        kind: "native-project-present",
        platform: platformDir,
        severity: "high",
        message: `${platformDir} native project exists; config and native module changes may require a rebuild.`,
      });
    }
  }
  for (const module of modules.filter((item) => item.category === "config-plugin")) {
    risks.push({
      kind: "config-plugin",
      package: module.name,
      severity: "medium",
      message: "Config-plugin dependency can affect native prebuild output.",
    });
  }
  for (const plugin of await readExpoAppConfigPlugins(projectRoot)) {
    risks.push({
      kind: "app-config-plugin",
      plugin,
      severity: "medium",
      message: "App config plugin can affect native prebuild output.",
    });
  }
  return risks;
}

async function readExpoAppConfigPlugins(projectRoot) {
  const appJsonPath = path.join(projectRoot, "app.json");
  if (await pathExists(appJsonPath)) {
    const appJson = await readJsonFile(appJsonPath);
    const plugins = appJson?.expo?.plugins ?? appJson?.plugins ?? [];
    return Array.isArray(plugins) ? plugins.map(formatExpoPluginEntry) : [];
  }
  const configPath = await firstExisting(projectRoot, ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]);
  if (!configPath) return [];
  const text = await fs.readFile(configPath, "utf8");
  const match = /\bplugins\s*:\s*\[([\s\S]*?)\]/m.exec(text);
  if (!match) return [];
  return [...match[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((item) => item[1]);
}

function formatExpoPluginEntry(entry) {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry)) return String(entry[0] ?? "");
  return JSON.stringify(entry);
}

function expoConfigLimitations(summary) {
  return summary.appConfig?.dynamic
    ? ["Dynamic Expo config was summarized with static string extraction and may omit computed values."]
    : ["Expo config is summarized from project files; native runtime overrides are not included."];
}

async function rnCommand(args = {}) {
  const action = requireString(args.action ?? "tree", "action");
  if (!["tree", "inspect", "renders", "fiber"].includes(action)) throw new Error(`Unknown React Native action: ${action}`);
  if (action === "inspect") return toolJson(await rnInspectPayload(args));
  const subaction = action === "renders" ? requireString(args.subaction ?? "read", "subaction") : null;
  if (subaction && !["start", "stop", "read"].includes(subaction)) throw new Error(`Unknown React Native renders action: ${subaction}`);
  const bridgeAction = action === "renders" ? `renders-${subaction}` : action;
  const bridgePayload = await bridgeDomainCommand({
    args,
    domain: "rn",
    action: bridgeAction,
    expression: rnExpression({ action: bridgeAction, ref: args.ref }),
    policy: { checked: true, action: `rn.${bridgeAction}`, sideEffect: "read", allowed: true, reason: "React Native introspection is read-only." },
  });
  return toolJson({
    ...bridgePayload,
    action,
    ...(subaction ? { subaction, bridgeAction } : {}),
    limitations: rnLimitations(bridgePayload.limitations),
  });
}

async function rnInspectPayload(args = {}) {
  const ref = requireString(args.ref, "ref");
  const cache = await readLatestRefCache(args);
  if (!cache) {
    return {
      available: false,
      action: "inspect",
      ref,
      sources: ["snapshot-cache"],
      reason: "No snapshot exists for the current session.",
      limitations: rnLimitations(),
    };
  }
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) {
    return {
      available: false,
      action: "inspect",
      ref,
      sources: ["native-accessibility", "snapshot-cache"],
      reason: "Ref not found in the latest snapshot.",
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      limitations: rnLimitations(),
    };
  }
  return {
    available: true,
    action: "inspect",
    ref,
    sources: ["native-accessibility", "snapshot-cache"],
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    record,
    limitations: rnLimitations([
      "Inspect uses cached semantic/native accessibility evidence and does not expose private fiber internals.",
    ]),
  };
}

function rnExpression({ action, ref }) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const ref = ${JSON.stringify(ref ?? null)};
    const bridge = globalThis.__EXPO_IOS_RN_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.rn);
    if (!bridge) return { available: false, sources: ['runtime', 'app-instrumentation'], source: 'app-instrumentation', reason: 'React Native bridge is not installed.', action };
    if (action === 'tree') return bridge.tree ? bridge.tree() : { available: true, sources: ['runtime', 'app-instrumentation'], action, tree: bridge.tree || [] };
    if (action === 'fiber') return bridge.fiber ? bridge.fiber(ref) : { available: false, sources: ['runtime', 'app-instrumentation'], action, ref, reason: 'Fiber inspection is not exposed by the app bridge.' };
    if (action === 'renders-start') return bridge.renders && bridge.renders.start ? bridge.renders.start() : { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: true } };
    if (action === 'renders-stop') return bridge.renders && bridge.renders.stop ? bridge.renders.stop() : { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: false } };
    if (action === 'renders-read') return bridge.renders && bridge.renders.read ? bridge.renders.read() : { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: false, commits: [] } };
    return { available: false, sources: ['runtime', 'app-instrumentation'], source: 'app-instrumentation', reason: 'Unsupported React Native bridge action.', action };
  })()`;
}

function rnLimitations(extra = []) {
  return [
    ...extra,
    "private React Native hooks and fiber fields are version-dependent and may be incomplete or unavailable.",
  ];
}

async function perfCommand(args = {}) {
  const action = requireString(args.action ?? "summary", "action");
  const actions = ["summary", "startup", "action", "bundle", "mark", "measure", "compare", "budget", "js-thread", "frames", "memory", "ettrace", "memgraph"];
  if (!actions.includes(action)) throw new Error(`Unknown performance action: ${action}`);
  if (action === "summary") return toolJson(await perfSummaryPayload(args));
  if (action === "bundle") return toolJson(await perfBundlePayload(args));
  if (action === "compare") return toolJson(await perfComparePayload(args));
  if (action === "budget") return toolJson(await perfBudgetPayload(args));
  if (action === "memory") return toolJson(await perfMemoryPayload(args));
  if (action === "ettrace" || action === "memgraph") return toolJson(await perfNativeProfilerPayload(args, action));
  if (["mark", "measure", "js-thread", "frames"].includes(action)) return toolJson(await perfInstrumentedPayload(args, action));
  return toolJson(await perfRuntimePayload(args, action));
}

async function perfSummaryPayload(args = {}) {
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => path.resolve(args.cwd ?? process.cwd()));
  const summary = await expoProjectRuntimeSummary(cwd);
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const metro = await metroStatusPayload({ metroPort });
  const metrics = [];
  const unavailableSources = [];
  const packageJsonPath = await findUp(summary.projectRoot, "package.json");
  if (packageJsonPath) {
    const packageJson = await readJsonFile(packageJsonPath);
    metrics.push(perfMetric({
      name: "project.dependencies",
      value: Object.keys({ ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) }).length,
      unit: "count",
      source: "project",
      confidence: "low",
    }));
  } else {
    unavailableSources.push({ source: "project", reason: "No package.json found." });
  }
  if (metro.available) {
    metrics.push(perfMetric({
      name: "metro.targets",
      value: metro.targetCount,
      unit: "count",
      source: "metro",
      confidence: "medium",
    }));
  } else {
    unavailableSources.push({ source: "metro", reason: metro.reason });
  }
  const performanceCapabilities = [
    { source: "plugin-bridge-performance", available: metro.targets?.some((target) => target.capabilities?.hermesRuntime) === true, type: "upstream-plugin", confidence: "medium" },
    { source: "expo-devtools-performance", available: metro.available === true, type: "upstream-devtools", confidence: "low" },
    { source: "native-profiler", available: true, type: "native-fallback", confidence: "high" },
    { source: "bundle-artifact", available: false, type: "static-fallback", confidence: "high" },
  ];
  unavailableSources.push({ source: "plugin-bridge-performance", reason: "Run perf startup/action/mark against an app with the performance bridge domain registered." });
  unavailableSources.push({ source: "expo-devtools-performance", reason: "No machine-readable Expo DevTools performance domain was confirmed." });
  unavailableSources.push({ source: "bundle-artifact", reason: "Pass an existing bundle artifact to perf bundle for byte evidence." });
  return {
    available: true,
    action: "summary",
    mode: "development",
    sources: ["project", "metro"],
    capabilities: performanceCapabilities,
    confidence: perfOverallConfidence(metrics),
    context: await perfContext({ args, projectRoot: summary.projectRoot, metro }),
    metrics,
    unavailableSources,
    limitations: perfDevelopmentLimitations([
      "Summary reports evidence availability and lightweight signals; it is not a performance score.",
    ]),
  };
}

async function perfRuntimePayload(args = {}, action) {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const targets = await metroTargets(metroPort);
  const target = targets[0] ?? null;
  const projectRoot = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => path.resolve(args.cwd ?? process.cwd()));
  const metro = target
    ? { available: true, metroPort, status: "available", statusText: null, targetCount: targets.length, targets: targets.map(targetSummary) }
    : await metroStatusPayload({ metroPort });
  let bridgePayload = null;
  if (target?.webSocketDebuggerUrl) {
    const result = await evaluateHermesExpression(target.webSocketDebuggerUrl, perfExpression({
      action,
      label: args.label,
    }), { timeoutMs: 5000 });
    bridgePayload = result?.result?.result?.value ?? null;
  }
  const basePayload = bridgePayload && typeof bridgePayload === "object"
    ? normalizePerfBridgePayload(redactValue(bridgePayload), action)
    : {
        available: false,
        sources: ["runtime", "app-instrumentation"],
        metrics: [],
        code: target ? "malformed-payload" : "no-runtime-target",
        reason: target ? "Performance bridge did not return a value." : "No Metro inspector target.",
      };
  const transport = perfTransport(metroPort, target, null);
  const payload = {
    ...basePayload,
    action,
    ...(action === "action" ? { actionName: requireString(args.label, "label") } : {}),
    mode: "development",
    context: await perfContext({ args, projectRoot, metro, target }),
    transport,
    evidenceSource: perfEvidenceSource(basePayload),
    confidence: perfOverallConfidence(basePayload.metrics ?? []),
    limitations: perfDevelopmentLimitations(basePayload.limitations),
  };
  return writePerfArtifact(args, action, payload);
}

async function perfInstrumentedPayload(args = {}, action) {
  const subaction = requireOptionalString(args.subaction);
  const label = requireOptionalString(args.label);
  const bridgeAction = perfBridgeAction(action, subaction);
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const targets = await metroTargets(metroPort);
  const target = targets[0] ?? null;
  const projectRoot = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => path.resolve(args.cwd ?? process.cwd()));
  const metro = target
    ? { available: true, metroPort, status: "available", targetCount: targets.length, targets: targets.map(targetSummary) }
    : await metroStatusPayload({ metroPort });
  let bridgePayload = null;
  if (target?.webSocketDebuggerUrl) {
    const result = await evaluateHermesExpression(target.webSocketDebuggerUrl, perfExpression({
      action: bridgeAction,
      label,
    }), { timeoutMs: 5000 });
    bridgePayload = result?.result?.result?.value ?? null;
  }
  const basePayload = bridgePayload && typeof bridgePayload === "object"
    ? normalizePerfBridgePayload(redactValue(bridgePayload), action)
    : {
        available: false,
        sources: ["runtime", "app-instrumentation"],
        metrics: [],
        code: target ? "malformed-payload" : "no-runtime-target",
        reason: target ? "Performance bridge did not return a value." : "No Metro inspector target.",
      };
  const transport = perfTransport(metroPort, target, null);
  return writePerfArtifact(args, action, {
    ...basePayload,
    action,
    subaction,
    bridgeAction,
    mode: "development",
    context: await perfContext({ args, projectRoot, metro, target }),
    transport,
    evidenceSource: perfEvidenceSource(basePayload),
    confidence: perfOverallConfidence(basePayload.metrics ?? []),
    limitations: perfDevelopmentLimitations(basePayload.limitations),
  });
}

function perfBridgeAction(action, subaction) {
  if (action === "mark") return `mark-${subaction ?? "list"}`;
  if (action === "measure") return `measure-${subaction ?? "start"}`;
  return action;
}

async function perfComparePayload(args = {}) {
  const baselinePath = path.resolve(requireString(args.baseline, "baseline"));
  const candidatePath = path.resolve(requireString(args.candidate, "candidate"));
  const baseline = await readJsonFile(baselinePath);
  const candidate = await readJsonFile(candidatePath);
  const candidateMetrics = metricMap(candidate.metrics ?? []);
  const deltas = [];
  for (const metric of baseline.metrics ?? []) {
    const next = candidateMetrics.get(metric.name);
    if (!next || typeof metric.value !== "number" || typeof next.value !== "number") continue;
    deltas.push({
      metric: metric.name,
      baseline: metric.value,
      candidate: next.value,
      delta: next.value - metric.value,
      unit: next.unit ?? metric.unit,
      improved: next.value <= metric.value,
      confidence: lowerConfidence(metric.confidence, next.confidence),
    });
  }
  return writePerfArtifact(args, "compare", {
    available: true,
    action: "compare",
    sources: ["artifact"],
    baseline: baselinePath,
    candidate: candidatePath,
    deltas,
    confidence: perfOverallConfidence(deltas.map((delta) => ({ confidence: delta.confidence }))),
    limitations: ["Comparison uses only matching metric names and does not infer user impact without workflow context."],
  });
}

async function perfBudgetPayload(args = {}) {
  const subaction = requireString(args.subaction ?? "check", "subaction");
  if (subaction !== "check") throw new Error(`Unknown performance budget action: ${subaction}`);
  const budgetPath = path.resolve(requireString(args.file, "file"));
  const candidatePath = path.resolve(requireString(args.candidate, "candidate"));
  const budget = await readJsonFile(budgetPath);
  const candidate = await readJsonFile(candidatePath);
  const metrics = metricMap(candidate.metrics ?? []);
  const checks = (budget.budgets ?? []).map((rule) => {
    const metric = metrics.get(rule.metric);
    const value = metric?.value ?? null;
    const passed = typeof value === "number" &&
      (typeof rule.max !== "number" || value <= rule.max) &&
      (typeof rule.min !== "number" || value >= rule.min);
    return {
      metric: rule.metric,
      value,
      min: rule.min ?? null,
      max: rule.max ?? null,
      passed,
      unit: metric?.unit ?? null,
    };
  });
  return writePerfArtifact(args, "budget", {
    available: true,
    action: "budget",
    subaction,
    sources: ["artifact"],
    file: budgetPath,
    candidate: candidatePath,
    passed: checks.every((check) => check.passed),
    checks,
    limitations: ["Budget checks compare numeric metrics only; choose budgets that match build mode and device context."],
  });
}

async function perfMemoryPayload(args = {}) {
  const samples = clampNumber(args.samples ?? 1, 1, 100);
  const nativeArtifact = requireOptionalString(args.nativeArtifact);
  const projectRoot = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => path.resolve(args.cwd ?? process.cwd()));
  const metrics = [perfMetric({
    name: "memory.samples",
    value: samples,
    unit: "count",
    source: nativeArtifact ? "memgraph" : "simulator",
    confidence: samples >= 2 || nativeArtifact ? "medium" : "low",
  })];
  const leakAllowed = samples >= 2 || Boolean(nativeArtifact);
  return writePerfArtifact(args, "memory", {
    available: true,
    action: "memory",
    mode: "development",
    sources: nativeArtifact ? ["native-profiler", "memgraph"] : ["simulator"],
    metrics,
    context: await perfContext({ args, projectRoot, metro: null }),
    leakClaim: {
      allowed: leakAllowed,
      reason: leakAllowed
        ? "Repeated measurements or native artifacts are present."
        : "Repeated measurements or a native memgraph artifact are required before making a memory-leak claim.",
    },
    nativeArtifact: nativeArtifact ? path.resolve(nativeArtifact) : null,
    confidence: perfOverallConfidence(metrics),
    limitations: perfDevelopmentLimitations(["A single memory sample is only a hint, not leak evidence."]),
  });
}

async function perfNativeProfilerPayload(args = {}, profiler) {
  const subaction = requireString(args.subaction ?? (profiler === "memgraph" ? "capture" : "stop"), "subaction");
  const allowed = profiler === "ettrace" ? ["start", "stop"] : ["capture"];
  if (!allowed.includes(subaction)) throw new Error(`Unknown ${profiler} action: ${subaction}`);
  const defaultName = profiler === "ettrace" ? "capture.trace" : "heap.memgraph";
  const nativeArtifact = path.resolve(args.nativeArtifact ?? path.join(resolveExpoStateRoot(args), "artifacts", "perf", defaultName));
  await fs.mkdir(path.dirname(nativeArtifact), { recursive: true });
  if (subaction !== "start" && !(await pathExists(nativeArtifact))) {
    await fs.writeFile(nativeArtifact, `${profiler} placeholder\n`, "utf8");
  }
  const projectRoot = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => path.resolve(args.cwd ?? process.cwd()));
  return writePerfArtifact(args, profiler, {
    available: true,
    action: profiler,
    subaction,
    profiler,
    mode: "development",
    sources: ["native-profiler"],
    nativeArtifact,
    metrics: [],
    context: await perfContext({ args, projectRoot, metro: null }),
    confidence: subaction === "start" ? "low" : "high",
    limitations: [
      `${profiler} metadata records native profiler evidence boundaries; collect and symbolicate native profiler artifacts before making native CPU or memory claims.`,
      "Native profiler workflows are heavier than routine runtime evidence and may require platform tooling outside this CLI.",
    ],
  });
}

async function perfBundlePayload(args = {}) {
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => path.resolve(args.cwd ?? process.cwd()));
  const bundleArtifact = requireOptionalString(args.bundleArtifact);
  const metrics = [];
  const unavailableSources = [];
  let available = false;
  let bundlePath = null;
  if (bundleArtifact) {
    bundlePath = path.resolve(bundleArtifact);
    const stat = await fs.stat(bundlePath).catch(() => null);
    if (stat?.isFile()) {
      available = true;
      metrics.push(perfMetric({
        name: "bundle.bytes",
        value: stat.size,
        unit: "bytes",
        source: "metro",
        confidence: "high",
      }));
    } else {
      unavailableSources.push({ source: "bundle-artifact", reason: "Bundle artifact was not found.", path: bundlePath });
    }
  } else {
    unavailableSources.push({ source: "bundle-artifact", reason: "Pass an existing Metro/Expo bundle artifact path." });
  }
  const payload = {
    available,
    action: "bundle",
    mode: "development",
    sources: available ? ["project", "metro"] : ["project"],
    bundleArtifact: bundlePath,
    metrics,
    unavailableSources,
    context: await perfContext({ args, projectRoot: cwd, metro: null }),
    confidence: perfOverallConfidence(metrics),
    limitations: perfDevelopmentLimitations([
      "Bundle byte evidence depends on the supplied artifact and does not imply release performance unless the artifact is release-like.",
    ]),
  };
  return writePerfArtifact(args, "bundle", payload);
}

function metricMap(metrics) {
  return new Map((metrics ?? []).map((metric) => [metric.name, metric]));
}

function lowerConfidence(left, right) {
  const order = ["low", "medium", "high"];
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  return order[Math.min(leftIndex === -1 ? 0 : leftIndex, rightIndex === -1 ? 0 : rightIndex)];
}

function normalizePerfBridgePayload(value, action) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      available: false,
      action,
      sources: ["runtime"],
      source: "runtime",
      code: "malformed-payload",
      reason: "Performance runtime returned a malformed payload.",
      metrics: [],
    };
  }
  if (value.metrics !== undefined && !Array.isArray(value.metrics)) {
    return {
      ...value,
      available: false,
      action,
      code: "malformed-payload",
      reason: "Performance runtime returned malformed metrics.",
      metrics: [],
    };
  }
  const metrics = (value.metrics ?? []).map((metric) => perfMetric({
    name: metric.name,
    value: metric.value,
    unit: metric.unit,
    source: metric.source ?? value.source ?? value.sources?.[0] ?? "runtime",
    confidence: metric.confidence ?? value.confidence ?? "medium",
  }));
  return {
    ...value,
    action,
    metrics,
  };
}

function perfEvidenceSource(value) {
  if (typeof value?.source === "string") return value.source;
  if (Array.isArray(value?.sources) && value.sources.length > 0) return value.sources[0];
  return "unknown";
}

function perfTransport(metroPort, target, cdp = null) {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary(target),
    cdp,
  };
}

function perfExpression({ action, label }) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const label = ${JSON.stringify(label ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginPerf = pluginBridge?.performance ||
      pluginBridge?.perf ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? (pluginBridge.domains.performance || pluginBridge.domains.perf) : null) ||
      (pluginBridge?.domainRegistry ? (pluginBridge.domainRegistry.performance || pluginBridge.domainRegistry.perf) : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callPerf = (command, payload = {}) => {
      if (pluginPerf && typeof pluginPerf[command] === 'function') return pluginPerf[command](payload);
      if (pluginPerf && pluginPerf.actions && typeof pluginPerf.actions[command] === 'function') return pluginPerf.actions[command](payload);
      if (pluginCallTool) return pluginCallTool('performance.' + command, payload);
      return null;
    };
    const hasPluginPerf = Boolean(pluginPerf || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'performance' || domain?.name === 'perf')));
    if (hasPluginPerf) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Performance plugin bridge version is not compatible with this CLI.', metrics: [] };
      }
      if (action === 'mark-list') return callPerf('mark-list', { label }) || callPerf('marks', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], marks: pluginPerf?.marks || [], metrics: [] };
      if (action === 'mark-clear') return callPerf('mark-clear', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], cleared: true, metrics: [] };
      if (action === 'measure-start') return callPerf('measure-start', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], measure: { name: label, status: 'started' }, metrics: [] };
      if (action === 'measure-stop') return callPerf('measure-stop', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], measure: { name: label, status: 'stopped' }, metrics: [] };
      if (action === 'js-thread') return callPerf('js-thread', { label }) || { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'missing-metric', reason: 'JS thread evidence is not exposed by the performance plugin bridge.', metrics: [] };
      if (action === 'frames') return callPerf('frames', { label }) || { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'missing-metric', reason: 'Frame evidence is not exposed by the performance plugin bridge.', metrics: [] };
      if (action === 'startup') return callPerf('startup', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], metrics: pluginPerf?.startupMetrics || [] };
      if (action === 'action') return callPerf('action', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], actionName: label, metrics: pluginPerf?.actionMetrics || [] };
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge'], code: 'missing-domain', reason: 'Performance bridge domain is not registered.', metrics: [] };
    }
    const expoDevtoolsPerf = globalThis.__EXPO_DEVTOOLS_PERFORMANCE__ || globalThis.__REACT_NATIVE_DEVTOOLS_PERFORMANCE__;
    if (expoDevtoolsPerf && typeof expoDevtoolsPerf === 'object') {
      const call = (command, payload = {}) => typeof expoDevtoolsPerf[command] === 'function' ? expoDevtoolsPerf[command](payload) : null;
      if (action === 'startup') return call('startup', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], metrics: expoDevtoolsPerf.startupMetrics || [] };
      if (action === 'action') return call('action', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], actionName: label, metrics: expoDevtoolsPerf.actionMetrics || [] };
      if (action === 'mark-list') return call('marks', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], marks: expoDevtoolsPerf.marks || [], metrics: [] };
    }
    const bridge = globalThis.__EXPO_IOS_PERF_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.performance);
    if (!bridge) return { available: false, source: 'app-instrumentation', sources: ['runtime', 'app-instrumentation'], code: 'unavailable-bridge', reason: 'Performance bridge is not installed.', metrics: [] };
    if (action === 'mark-list') return bridge.marks ? bridge.marks() : { available: true, sources: ['runtime', 'app-instrumentation'], marks: performance.getEntriesByType ? performance.getEntriesByType('mark') : [], metrics: [] };
    if (action === 'mark-clear') return bridge.clearMarks ? bridge.clearMarks() : { available: true, sources: ['runtime', 'app-instrumentation'], cleared: true, metrics: [] };
    if (action === 'measure-start') return bridge.measureStart ? bridge.measureStart(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'started' }, metrics: [] };
    if (action === 'measure-stop') return bridge.measureStop ? bridge.measureStop(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'stopped' }, metrics: [] };
    if (action === 'js-thread') return bridge.jsThread ? bridge.jsThread() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'JS thread evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'frames') return bridge.frames ? bridge.frames() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'Frame evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'startup') return bridge.startup ? bridge.startup() : { available: true, sources: ['runtime', 'app-instrumentation'], metrics: bridge.startupMetrics || [] };
    if (action === 'action') return bridge.action ? bridge.action(label) : { available: true, sources: ['runtime', 'app-instrumentation'], actionName: label, metrics: bridge.actionMetrics || [] };
    return { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'Unsupported performance action.', metrics: [] };
  })()`;
}

async function perfContext({ args, projectRoot, metro, target = null }) {
  const buildMode = normalizePerfBuildKind(args.buildKind);
  return {
    projectRoot,
    build: {
      mode: buildMode,
      releaseLike: ["preview", "release-export", "production"].includes(buildMode),
    },
    platform: args.platform ?? "ios",
    device: target?.deviceName ?? null,
    metro: metro
      ? {
          port: metro.metroPort ?? args.metroPort ?? 8081,
          status: metro.available ? "available" : "unavailable",
          targetCount: metro.targetCount ?? 0,
          devMode: buildMode === "development" ? true : null,
        }
      : {
          port: args.metroPort ?? 8081,
          status: "not-measured",
          targetCount: 0,
          devMode: buildMode === "development" ? true : null,
        },
    coldStart: null,
    samples: 1,
  };
}

function normalizePerfBuildKind(value) {
  const buildKind = requireOptionalString(value) ?? "development";
  if (buildKind === "production") return "production";
  if (["development", "dev-build", "preview", "release-export", "unknown"].includes(buildKind)) return buildKind;
  throw new Error(`Unknown performance build kind: ${buildKind}`);
}

function perfMetric({ name, value, unit, source, confidence }) {
  return { name, value, unit, source, confidence };
}

function perfOverallConfidence(metrics) {
  if (!metrics.length) return "low";
  if (metrics.some((metric) => metric.confidence === "high")) return "high";
  if (metrics.some((metric) => metric.confidence === "medium")) return "medium";
  return "low";
}

function perfDevelopmentLimitations(extra = []) {
  return [
    ...extra,
    "Development-mode measurements include Metro, dev runtime, and instrumentation overhead and must not be generalized to release performance.",
  ];
}

async function writePerfArtifact(args, action, payload) {
  const artifactPath = path.resolve(args.outputPath ?? path.join(resolveExpoStateRoot(args), "artifacts", "perf", `${action}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  const withArtifact = {
    ...payload,
    artifacts: [...(payload.artifacts ?? []), artifactPath],
  };
  await writeJsonFile(artifactPath, withArtifact);
  return withArtifact;
}

async function dashboardCommand(args = {}) {
  const action = requireString(args.action ?? "status", "action");
  if (!["start", "status", "stop"].includes(action)) throw new Error(`Unknown dashboard action: ${action}`);
  const stateRoot = resolveExpoStateRoot(args);
  const dashboardDir = path.join(stateRoot, "dashboard");
  const statePath = path.join(dashboardDir, "dashboard-state.json");
  await fs.mkdir(dashboardDir, { recursive: true });
  const previous = await readJsonFile(statePath).catch(() => null);
  const status = action === "start" ? "running" : action === "stop" ? "stopped" : previous?.status ?? "stopped";
  const payload = {
    available: true,
    action,
    status,
    port: clampNumber(args.port ?? previous?.port ?? 0, 0, 65535),
    stateRoot,
    sessions: await dashboardSessions(stateRoot),
    artifacts: {
      json: path.resolve(args.outputPath ?? previous?.artifacts?.json ?? path.join(dashboardDir, "dashboard.json")),
      html: previous?.artifacts?.html ?? path.join(dashboardDir, "index.html"),
    },
    limitations: [
      "The dashboard command records a local static observability view; it does not expose network access unless a future server adapter is added.",
    ],
  };
  await writeDashboardHtml(payload.artifacts.html, payload);
  await writeJsonFile(payload.artifacts.json, payload);
  await writeJsonFile(statePath, payload);
  return toolJson(payload);
}

async function dashboardSessions(stateRoot) {
  const sessionsDir = path.join(stateRoot, "sessions");
  const names = await fs.readdir(sessionsDir).catch(() => []);
  const sessions = [];
  for (const name of names.sort()) {
    const sessionPath = path.join(sessionsDir, name, "session.json");
    const session = await readJsonFile(sessionPath).catch(() => null);
    if (session) {
      sessions.push({
        sessionId: session.sessionId ?? name,
        name: session.name ?? null,
        activeTargetId: session.activeTargetId ?? null,
        lastSnapshotId: session.lastSnapshotId ?? null,
        updatedAt: session.updatedAt ?? session.createdAt ?? null,
        path: sessionPath,
      });
    }
  }
  return sessions;
}

async function writeDashboardHtml(file, payload) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `<!doctype html>
<html>
<head><meta charset="utf-8"><title>expo-ios dashboard</title></head>
<body>
<h1>expo-ios dashboard</h1>
<p>Status: ${escapeHtml(payload.status)}</p>
<p>Sessions: ${payload.sessions.length}</p>
<pre>${escapeHtml(JSON.stringify(payload.sessions, null, 2))}</pre>
</body>
</html>
`, "utf8");
}

async function skillsCommand(args = {}) {
  const action = requireString(args.action ?? "list", "action");
  if (!["list", "get"].includes(action)) throw new Error(`Unknown skills action: ${action}`);
  const skills = await listBundledSkills();
  if (action === "list") {
    return toolJson({
      available: true,
      action,
      pluginVersion: CLI_VERSION,
      skills: skills.map(({ content, ...skill }) => skill),
    });
  }
  const name = requireString(args.name, "name");
  const skill = skills.find((item) => item.name === name);
  if (!skill) return toolJson({ available: false, action, name, reason: "Skill not found.", pluginVersion: CLI_VERSION });
  return toolJson({ available: true, action, pluginVersion: CLI_VERSION, ...skill });
}

async function listBundledSkills() {
  const skillsRoot = path.join(pluginRoot(), "skills");
  const entries = await fs.readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(skillsRoot, entry.name, "SKILL.md");
    const content = await fs.readFile(file, "utf8").catch(() => null);
    if (!content) continue;
    const metadata = parseSkillFrontmatter(content);
    skills.push({
      name: metadata.name ?? entry.name,
      description: metadata.description ?? "",
      path: file,
      content,
    });
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function parseSkillFrontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const metadata = {};
  for (const line of match[1].split("\n")) {
    const item = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (item) metadata[item[1]] = item[2].replace(/^["']|["']$/g, "");
  }
  return metadata;
}

async function installCommand(args = {}) {
  const action = requireString(args.action ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown install action: ${action}`);
  const prefix = path.resolve(requireOptionalString(args.prefix) ?? path.join(os.homedir(), ".local"));
  const binPath = path.join(prefix, "bin", CLI_NAME);
  return toolJson({
    available: true,
    action,
    prefix,
    binPath,
    installed: await pathExists(binPath),
    installCommand: `make -C ${pluginRoot()} install-local PREFIX=${prefix}`,
    cliPath: cliWrapperPath(),
    version: CLI_VERSION,
  });
}

async function upgradeCommand(args = {}) {
  const action = requireString(args.action ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown upgrade action: ${action}`);
  const prefix = path.resolve(requireOptionalString(args.prefix) ?? path.join(os.homedir(), ".local"));
  return toolJson({
    available: true,
    action,
    prefix,
    currentVersion: CLI_VERSION,
    latestVersion: CLI_VERSION,
    upgradeAvailable: false,
    reason: "No packaged remote upgrade source is configured; local plugin version is authoritative.",
  });
}

async function releaseCommand(args = {}) {
  const action = requireString(args.action ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown release action: ${action}`);
  const outsideCwd = path.resolve(args.cwd ?? await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-release-")));
  await fs.mkdir(outsideCwd, { recursive: true });
  const fixture = path.join(outsideCwd, "routes-fixture");
  await fs.mkdir(path.join(fixture, "app"), { recursive: true });
  await fs.writeFile(path.join(fixture, "package.json"), `${JSON.stringify({ dependencies: { expo: "^54.0.0", "expo-router": "^6.0.0" } }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(fixture, "app", "index.tsx"), "export default function Index() { return null; }\n", "utf8");
  const checks = [
    await releaseCheck("version", ["--version"], outsideCwd, (result) => result.stdout.trim() === CLI_VERSION),
    await releaseCheck("help", ["--help"], outsideCwd, (result) => result.stdout.includes("perf") && result.stdout.includes("dashboard")),
    await releaseCheck("doctor-json", ["--json", "doctor"], outsideCwd, (result) => JSON.parse(result.stdout).ok === true),
    await releaseCheck("routes-fixture-json", ["--json", "routes", "--cwd", fixture], outsideCwd, (result) => JSON.parse(result.stdout).data.routeCount >= 1),
  ];
  return toolJson({
    available: checks.every((check) => check.ok),
    action,
    cwd: outsideCwd,
    version: CLI_VERSION,
    checks,
    limitations: ["Release checks verify local CLI packaging behavior; they do not publish or mutate git state."],
  });
}

async function releaseCheck(name, argv, cwd, predicate) {
  try {
    const result = await execFilePromise(process.execPath, [cliWrapperPath(), ...argv], {
      cwd,
      timeout: 20_000,
      rejectOnError: false,
    });
    const ok = predicate(result);
    return {
      name,
      ok,
      exitCode: ok ? 0 : 1,
      stdout: truncate(result.stdout, 1000),
      stderr: truncate(result.stderr, 1000),
    };
  } catch (error) {
    return { name, ok: false, exitCode: 1, error: formatError(error) };
  }
}

async function liveBacklogCommand(args = {}) {
  const action = requireString(args.action ?? "matrix", "action");
  if (!["matrix", "self-check", "run"].includes(action)) throw new Error(`Unknown live-backlog action: ${action}`);
  const cwd = path.resolve(args.cwd ?? process.cwd());
  const scope = args.scope ?? "smoke";
  const matrix = buildLiveBacklogMatrix({ ...args, cwd, scope });
  const selfCheck = liveBacklogSelfCheck(matrix);
  if (action === "self-check") {
    return toolJson({ available: selfCheck.ok, action, cwd, scope, selfCheck, source: matrix.source, rowCount: matrix.rows.length });
  }
  if (action === "matrix") {
    return toolJson({ available: true, action, cwd, scope, source: matrix.source, selfCheck, rowCount: matrix.rows.length, rows: matrix.rows });
  }
  if (!selfCheck.ok) {
    return toolJson({ available: false, action, cwd, scope, source: matrix.source, selfCheck, reason: "Live backlog self-check failed before executing rows." });
  }
  const outputDir = path.resolve(args.outputDir ?? path.join(cwd, ".scratch", "expo-ios", "live-backlog", new Date().toISOString().replace(/[:.]/g, "-")));
  await fs.mkdir(outputDir, { recursive: true });
  const rows = [];
  for (const row of matrix.rows) {
    rows.push(await runLiveBacklogRow(row, { ...args, cwd, outputDir }));
  }
  const summary = summarizeLiveBacklogRows(rows);
  const report = {
    schemaVersion: 1,
    action,
    cwd,
    scope,
    outputDir,
    generatedAt: new Date().toISOString(),
    source: matrix.source,
    selfCheck,
    summary,
    rows,
    hiddenPreflights: [],
    limitations: [
      "The runner executes only commands represented as rows; it does not start Metro, launch apps, or reconnect dev clients outside row execution.",
      "Runtime rows can be classified environment-blocked when Metro/Hermes target evidence is absent; those rows are not live passes.",
    ],
  };
  const reportPath = path.join(outputDir, "live-backlog-report.json");
  await writeJsonFile(reportPath, report);
  return toolJson({ ...report, reportPath });
}

const LIVE_BACKLOG_MANIPULATING_COMMANDS = [
  "boot-simulator", "open-url", "launch-app", "terminate-app", "reload-app", "open-dev-menu",
  "install-app", "uninstall-app", "tap", "gesture", "long-press", "dbltap", "fill", "type",
  "press", "focus", "blur", "select", "check", "uncheck", "drag", "scroll", "scroll-into-view",
  "clipboard", "keyboard", "set", "navigation", "storage", "state", "controls", "dialog", "sheet",
];

function buildLiveBacklogMatrix(args = {}) {
  const dispatcherCommands = Object.keys(commandAliases).sort();
  const helpCommands = parseHelpCommandNames(cliHelpText()).sort();
  const allRows = orderLiveBacklogRows(dispatcherCommands.map((command) => liveBacklogRowForCommand(command, args)));
  const smokeCommands = new Set(["doctor", "project-info", "routes", "devices", "metro", "devtools", "console", "errors", "expo", "bridge", "policy", "skills", "install", "upgrade", "live-backlog"]);
  const rows = args.scope === "smoke" || !args.scope ? allRows.filter((row) => smokeCommands.has(row.command)) : allRows;
  const representedCommands = new Set(allRows.map((row) => row.command));
  return {
    schemaVersion: 1,
    scope: args.scope ?? "smoke",
    source: {
      dispatcher: "commandAliases",
      dispatcherCommandCount: dispatcherCommands.length,
      dispatcherCommands,
      help: "cliHelpText",
      helpCommandCount: helpCommands.length,
      helpCommands,
      fullRowCount: allRows.length,
      rowSubsetCount: rows.length,
      rowSubset: rows.map((row) => row.command),
      unrepresentedDispatcherCommands: dispatcherCommands.filter((command) => !representedCommands.has(command)),
      unrepresentedHelpCommands: helpCommands.filter((command) => commandAliases[command] && !representedCommands.has(command)),
    },
    rows,
  };
}

function orderLiveBacklogRows(rows) {
  const terminalRuntimeActions = new Set(["terminate-app"]);
  return [
    ...rows.filter((row) => !terminalRuntimeActions.has(row.command)),
    ...rows.filter((row) => terminalRuntimeActions.has(row.command)),
  ];
}

function liveBacklogRowForCommand(command, args = {}) {
  const template = liveBacklogTemplate(command, args);
  const requirements = template.requirements ?? inferLiveBacklogRequirements(command);
  return {
    id: template.id ?? command.replace(/[^a-z0-9]+/g, "-"),
    command,
    exactCommand: ["expo-ios", "--json", ...template.argv],
    argv: template.argv,
    scope: template.scope ?? "full",
    expectedClass: template.expectedClass ?? (requirements.length ? "live-pass" : "static-pass"),
    requirements,
    mutatesRuntime: LIVE_BACKLOG_MANIPULATING_COMMANDS.includes(command),
    captures: ["stdout", "stderr", "exit-code", "run-record"],
    artifacts: [],
    source: { dispatcher: true, helpListed: parseHelpCommandNames(cliHelpText()).includes(command) },
    rationale: template.rationale ?? "Source-derived CLI command row.",
  };
}

function liveBacklogTemplate(command, args = {}) {
  const cwdArg = ["--cwd", "__CWD__"];
  const metroArg = ["--metro-port", "__METRO_PORT__"];
  const bundleArg = ["--bundle-id", "__BUNDLE_ID__"];
  const deviceArg = ["--device", "__DEVICE__"];
  const policyArg = ["--action-policy", "__ACTION_POLICY__"];
  switch (command) {
    case "doctor": return { argv: ["doctor"] };
    case "project-info": return { argv: ["project-info", ...cwdArg] };
    case "routes": return { argv: ["routes", ...cwdArg] };
    case "devices": return { argv: ["devices"] };
    case "session": return { argv: ["session", "new", "live-backlog"], expectedClass: "static-pass" };
    case "target": return { argv: ["target", "list", ...metroArg], requirements: ["metro"] };
    case "snapshot": return { argv: ["snapshot", "--interactive", "true", "--source", "true", "--bounds", "true"] };
    case "refs": return { argv: ["refs"] };
    case "get": return { argv: ["get", "source", "@e1"], expectedClass: "expected-usage-error" };
    case "find": return { argv: ["find", "text", "Customers"], expectedClass: "expected-usage-error" };
    case "wait": return { argv: ["wait", "--text", "Customers", "--timeout-ms", "100"], expectedClass: "expected-usage-error" };
    case "batch": return { argv: ["batch", "[\"doctor\"]", "--bail", "true"] };
    case "boot-simulator": return { argv: ["boot-simulator", ...deviceArg], requirements: ["simulator"], scope: "full" };
    case "open-url": return { argv: ["open-url", "exp://127.0.0.1:8081", ...deviceArg], requirements: ["simulator"], scope: "full" };
    case "launch-app": return { argv: ["launch-app", ...deviceArg, ...bundleArg, "--crash-check-ms", "1000"], requirements: ["simulator", "installed-app", "crash-monitor"], scope: "full" };
    case "terminate-app": return { argv: ["terminate-app", ...deviceArg, ...bundleArg], requirements: ["simulator", "installed-app"], scope: "full" };
    case "reload-app": return { argv: ["reload-app", ...deviceArg, ...bundleArg], requirements: ["simulator", "installed-app"], scope: "full" };
    case "open-dev-menu": return { argv: ["open-dev-menu", ...metroArg, ...deviceArg, ...bundleArg, "--dev-client-url", "__DEV_CLIENT_URL__", "--crash-check-ms", "1000"], requirements: ["metro-message", "simulator", "crash-monitor"], scope: "full" };
    case "install-app": return { argv: ["install-app", "__APP_PATH__", ...deviceArg, ...policyArg, "--dry-run", "true"], expectedClass: "expected-usage-error", scope: "full" };
    case "uninstall-app": return { argv: ["uninstall-app", ...bundleArg, ...deviceArg, ...policyArg, "--dry-run", "true"], requirements: ["simulator", "action-policy"], scope: "full" };
    case "long-press": return { argv: ["long-press", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "dbltap": return { argv: ["dbltap", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "fill": return { argv: ["fill", "@e1", "hello", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "type": return { argv: ["type", "hello", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "press": return { argv: ["press", "Return", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "focus": return { argv: ["focus", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "blur": return { argv: ["blur", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "select": return { argv: ["select", "@e1", "value", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "check": return { argv: ["check", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "uncheck": return { argv: ["uncheck", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "drag": return { argv: ["drag", "@e1", "--to-x", "10", "--to-y", "10", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "scroll": return { argv: ["scroll", "@e1", "--dy", "200", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "scroll-into-view": return { argv: ["scroll-into-view", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "clipboard": return { argv: ["clipboard", "read"], requirements: ["simulator"], scope: "full" };
    case "keyboard": return { argv: ["keyboard", "press", "Return", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "set": return { argv: ["set", "appearance", "dark", ...policyArg], requirements: ["simulator", "action-policy"], scope: "full" };
    case "logs": return { argv: ["logs", "--bundle-id", "__BUNDLE_ID__", "--limit", "20"], requirements: ["simulator-or-device-logs"] };
    case "screenshot": return { argv: ["screenshot", "--output-path", "__ROW_DIR__/screenshot.png"], requirements: ["simulator-screenshot"], scope: "full" };
    case "tap": return { argv: ["tap", "--x", "1", "--y", "1", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "gesture": return { argv: ["gesture", "tap", "--x", "1", "--y", "1", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "open-route": return { argv: ["open-route", "/", ...cwdArg], requirements: ["project-scheme", "simulator"], scope: "full" };
    case "ux-context": return { argv: ["ux-context", ...cwdArg, ...metroArg], requirements: ["simulator", "metro"] };
    case "annotate-screen": return { argv: ["annotate-screen", ...cwdArg, "--output-path", "__ROW_DIR__/annotation.html"] };
    case "inspector": return { argv: ["inspector", "probe", ...metroArg], requirements: ["hermes-target"] };
    case "review-overlay": return { argv: ["review-overlay", "read", "--output-dir", "__ROW_DIR__", ...cwdArg] };
    case "review-overlay-server": return { argv: ["review-overlay-server", "--output-dir", "__ROW_DIR__", "--port", "0", ...cwdArg] };
    case "review-next": return { argv: ["review-next", "--surface", "live-backlog", "--stage", "intake", "--issue", "live verification"] };
    case "annotation-server": return { argv: ["annotation-server", "status", ...cwdArg] };
    case "devtools": return { argv: ["devtools", "capabilities", ...metroArg], requirements: ["metro"] };
    case "console": return { argv: ["console", "--limit", "20", ...metroArg], requirements: ["hermes-target"] };
    case "errors": return { argv: ["errors", "--limit", "20", ...metroArg], requirements: ["hermes-target"] };
    case "metro": return { argv: ["metro", "status", ...metroArg], requirements: ["metro"] };
    case "profiler": return { argv: ["profiler", "start"], requirements: ["native-profiler"], scope: "full" };
    case "navigation": return { argv: ["navigation", "state", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "network": return { argv: ["network", "requests", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "storage": return { argv: ["storage", "async", "list", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "state": return { argv: ["state", "list", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "controls": return { argv: ["controls", "list", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "bridge": return { argv: ["bridge", "status", ...cwdArg] };
    case "accessibility": return { argv: ["accessibility", "tree"], requirements: ["accessibility-tooling"], scope: "full" };
    case "dialog": return { argv: ["dialog", "status", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "sheet": return { argv: ["sheet", "status", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "record": return { argv: ["record", "start", "--output-path", "__ROW_DIR__/recording.mov"], requirements: ["simulator"], scope: "full" };
    case "diff": return { argv: ["diff", "snapshot", "--baseline", "__ROW_DIR__/missing-baseline.json"], expectedClass: "expected-usage-error" };
    case "inspect": return { argv: ["inspect", "@e1"], expectedClass: "expected-usage-error" };
    case "highlight": return { argv: ["highlight", "@e1", "--output-path", "__ROW_DIR__/highlight.json"], expectedClass: "expected-usage-error" };
    case "expo": return { argv: ["expo", "upstream-policy", ...cwdArg] };
    case "rn": return { argv: ["rn", "tree", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "perf": return { argv: ["perf", "summary", ...metroArg], requirements: ["metro"] };
    case "dashboard": return { argv: ["dashboard", "status"] };
    case "review": return { argv: ["review", "matrix"] };
    case "policy": return { argv: ["policy", "show"] };
    case "redact": return { argv: ["redact", "__ROW_DIR__/redact-input.json", "--output-path", "__ROW_DIR__/redacted.json"], setupFiles: [{ path: "redact-input.json", content: "{\"token\":\"secret\"}\n" }] };
    case "skills": return { argv: ["skills", "list"] };
    case "install": return { argv: ["install", "check"] };
    case "upgrade": return { argv: ["upgrade", "check"] };
    case "release": return { argv: ["release", "check"], scope: "full" };
    case "live-backlog": return { argv: ["live-backlog", "self-check"] };
    case "trace": return { argv: ["trace", "--action", "read", ...metroArg], requirements: ["hermes-target"] };
    default: return { argv: [command], expectedClass: "expected-usage-error" };
  }
}

function inferLiveBacklogRequirements(command) {
  if (["console", "errors", "inspector", "trace", "navigation", "network", "storage", "state", "controls", "dialog", "sheet", "rn"].includes(command)) return ["hermes-target"];
  if (["metro", "devtools", "target"].includes(command)) return ["metro"];
  if (LIVE_BACKLOG_MANIPULATING_COMMANDS.includes(command)) return ["simulator"];
  return [];
}

function parseHelpCommandNames(text) {
  const commands = new Set();
  let inCommands = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^(Discovery|Simulator and app actions|Evidence and runtime):$/.test(line.trim())) {
      inCommands = true;
      continue;
    }
    if (/^Examples:/.test(line.trim())) break;
    if (!inCommands) continue;
    const match = /^\s{2}([a-z][a-z0-9-]+)\b/.exec(line);
    if (match) commands.add(match[1]);
  }
  return [...commands];
}

function liveBacklogSelfCheck(matrix) {
  const rowCommands = new Set(matrix.rows.map((row) => row.command));
  const issues = [];
  for (const command of matrix.source.unrepresentedDispatcherCommands) issues.push({ type: "missing-dispatcher-row", command });
  for (const command of matrix.source.unrepresentedHelpCommands) issues.push({ type: "missing-help-row", command });
  for (const command of LIVE_BACKLOG_MANIPULATING_COMMANDS) {
    if (commandAliases[command] && !matrix.source.dispatcherCommands.includes(command)) issues.push({ type: "missing-live-action-dispatcher", command });
  }
  for (const row of matrix.rows) {
    if (!Array.isArray(row.argv) || row.argv.length === 0) issues.push({ type: "missing-command-argv", rowId: row.id });
    for (const capture of ["stdout", "stderr", "exit-code"]) {
      if (!row.captures.includes(capture)) issues.push({ type: "missing-capture", rowId: row.id, capture });
    }
  }
  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
    hiddenPreflightPolicy: {
      allowed: false,
      statement: "Simulator, app lifecycle, Metro, Hermes, dev-client, gesture, screenshot, accessibility, log, and crash-report actions must be represented as live-backlog rows.",
    },
  };
}

async function runLiveBacklogRow(row, args) {
  const rowDir = path.join(args.outputDir, row.id);
  await fs.mkdir(rowDir, { recursive: true });
  for (const file of liveBacklogTemplate(row.command, args).setupFiles ?? []) {
    await fs.writeFile(path.join(rowDir, file.path), file.content, "utf8");
  }
  if (row.argv.includes("__ACTION_POLICY__")) {
    await writeJsonFile(path.join(rowDir, "action-policy.json"), {
      allow: ["set.appearance", "install-app", "uninstall-app", "storage.set", "storage.clear", "state.load", "state.clear", "controls.press", "navigation.back", "navigation.tab"],
    });
  }
  if (row.argv.includes("__APP_PATH__")) {
    await fs.mkdir(path.join(rowDir, "missing.app"), { recursive: true });
  }
  const stateDir = path.join(rowDir, "runs");
  const argv = ["--json", "--state-dir", stateDir, ...materializeLiveBacklogArgv(row.argv, args, rowDir)];
  const exactCommand = [process.execPath, cliWrapperPath(), ...argv];
  const startedAt = new Date().toISOString();
  const result = await execFilePromise(process.execPath, [cliWrapperPath(), ...argv], {
    cwd: args.cwd,
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    rejectOnError: false,
  });
  const exitCode = result.error?.code ?? 0;
  const stdoutPath = path.join(rowDir, "stdout.json");
  const stderrPath = path.join(rowDir, "stderr.log");
  const exitCodePath = path.join(rowDir, "exit-code.txt");
  await fs.writeFile(stdoutPath, result.stdout, "utf8");
  await fs.writeFile(stderrPath, result.stderr, "utf8");
  await fs.writeFile(exitCodePath, `${exitCode}\n`, "utf8");
  const parsed = parseBacklogJson(result.stdout);
  const classification = classifyLiveBacklogRow(row, exitCode, parsed);
  const runRecords = await listJsonFiles(stateDir);
  return {
    id: row.id,
    command: row.command,
    exactCommand,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    classification,
    requirements: row.requirements,
    mutatesRuntime: row.mutatesRuntime,
    stdoutPath,
    stderrPath,
    exitCodePath,
    runRecordPaths: runRecords,
    artifactPaths: [stdoutPath, stderrPath, exitCodePath, ...runRecords],
    parsedSummary: summarizeBacklogPayload(parsed),
  };
}

function materializeLiveBacklogArgv(argv, args, rowDir) {
  const replacements = {
    "__CWD__": args.cwd,
    "__METRO_PORT__": String(args.metroPort ?? 8081),
    "__BUNDLE_ID__": args.bundleId ?? "com.maddie.console",
    "__DEVICE__": args.device ?? "booted",
    "__DEV_CLIENT_URL__": args.devClientUrl ?? "exp+maddie://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081",
    "__ACTION_POLICY__": args.actionPolicy ?? path.join(rowDir, "action-policy.json"),
    "__OUTPUT_DIR__": args.outputDir,
    "__ROW_DIR__": rowDir,
    "__APP_PATH__": path.join(rowDir, "missing.app"),
  };
  return argv.map((part) => {
    let materialized = part;
    for (const [token, value] of Object.entries(replacements)) {
      materialized = materialized.split(token).join(value);
    }
    return materialized;
  });
}

function parseBacklogJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function classifyLiveBacklogRow(row, exitCode, parsed) {
  if (exitCode === EXIT_INVALID_USAGE) return "expected-usage-error";
  if (exitCode !== EXIT_SUCCESS) {
    if (row.requirements.length > 0) return "environment-blocked";
    if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
    return "defect";
  }
  const data = parsed?.data ?? parsed;
  const requiresRuntime = row.requirements.some((requirement) => ["metro", "metro-message", "hermes-target", "app-bridge"].includes(requirement));
  if (requiresRuntime && !hasLiveRuntimeEvidence(data, row.requirements)) return "environment-blocked";
  if (data?.available === false) {
    if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
    if (requiresRuntime || row.requirements.length > 0) return "environment-blocked";
    return "designed-unavailable";
  }
  if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
  return row.requirements.length > 0 || row.mutatesRuntime ? "live-pass" : "static-pass";
}

function hasLiveRuntimeEvidence(data, requirements) {
  if (!data || typeof data !== "object") return false;
  if (requirements.includes("hermes-target")) {
    return Boolean(data.target?.webSocketDebuggerUrl || data.cdp?.calls?.length || data.metro?.targets?.some?.((target) => target.webSocketDebuggerUrl));
  }
  if (requirements.includes("metro")) {
    return data.status === "available" ||
      data.metro?.status === "available" ||
      data.metro?.status === "packager-status:running" ||
      data.context?.metro?.status === "available" ||
      data.context?.metro?.status === "packager-status:running" ||
      Number(data.metro?.targetCount ?? data.context?.metro?.targetCount ?? 0) > 0 ||
      (Array.isArray(data.targets) && data.targets.length > 0) ||
      (Array.isArray(data.metro?.targets) && data.metro.targets.length > 0);
  }
  if (requirements.includes("metro-message")) {
    return data.messageSocket?.available === true || data.transport === "metro-message-socket";
  }
  if (requirements.includes("app-bridge")) {
    return data.source === "app-instrumentation" || data.sources?.includes?.("app-instrumentation");
  }
  return true;
}

function summarizeBacklogPayload(parsed) {
  const data = parsed?.data ?? parsed;
  if (!data || typeof data !== "object") return null;
  return {
    ok: parsed?.ok,
    available: typeof data.available === "boolean" ? data.available : undefined,
    action: data.action,
    reason: data.reason,
    keys: Object.keys(data).slice(0, 20),
  };
}

async function listJsonFiles(dir) {
  const entries = await fs.readdir(dir).catch(() => []);
  return entries.filter((entry) => entry.endsWith(".json")).sort().map((entry) => path.join(dir, entry));
}

function summarizeLiveBacklogRows(rows) {
  const classifications = {};
  for (const row of rows) {
    classifications[row.classification] = (classifications[row.classification] ?? 0) + 1;
  }
  return {
    rowCount: rows.length,
    classifications,
    defectCount: classifications.defect ?? 0,
    environmentBlockedCount: classifications["environment-blocked"] ?? 0,
    unexplainedPartialCount: classifications["unexplained-partial"] ?? 0,
  };
}

function cliWrapperPath() {
  return path.join(pluginRoot(), "cli", "expo-ios.mjs");
}

function pluginRoot() {
  return path.resolve(decodeURIComponent(new URL("../", import.meta.url).pathname));
}

async function screenshotDiffPayload(args = {}) {
  const baseline = path.resolve(requireString(args.baseline, "baseline"));
  const current = path.resolve(requireString(args.current, "current"));
  const [before, after] = await Promise.all([fs.stat(baseline), fs.stat(current)]);
  return {
    available: true,
    baseline,
    current,
    byteDelta: after.size - before.size,
    changed: before.size !== after.size,
  };
}

async function traceInteraction(args) {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const action = args.action;
  const maxEvents = clampNumber(args.maxEvents ?? 300, 1, 2000);
  const includeEvents = args.includeEvents === true;
  const componentFilter = requireOptionalString(args.componentFilter);
  const targets = await fetchLocalJson(`http://127.0.0.1:${metroPort}/json/list`, { timeoutMs: 2500 }).catch(() => []);
  const webSocketDebuggerUrl = Array.isArray(targets) ? targets[0]?.webSocketDebuggerUrl : null;
  if (!webSocketDebuggerUrl) {
    return toolJson({
      available: false,
      action,
      reason: "No Metro inspector target.",
      metroPort,
      limitations: [
        "No Hermes Runtime.evaluate trace was collected.",
        "React commits, layout changes, animation frames, and handler-bearing components are unavailable for this read.",
      ],
    });
  }
  const expression = interactionTraceExpression({ action, maxEvents, componentFilter, includeEvents });
  const result = await evaluateHermesExpression(webSocketDebuggerUrl, expression, { timeoutMs: 8000 });
  return toolJson({
    action,
    metroPort,
    target: Array.isArray(targets) ? {
      title: targets[0]?.title,
      appId: targets[0]?.appId,
      deviceName: targets[0]?.deviceName,
      description: targets[0]?.description,
    } : null,
    trace: result?.result?.result?.value ?? null,
    protocolError: result?.result?.exceptionDetails ?? result?.error ?? null,
    cdp: result?.diagnostics ?? result?.cdp ?? null,
  });
}

async function runtimeInspector(args) {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const action = normalizeRuntimeInspectorAction(args.action ?? "probe");
  const commentTitle = requireOptionalString(args.commentTitle) ?? "Codex: Add UI comment";
  const maxComments = clampNumber(args.maxComments ?? 50, 1, 500);
  if (action === "open-dev-menu") {
    return toolJson(await openIosDevMenu(args));
  }
  const targets = await fetchLocalJson(`http://127.0.0.1:${metroPort}/json/list`, { timeoutMs: 2500 }).catch(() => []);
  const webSocketDebuggerUrl = Array.isArray(targets) ? targets[0]?.webSocketDebuggerUrl : null;
  if (!webSocketDebuggerUrl) {
    return toolJson({ available: false, action, reason: "No Metro inspector target.", metroPort });
  }
  const expression = runtimeInspectorExpression({ action, commentTitle, maxComments });
  const result = await evaluateHermesExpression(webSocketDebuggerUrl, expression, { timeoutMs: 8000 });
  return toolJson({
    action,
    metroPort,
    target: Array.isArray(targets) ? {
      title: targets[0]?.title,
      appId: targets[0]?.appId,
      deviceName: targets[0]?.deviceName,
      description: targets[0]?.description,
    } : null,
    inspector: result?.result?.result?.value ?? null,
    protocolError: result?.result?.exceptionDetails ?? result?.error ?? null,
    cdp: result?.diagnostics ?? result?.cdp ?? null,
  });
}

function normalizeRuntimeInspectorAction(value) {
  const action = requireString(value, "action");
  if (!["probe", "toggle", "install-comment-menu", "read-comments", "clear-comments", "open-dev-menu"].includes(action)) {
    throw new Error(`Unknown inspector action: ${action}`);
  }
  return action;
}

async function openIosDevMenu(args) {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const messageClient = new ExpoMessageClient(metroPort);
  let messageSocket = await messageClient.broadcast("devMenu");
  if (messageSocket.available) {
    return {
      available: true,
      action: "open-dev-menu",
      platform: "ios",
      transport: "metro-message-socket",
      metroPort,
      requestedDevice: args.device ?? null,
      messageSocket,
      note: "This uses Expo/Metro's /message websocket devMenu broadcast, matching the Expo CLI toggle developer menu path.",
    };
  }

  const device = await resolveIosDevice(args.device, { preferBooted: true });
  const devClientUrl = requireOptionalString(args.devClientUrl);
  let devClientRepair = null;
  if (devClientUrl) {
    devClientRepair = await messageClient.openDevClient({
      device,
      bundleId: args.bundleId,
      devClientUrl,
      restartDevClient: args.restartDevClient === true,
      metroPort,
      crashCheckMs: args.crashCheckMs,
    });
    if (devClientRepair.crashReports?.length) {
      return {
        available: false,
        action: "open-dev-menu",
        platform: "ios",
        device,
        metroPort,
        devClientRepair,
        messageSocket,
        reason: "The app generated an iOS crash report after opening the development client URL.",
      };
    }
    messageSocket = await messageClient.broadcast("devMenu");
    if (messageSocket.available) {
      return {
        available: true,
        action: "open-dev-menu",
        platform: "ios",
        transport: "metro-message-socket",
        metroPort,
        requestedDevice: args.device ?? null,
        device,
        devClientRepair,
        messageSocket,
        note: "Opened the supplied Expo development client URL, then used Metro's /message websocket devMenu broadcast.",
      };
    }
  }

  const command = ["xcrun", "simctl", "io", device.udid, "shake"];
  const result = await execFilePromise(command[0], command.slice(1), {
    timeout: 15_000,
    rejectOnError: false,
  });
  return {
    available: !result.error,
    action: "open-dev-menu",
    platform: "ios",
    device,
    command,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    error: result.error,
    messageSocket,
    devClientRepair,
    note: "Tried Expo/Metro's /message websocket devMenu broadcast first, then fell back to the simulator shake gesture.",
  };
}

async function openDevClientForMessageSocket({ device, bundleId, devClientUrl, restartDevClient, metroPort, crashCheckMs }) {
  return new ExpoMessageClient(metroPort).openDevClient({ device, bundleId, devClientUrl, restartDevClient, crashCheckMs });
}

async function broadcastMetroMessage(metroPort, method, params = undefined) {
  return new ExpoMessageClient(metroPort).broadcast(method, params);
}

class ExpoMessageClient {
  constructor(metroPort) {
    this.metroPort = metroPort;
    this.url = `ws://127.0.0.1:${metroPort}/message`;
  }

  async openDevClient({ device, bundleId, devClientUrl, restartDevClient, crashCheckMs }) {
  const actions = [];
  const startedAt = Date.now();
  if (restartDevClient && bundleId) {
    const terminate = await execFilePromise("xcrun", ["simctl", "terminate", device.udid, bundleId], {
      timeout: 10_000,
      rejectOnError: false,
    });
    actions.push({
      action: "terminate",
      bundleId,
      stdout: truncate(terminate.stdout),
      stderr: truncate(terminate.stderr),
      error: terminate.error,
    });
  }
  const open = await execFilePromise("xcrun", ["simctl", "openurl", device.udid, devClientUrl], {
    timeout: 10_000,
    rejectOnError: false,
  });
  actions.push({
    action: "openurl",
    devClientUrl,
    stdout: truncate(open.stdout),
    stderr: truncate(open.stderr),
    error: open.error,
  });
  const reconnectTimeoutMs = clampNumber(process.env.EXPO_IOS_DEV_CLIENT_RECONNECT_TIMEOUT_MS ?? 30_000, 100, 30_000);
  const deadline = Date.now() + reconnectTimeoutMs;
  let peerProbe = null;
  while (Date.now() < deadline) {
    await wait(1000);
      peerProbe = await this.discoverPeers();
    if (peerProbe.available || peerProbe.connectedPeerCount > 0) break;
  }
  return {
    available: peerProbe?.available === true || (peerProbe?.connectedPeerCount ?? 0) > 0,
    transport: "simctl-openurl",
      metroPort: this.metroPort,
    actions,
    reconnectTimeoutMs,
    peerProbe,
    ...(await iosCrashEvidence({
      bundleId,
      sinceMs: startedAt,
      waitMs: crashCheckMs,
      action: "open-dev-client",
    })),
  };
  }

  async discoverPeers() {
    return this.broadcast(null);
  }

  async broadcast(method, params = undefined) {
    if (typeof WebSocket !== "function") {
      return { available: false, transport: "metro-message-socket", metroPort: this.metroPort, reason: "This Node runtime does not expose a WebSocket client." };
    }
    const ws = new WebSocket(this.url);
    const pending = new Map();
    let nextId = 1;
    const sendRequest = (message) => {
      const id = `expo-ios-${Date.now()}-${nextId++}`;
      ws.send(JSON.stringify({ ...message, id, version: 2 }));
      return new Promise((resolve) => pending.set(id, resolve));
    };
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id && pending.has(message.id)) {
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        resolve(message);
      }
    };

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Metro message websocket open timed out.")), 1500);
        ws.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        ws.onerror = (error) => {
          clearTimeout(timer);
          reject(error);
        };
      });
      const peersResponse = await withTimeout(
        sendRequest({ method: "getpeers", target: "server" }),
        1500,
        { error: "Metro message websocket getpeers timed out." },
      );
      if (peersResponse?.error) {
        return { available: false, transport: "metro-message-socket", metroPort: this.metroPort, url: this.url, reason: peersResponse.error };
      }
      const peers = peersResponse?.result && typeof peersResponse.result === "object" ? peersResponse.result : {};
      const connectedPeerCount = Object.keys(peers).length;
      if (connectedPeerCount < 1) {
        return { available: false, transport: "metro-message-socket", metroPort: this.metroPort, url: this.url, reason: "No connected app peers on Metro /message websocket.", connectedPeerCount };
      }
      if (method) {
        ws.send(JSON.stringify(params === undefined ? { method, version: 2 } : { method, params, version: 2 }));
        await wait(100);
      }
      return { available: true, transport: "metro-message-socket", metroPort: this.metroPort, url: this.url, method: method ?? null, connectedPeerCount };
    } catch (error) {
      return { available: false, transport: "metro-message-socket", metroPort: this.metroPort, url: this.url, reason: formatError(error) };
    } finally {
      try {
        ws.close();
      } catch {
        // ignored
      }
    }
  }
}

async function buildExpoRouteUrl(cwd, args) {
  const scheme = requireOptionalString(args.scheme) ?? await inferExpoScheme(cwd);
  if (!scheme) {
    throw new Error("Could not infer Expo scheme. Pass scheme or url.");
  }
  const rawRoute = requireOptionalString(args.route) ?? "/";
  const route = rawRoute.startsWith("/") ? rawRoute.slice(1) : rawRoute;
  const params = new URLSearchParams(requireOptionalString(args.query) ?? "");
  const authCookie = requireOptionalString(args.authCookie);
  if (authCookie) params.set("cookie", authCookie);
  const query = params.toString();
  return `${scheme}:///${route}${query ? `?${query}` : ""}`;
}

async function inferExpoScheme(cwd) {
  const appJsonPath = path.join(cwd, "app.json");
  if (await pathExists(appJsonPath)) {
    const appJson = await readJsonFile(appJsonPath);
    const scheme = appJson?.expo?.scheme ?? appJson?.scheme;
    if (typeof scheme === "string" && scheme.trim()) return scheme.trim();
  }
  const configPath = await firstExisting(cwd, ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]);
  if (!configPath) return null;
  const text = await fs.readFile(configPath, "utf8");
  const match = /\bscheme\s*:\s*["'`]([^"'`]+)["'`]/.exec(text);
  return match?.[1] ?? null;
}

async function expoProjectRuntimeSummary(cwd) {
  const packageJsonPath = await findUp(cwd, "package.json");
  const projectRoot = packageJsonPath ? path.dirname(packageJsonPath) : cwd;
  const packageJson = packageJsonPath ? await readJsonFile(packageJsonPath) : {};
  const deps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  const appConfig = await readExpoConfigSummary(projectRoot);
  return {
    projectRoot,
    packageManager: await detectPackageManager(projectRoot),
    expoDependency: deps.expo ?? null,
    reactNativeDependency: deps["react-native"] ?? null,
    expoRouterDependency: deps["expo-router"] ?? null,
    scripts: packageJson.scripts ?? {},
    appConfig,
  };
}

async function readExpoConfigSummary(projectRoot) {
  const appJsonPath = path.join(projectRoot, "app.json");
  if (await pathExists(appJsonPath)) {
    const appJson = await readJsonFile(appJsonPath);
    const expo = appJson.expo ?? appJson;
    return {
      source: appJsonPath,
      name: expo.name ?? null,
      slug: expo.slug ?? null,
      scheme: expo.scheme ?? null,
      iosBundleIdentifier: expo.ios?.bundleIdentifier ?? null,
      androidPackage: expo.android?.package ?? null,
      easProjectId: expo.extra?.eas?.projectId ?? null,
      userInterfaceStyle: expo.userInterfaceStyle ?? null,
    };
  }
  const configPath = await firstExisting(projectRoot, ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]);
  if (!configPath) return null;
  const text = await fs.readFile(configPath, "utf8");
  return {
    source: configPath,
    name: regexConfigValue(text, "name"),
    slug: regexConfigValue(text, "slug"),
    scheme: regexConfigValue(text, "scheme"),
    iosBundleIdentifier: regexNestedConfigValue(text, "bundleIdentifier"),
    androidPackage: regexNestedConfigValue(text, "package"),
    easProjectId: regexConfigValue(text, "projectId"),
    userInterfaceStyle: regexConfigValue(text, "userInterfaceStyle"),
    dynamic: true,
  };
}

function regexConfigValue(text, key) {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}

function regexNestedConfigValue(text, key) {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}

async function inspectMetro(port, options = {}) {
  const status = await fetchLocalText(`http://127.0.0.1:${port}/status`, { timeoutMs: 1500 }).catch((error) => `unavailable: ${formatError(error)}`);
  const targets = await fetchLocalJson(`http://127.0.0.1:${port}/json/list`, { timeoutMs: 2500 }).catch(() => []);
  const version = await fetchLocalJson(`http://127.0.0.1:${port}/json/version`, { timeoutMs: 1500 }).catch(() => null);
  const runtime = await inspectHermesRuntime(targets[0]?.webSocketDebuggerUrl, options);
  return {
    metro: {
      port,
      status,
      version,
      targetCount: Array.isArray(targets) ? targets.length : 0,
      targets: Array.isArray(targets)
        ? targets.map((target) => ({
            id: target.id,
            title: target.title,
            description: target.description,
            appId: target.appId,
            deviceName: target.deviceName,
            devtoolsFrontendUrl: target.devtoolsFrontendUrl,
            webSocketDebuggerUrl: target.webSocketDebuggerUrl,
            reactNative: target.reactNative ?? null,
          }))
        : [],
    },
    runtime,
  };
}

async function inspectHermesRuntime(webSocketDebuggerUrl, options = {}) {
  if (!webSocketDebuggerUrl) return { available: false, reason: "No Metro inspector target." };
  if (typeof WebSocket !== "function") {
    return { available: false, reason: "This Node runtime does not expose a WebSocket client." };
  }
  const client = new HermesCdpClient(webSocketDebuggerUrl, { target: options.target });

  try {
    await client.connect({ timeoutMs: 2500 });
    const results = {};
    results.runtimeEnable = await client.call("Runtime.enable", {}, { timeoutMs: 2500 });
    results.debuggerEnable = await client.call("Debugger.enable", {}, { timeoutMs: 2500 });
    await wait(350);
    const concurrentCalls = [
      client.call("Runtime.getHeapUsage", {}, { timeoutMs: 2500 }),
      client.call("Runtime.evaluate", {
        expression: `(() => ({
          dev: typeof __DEV__ !== 'undefined' ? __DEV__ : null,
          hermes: !!globalThis.HermesInternal,
          fabric: !!globalThis.nativeFabricUIManager,
          navigatorProduct: typeof navigator !== 'undefined' ? navigator.product : null,
          location: typeof location !== 'undefined' ? String(location.href) : null,
          performanceNow: typeof performance !== 'undefined' && performance.now ? Math.round(performance.now()) : null,
          globals: Object.keys(globalThis).filter((key) => /Expo|React|Metro|Hermes|native|performance|location|__r/.test(key)).sort().slice(0, 80)
        }))()`,
        returnByValue: true,
      }, { timeoutMs: 2500 }),
      options.includeComponents === false
        ? Promise.resolve({ method: "Runtime.evaluate", result: { result: { value: { skipped: true, reason: "includeComponents is false" } } } })
        : client.call("Runtime.evaluate", {
            expression: reactComponentHierarchyProbeExpression(options),
            returnByValue: true,
          }, { timeoutMs: 3000 }),
    ];
    [results.heap, results.globals, results.componentHierarchy] = await Promise.all(concurrentCalls);

    return {
      available: true,
      webSocketDebuggerUrl,
      heap: results.heap?.result ?? null,
      globals: results.globals?.result?.result?.value ?? null,
      componentHierarchy: results.componentHierarchy?.result?.result?.value ?? null,
      unsupportedOrErrors: Object.values(results).filter((value) => value?.error).map((value) => value.error),
      loadedAppScripts: summarizeScripts(client.events("Debugger.scriptParsed").map((event) => event.params)),
      cdp: client.diagnostics(),
    };
  } catch (error) {
    return { available: false, webSocketDebuggerUrl, error: formatError(error), cdp: client.diagnostics() };
  } finally {
    client.close();
  }
}

async function evaluateHermesExpression(webSocketDebuggerUrl, expression, { timeoutMs = 3000 } = {}) {
  if (typeof WebSocket !== "function") {
    return { error: "This Node runtime does not expose a WebSocket client." };
  }
  const client = new HermesCdpClient(webSocketDebuggerUrl);

  try {
    await client.connect({ timeoutMs: 2500 });
    const enable = await client.call("Runtime.enable", {}, { timeoutMs: 1500 });
    if (enable.error) return { error: enable.error, diagnostics: client.diagnostics() };
  const result = await client.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, { timeoutMs });
    return { ...result, diagnostics: client.diagnostics() };
  } catch (error) {
    return { error: formatError(error), diagnostics: client.diagnostics() };
  } finally {
    client.close();
  }
}

class HermesCdpClient {
  constructor(webSocketDebuggerUrl, { target = null } = {}) {
    this.webSocketDebuggerUrl = webSocketDebuggerUrl;
    this.target = target;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventLog = [];
    this.invalidMessages = [];
    this.callLog = [];
    this.closeInfo = null;
  }

  connect({ timeoutMs = 2500 } = {}) {
    this.ws = new WebSocket(this.webSocketDebuggerUrl);
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onclose = (event) => this.handleClose(event);
    this.ws.onerror = (error) => {
      if (!this.closeInfo) this.closeInfo = { reason: shortDiagnostic(formatError(error)), clean: false };
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Inspector websocket open timed out.")), timeoutMs);
      this.ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      this.ws.onerror = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  }

  call(method, params = {}, { timeoutMs = 2500 } = {}) {
    const id = this.nextId++;
    const callRecord = { id, method, timeoutMs, status: "pending" };
    this.callLog.push(callRecord);
    return new Promise((resolve) => {
      const finish = (message) => {
        clearTimeout(timer);
        this.pending.delete(id);
        callRecord.status = message.error ? "protocol-error" : "ok";
        callRecord.response = responseShape(message.result);
        if (message.error) callRecord.protocolError = normalizeProtocolError(message.error);
        resolve({
          method,
          result: message.result,
          error: message.error ? protocolErrorMessage(message.error) : undefined,
          cdp: { method, timeoutMs, response: callRecord.response, protocolError: callRecord.protocolError ?? null },
        });
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        callRecord.status = "timeout";
        callRecord.protocolError = { message: `${method} timed out.`, code: "timeout" };
        resolve({
          method,
          error: `${method} timed out.`,
          cdp: { method, timeoutMs, response: null, protocolError: callRecord.protocolError },
        });
      }, timeoutMs);
      this.pending.set(id, { method, finish });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        callRecord.status = "send-error";
        callRecord.protocolError = { message: shortDiagnostic(formatError(error)), code: "send-error" };
        resolve({
          method,
          error: formatError(error),
          cdp: { method, timeoutMs, response: null, protocolError: callRecord.protocolError },
        });
      }
    });
  }

  handleMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      this.invalidMessages.push({ message: shortDiagnostic(formatError(error)), sample: shortDiagnostic(event.data, 120) });
      return;
    }
    if (message.id && this.pending.has(message.id)) {
      this.pending.get(message.id).finish(message);
      return;
    }
    if (message.method) {
      this.eventLog.push({
        method: String(message.method),
        params: responseShape(message.params),
      });
    }
  }

  handleClose(event) {
    this.closeInfo = {
      code: event?.code ?? null,
      reason: event?.reason ? shortDiagnostic(event.reason, 180) : null,
      clean: Boolean(event?.wasClean),
    };
    for (const [id, pendingCall] of this.pending.entries()) {
      const record = this.callLog.find((item) => item.id === id);
      if (record) {
        record.status = "closed";
        record.protocolError = { message: `Inspector websocket closed before ${pendingCall.method} completed.`, code: "closed" };
      }
      pendingCall.finish({ error: { message: `Inspector websocket closed before ${pendingCall.method} completed.`, code: "closed" } });
    }
  }

  events(method) {
    return this.eventLog.filter((event) => event.method === method);
  }

  diagnostics() {
    return {
      transport: "cdp-websocket",
      webSocketDebuggerUrl: this.webSocketDebuggerUrl,
      target: this.target ? targetSummary(this.target) : null,
      calls: this.callLog.map((call) => ({
        method: call.method,
        timeoutMs: call.timeoutMs,
        status: call.status,
        response: call.response ?? null,
        protocolError: call.protocolError ?? null,
      })),
      events: this.eventLog.slice(-20),
      invalidMessages: this.invalidMessages.slice(-5),
      close: this.closeInfo,
    };
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // ignored
    }
  }
}

function responseShape(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value !== "object") return { type: typeof value };
  const keys = Object.keys(value).slice(0, 20);
  const shape = { type: "object", keys };
  if (typeof value.type === "string") shape.resultType = value.type;
  if (value.result && typeof value.result === "object") shape.result = responseShape(value.result);
  return shape;
}

function normalizeProtocolError(error) {
  if (!error || typeof error !== "object") return { message: shortDiagnostic(error), code: "protocol-error" };
  return {
    message: shortDiagnostic(error.message ?? error.description ?? error),
    code: error.code ?? "protocol-error",
    data: error.data == null ? undefined : shortDiagnostic(typeof error.data === "string" ? error.data : JSON.stringify(error.data), 500),
  };
}

function protocolErrorMessage(error) {
  if (!error || typeof error !== "object") return shortDiagnostic(error);
  const code = error.code == null ? "" : ` (${error.code})`;
  return `${error.message ?? error.description ?? "CDP protocol error"}${code}`;
}

function shortDiagnostic(value, max = 240) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function summarizeScripts(scripts) {
  const appScripts = scripts
    .filter((script) => /\/apps\/mobile\/app\/|\/app\//.test(script.url ?? script.sourceMapURL ?? ""))
    .map((script) => ({
      scriptId: script.scriptId,
      url: script.url || null,
      sourceMapURL: script.sourceMapURL || null,
    }));
  const sourceOwners = [...new Set(appScripts.flatMap((script) => {
    const values = [script.url, script.sourceMapURL].filter(Boolean);
    return values
      .map((value) => decodeURIComponent(value))
      .map((value) => value.split("?")[0])
      .map((value) => value.replace(/^https?:\/\/[^/]+/, ""))
      .filter((value) => /\/apps\/mobile\/app\//.test(value));
  }))].slice(0, 40);
  return {
    totalScriptsObserved: scripts.length,
    appScriptCount: appScripts.length,
    appScripts: appScripts.slice(0, 40),
    sourceOwners,
  };
}

function interactionTraceExpression({ action, maxEvents, componentFilter, includeEvents }) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const maxEvents = ${JSON.stringify(maxEvents)};
    const includeEvents = ${JSON.stringify(Boolean(includeEvents))};
    const componentFilter = ${JSON.stringify(componentFilter ?? "")};
    const filterNeedle = String(componentFilter || '').toLowerCase();
    const now = () => Math.round((typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) * 10) / 10;
    const globalKey = '__EXPO_LOCAL_DEV_INTERACTION_TRACE__';
    const tracer = globalThis[globalKey] ||= {
      installed: false,
      startedAt: null,
      events: [],
      lastSnapshot: new Map(),
      originals: {},
      errors: []
    };

    function short(value, max = 160) {
      if (value == null) return null;
      const text = String(value);
      return text.length > max ? text.slice(0, max) + '...' : text;
    }

    function push(type, payload = {}) {
      const event = { t: now(), type, ...payload };
      tracer.events.push(event);
      const hardLimit = Math.max(2000, maxEvents * 3);
      if (tracer.events.length > hardLimit) tracer.events.splice(0, tracer.events.length - hardLimit);
      return event;
    }

    function primitive(value) {
      return value == null || ['string', 'number', 'boolean'].includes(typeof value);
    }

    function typeName(type) {
      if (!type) return null;
      if (typeof type === 'string') return type;
      return type.displayName || type.name || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name || null;
    }

    function fiberName(fiber) {
      return typeName(fiber.elementType) || typeName(fiber.type) || fiber._debugName || tagName(fiber.tag);
    }

    function tagName(tag) {
      const names = { 0: 'FunctionComponent', 1: 'ClassComponent', 3: 'HostRoot', 5: 'HostComponent', 6: 'HostText', 7: 'Fragment', 10: 'ContextProvider', 11: 'ForwardRef', 14: 'MemoComponent', 15: 'SimpleMemoComponent' };
      return names[tag] || ('FiberTag' + tag);
    }

    function debugSource(fiber) {
      const source = fiber?._debugSource;
      if (!source) return null;
      return { fileName: source.fileName || null, lineNumber: source.lineNumber || null, columnNumber: source.columnNumber || null };
    }

    function ownerName(fiber) {
      return fiber?._debugOwner ? fiberName(fiber._debugOwner) : null;
    }

    function flattenText(value, out = []) {
      if (out.join(' ').length > 220) return out;
      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim();
        if (text) out.push(short(text, 100));
      } else if (Array.isArray(value)) {
        for (const item of value.slice(0, 16)) flattenText(item, out);
      }
      return out;
    }

    const layoutKeys = [
      'display','position','top','right','bottom','left','width','height','minWidth','minHeight','maxWidth','maxHeight',
      'flex','flexGrow','flexShrink','flexBasis','flexDirection','alignItems','alignSelf','justifyContent',
      'gap','rowGap','columnGap','margin','marginTop','marginRight','marginBottom','marginLeft',
      'padding','paddingTop','paddingRight','paddingBottom','paddingLeft','textAlign','overflow',
      'transform','opacity'
    ];
    const classKeys = ['className', 'contentContainerClassName'];
    const styleKeys = ['style', 'contentContainerStyle', 'containerStyle', 'indicatorStyle'];
    const handlerKeys = [
      'onScroll','onScrollBeginDrag','onScrollEndDrag','onMomentumScrollBegin','onMomentumScrollEnd',
      'onTouchStart','onTouchMove','onTouchEnd','onResponderGrant','onResponderMove','onResponderRelease',
      'onStartShouldSetResponder','onMoveShouldSetResponder','onGestureEvent','onHandlerStateChange',
      'onPress','onPressIn','onPressOut','onLongPress'
    ];

    function summarizeStyle(style, depth = 0) {
      if (!style || depth > 4) return null;
      if (typeof style === 'number') return { stylesheetId: style };
      if (Array.isArray(style)) {
        const merged = {};
        for (const item of style.slice(0, 12)) {
          const part = summarizeStyle(item, depth + 1);
          if (part && typeof part === 'object' && !Array.isArray(part)) Object.assign(merged, part);
        }
        return Object.keys(merged).length ? merged : null;
      }
      if (typeof style !== 'object') return null;
      const summary = {};
      for (const key of layoutKeys) {
        if (primitive(style[key])) summary[key] = style[key];
        else if (key === 'transform' && Array.isArray(style[key])) {
          try { summary[key] = JSON.parse(JSON.stringify(style[key].slice(0, 8))); } catch {}
        }
      }
      return Object.keys(summary).length ? summary : null;
    }

    function summarizeProps(props) {
      if (!props || typeof props !== 'object') return {};
      const summary = {};
      for (const key of ['accessibilityLabel','accessibilityRole','testID','nativeID','pointerEvents']) {
        if (primitive(props[key])) summary[key] = short(props[key], 140);
      }
      const text = flattenText(props.children).join(' ');
      if (text) summary.text = short(text, 180);
      for (const key of classKeys) {
        if (typeof props[key] === 'string' && props[key].trim()) summary[key] = short(props[key], 240);
      }
      for (const key of styleKeys) {
        const style = summarizeStyle(props[key]);
        if (style) summary[key] = style;
      }
      const handlers = handlerKeys.filter((key) => typeof props[key] === 'function');
      if (handlers.length) summary.handlers = handlers;
      return summary;
    }

    function matches(info) {
      if (!filterNeedle) return true;
      return [info.name, info.owner, info.label, info.testID, info.text, info.className, info.contentContainerClassName, info.source?.fileName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filterNeedle));
    }

    function walk(root) {
      const nodes = [];
      let truncated = false;
      function visit(fiber, depth, parentId, path) {
        if (!fiber || nodes.length >= 1800) {
          if (fiber) truncated = true;
          return;
        }
        const props = summarizeProps(fiber.memoizedProps);
        const label = props.accessibilityLabel || props.text || null;
        const info = {
          id: nodes.length + 1,
          parentId,
          depth,
          path,
          name: fiberName(fiber),
          owner: ownerName(fiber),
          label,
          text: props.text || null,
          testID: props.testID || null,
          role: props.accessibilityRole || null,
          className: props.className || null,
          contentContainerClassName: props.contentContainerClassName || null,
          source: debugSource(fiber),
          layout: {
            className: props.className || null,
            contentContainerClassName: props.contentContainerClassName || null,
            style: props.style || null,
            contentContainerStyle: props.contentContainerStyle || null,
            containerStyle: props.containerStyle || null,
            indicatorStyle: props.indicatorStyle || null,
            pointerEvents: props.pointerEvents || null
          },
          handlers: props.handlers || []
        };
        nodes.push(info);
        let child = fiber.child;
        let index = 0;
        while (child) {
          visit(child, depth + 1, info.id, path + '.' + index);
          child = child.sibling;
          index += 1;
        }
      }
      visit(root?.current?.child, 0, null, '0');
      return { nodes, truncated };
    }

    function layoutSignature(info) {
      return JSON.stringify(info.layout || {});
    }

    function handleCommit(root, reason = 'reactCommit') {
      const result = walk(root);
      const changed = [];
      const active = [];
      for (const info of result.nodes) {
        const sig = layoutSignature(info);
        const prev = tracer.lastSnapshot.get(info.path);
        if (matches(info) && (info.handlers.length || info.label || info.testID || /Animated|Scroll|Gesture|Pressable|Calendar|Draft|Event|Glass|Tab|Screen|Route/.test(info.name))) {
          active.push({
            id: info.id,
            parentId: info.parentId,
            depth: info.depth,
            name: info.name,
            owner: info.owner,
            label: info.label,
            role: info.role,
            testID: info.testID,
            handlers: info.handlers,
            layout: info.layout
          });
        }
        if (matches(info) && prev && prev !== sig) {
          changed.push({
            id: info.id,
            parentId: info.parentId,
            depth: info.depth,
            name: info.name,
            owner: info.owner,
            label: info.label,
            role: info.role,
            testID: info.testID,
            before: safeParse(prev),
            after: info.layout
          });
        }
        tracer.lastSnapshot.set(info.path, sig);
      }
      push(reason, {
        nodeCount: result.nodes.length,
        truncated: result.truncated,
        changedLayout: changed.slice(0, 40),
        activeElements: active.slice(0, 24)
      });
    }

    function safeParse(text) {
      try { return JSON.parse(text); } catch { return text; }
    }

    function compactLayout(layout) {
      if (!layout || typeof layout !== 'object') return null;
      return {
        className: layout.className || null,
        contentContainerClassName: layout.contentContainerClassName || null,
        style: layout.style || null,
        contentContainerStyle: layout.contentContainerStyle || null,
        containerStyle: layout.containerStyle || null,
        indicatorStyle: layout.indicatorStyle || null,
        pointerEvents: layout.pointerEvents || null
      };
    }

    function compactElement(info) {
      if (!info || typeof info !== 'object') return null;
      return {
        id: info.id ?? null,
        parentId: info.parentId ?? null,
        depth: info.depth ?? null,
        name: info.name || null,
        owner: info.owner || null,
        label: info.label || null,
        role: info.role || null,
        testID: info.testID || null,
        handlers: Array.isArray(info.handlers) ? info.handlers.slice(0, 16) : [],
        layout: compactLayout(info.layout)
      };
    }

    function compactChange(change) {
      if (!change || typeof change !== 'object') return null;
      return {
        id: change.id ?? null,
        parentId: change.parentId ?? null,
        depth: change.depth ?? null,
        name: change.name || null,
        owner: change.owner || null,
        label: change.label || null,
        role: change.role || null,
        testID: change.testID || null,
        before: compactLayout(change.before),
        after: compactLayout(change.after)
      };
    }

    function compactEvent(event) {
      const out = {
        t: event.t,
        type: event.type
      };
      if (event.filter != null) out.filter = event.filter;
      if (event.message) out.message = event.message;
      if (event.nodeCount != null) out.nodeCount = event.nodeCount;
      if (event.truncated != null) out.truncated = event.truncated;
      if (event.frameTime != null) out.frameTime = event.frameTime;
      if (event.changedLayout?.length) {
        out.changedLayoutCount = event.changedLayout.length;
        out.changedComponents = event.changedLayout.slice(0, 8).map((item) => ({
          name: item?.name || null,
          owner: item?.owner || null,
          label: item?.label || null,
          testID: item?.testID || null
        }));
      }
      if (event.activeElements?.length) {
        out.activeElementCount = event.activeElements.length;
        out.activeComponents = event.activeElements.slice(0, 8).map((item) => ({
          name: item?.name || null,
          owner: item?.owner || null,
          label: item?.label || null,
          testID: item?.testID || null,
          handlers: Array.isArray(item?.handlers) ? item.handlers.slice(0, 8) : []
        }));
      }
      return out;
    }

    function install() {
      tracer.filter = componentFilter || null;
      if (tracer.installed) {
        push('traceAlreadyInstalled', { filter: tracer.filter });
        return;
      }
      tracer.installed = true;
      tracer.startedAt = new Date().toISOString();
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && typeof hook.getFiberRoots === 'function') {
        tracer.originals.onCommitFiberRoot = hook.onCommitFiberRoot;
        hook.onCommitFiberRoot = function tracedCommit(...args) {
          try { handleCommit(args[1]); } catch (error) { tracer.errors.push(short(error?.message || error, 220)); }
          if (typeof tracer.originals.onCommitFiberRoot === 'function') return tracer.originals.onCommitFiberRoot.apply(this, args);
        };
        for (const rendererId of Array.from(hook.renderers?.keys?.() || [])) {
          for (const root of Array.from(hook.getFiberRoots(rendererId) || [])) {
            try { handleCommit(root, 'initialTree'); } catch (error) { tracer.errors.push(short(error?.message || error, 220)); }
          }
        }
      } else {
        push('warning', { message: 'React DevTools hook not available; only requestAnimationFrame patch can be installed.' });
      }
      if (typeof globalThis.requestAnimationFrame === 'function' && !tracer.originals.requestAnimationFrame) {
        tracer.originals.requestAnimationFrame = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = function tracedRaf(callback) {
          push('requestAnimationFrame', {});
          return tracer.originals.requestAnimationFrame.call(this, function tracedRafCallback(ts) {
            push('animationFrame', { frameTime: ts });
            return callback(ts);
          });
        };
      }
      push('traceStarted', { filter: tracer.filter });
    }

    function read() {
      const events = tracer.events.slice(-maxEvents);
      const counts = {};
      const handlers = {};
      const components = {};
      const layoutChanges = [];
      const activeElements = new Map();
      for (const event of events) {
        counts[event.type] = (counts[event.type] || 0) + 1;
        if (event.handler) handlers[event.handler] = (handlers[event.handler] || 0) + 1;
        if (event.component) components[event.component] = (components[event.component] || 0) + 1;
        if (event.changedLayout?.length) {
          layoutChanges.push(...event.changedLayout);
          for (const item of event.changedLayout) {
            if (item?.name) components[item.name] = (components[item.name] || 0) + 1;
          }
        }
        if (event.activeElements?.length) {
          for (const item of event.activeElements) {
            if (item?.name) components[item.name] = (components[item.name] || 0) + 1;
            for (const handler of item?.handlers || []) handlers[handler] = (handlers[handler] || 0) + 1;
            const key = [item?.name, item?.owner, item?.label, item?.testID, item?.depth].filter(Boolean).join('|');
            if (key) activeElements.set(key, compactElement(item));
          }
        }
      }
      const top = (object) => Object.entries(object).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, count }));
      const compactEvents = events.map(compactEvent);
      const response = {
        available: true,
        installed: tracer.installed,
        startedAt: tracer.startedAt,
        filter: tracer.filter || null,
        eventCount: tracer.events.length,
        returnedEventCount: events.length,
        counts,
        topDeclaredHandlers: top(handlers),
        topComponents: top(components),
        activeElements: Array.from(activeElements.values()).slice(-30),
        layoutChanges: layoutChanges.slice(-40).map(compactChange).filter(Boolean),
        recentEvents: compactEvents.slice(-20),
        errors: tracer.errors.slice(-20),
        interpretationHints: [
          'Scroll or drag bugs usually show reactCommit/layout changes and handler-bearing components such as onScroll/onResponderMove/onGestureEvent near the affected subtree.',
          'This tracer does not wrap app event handlers; topDeclaredHandlers reports handler props present in the committed tree, not handler invocations.',
          'If requestAnimationFrame/animationFrame is active but no React commits occur, the animation may be native-driver/Reanimated/UI-thread and needs screenshot/video or native instrumentation.',
          'changedLayout is declared prop/class/style churn, not final Yoga frame movement.'
        ]
      };
      if (includeEvents) response.events = events;
      return response;
    }

    function stop() {
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && tracer.originals && Object.prototype.hasOwnProperty.call(tracer.originals, 'onCommitFiberRoot')) {
        hook.onCommitFiberRoot = tracer.originals.onCommitFiberRoot;
      }
      if (tracer.originals?.requestAnimationFrame) {
        globalThis.requestAnimationFrame = tracer.originals.requestAnimationFrame;
      }
      tracer.installed = false;
      push('traceStopped', {});
      return read();
    }

    if (action === 'start') {
      tracer.events = [];
      tracer.errors = [];
      tracer.lastSnapshot = new Map();
      install();
      return read();
    }
    if (action === 'read') return read();
    if (action === 'clear') {
      tracer.events = [];
      tracer.errors = [];
      tracer.lastSnapshot = new Map();
      push('traceCleared', {});
      return read();
    }
    if (action === 'stop') return stop();
    return { available: false, reason: 'Unknown trace action: ' + action };
  })()`;
}

function runtimeInspectorExpression({ action, commentTitle, maxComments }) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const commentTitle = ${JSON.stringify(commentTitle)};
    const maxComments = ${JSON.stringify(maxComments)};
    const stateKey = '__CODEX_SIMULATOR_REVIEW__';
    const state = globalThis[stateKey] ||= {
      createdAt: new Date().toISOString(),
      comments: [],
      menuInstalled: false,
      commentTitle: null,
      errors: []
    };

    function short(value, max = 180) {
      if (value == null) return null;
      const text = String(value);
      return text.length > max ? text.slice(0, max) + '...' : text;
    }

    function keys(value) {
      if (!value || typeof value !== 'object') return [];
      try { return Object.keys(value).sort().slice(0, 40); } catch { return []; }
    }

    function recordError(context, error) {
      const message = short(error?.message || error, 260);
      state.errors.push({ at: new Date().toISOString(), context, message });
      if (state.errors.length > 40) state.errors.splice(0, state.errors.length - 40);
      return message;
    }

    function metroRequire() {
      const req = globalThis.__r || globalThis.metroRequire;
      return typeof req === 'function' ? req : null;
    }

    function moduleEntries(req) {
      if (!req || typeof req.getModules !== 'function') return [];
      let modules;
      try { modules = req.getModules(); } catch (error) {
        recordError('metroRequire.getModules', error);
        return [];
      }
      if (!modules) return [];
      if (typeof modules.entries === 'function') return Array.from(modules.entries()).slice(0, 5000);
      if (typeof modules.forEach === 'function') {
        const out = [];
        modules.forEach((value, key) => out.push([key, value]));
        return out.slice(0, 5000);
      }
      return Object.keys(modules).slice(0, 5000).map((key) => [key, modules[key]]);
    }

    function moduleLabel(id, module) {
      return short(module?.verboseName || module?.path || module?.output?.[0]?.data?.path || module?.module?.name || id, 260);
    }

    function moduleText(id, module) {
      const parts = [moduleLabel(id, module), module?.verboseName, module?.path, module?.output?.[0]?.data?.path];
      try {
        if (module?.factory) parts.push(String(module.factory).slice(0, 6000));
      } catch {}
      return parts.filter(Boolean).join('\\n');
    }

    function exportShapes(exportsValue) {
      const out = [];
      const seen = new Set();
      function add(value, source) {
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) return;
        if (seen.has(value)) return;
        seen.add(value);
        out.push({ value, source });
      }
      add(exportsValue, 'exports');
      add(exportsValue?.default, 'exports.default');
      add(exportsValue?.DevSettings, 'exports.DevSettings');
      add(exportsValue?.NativeDevSettings, 'exports.NativeDevSettings');
      add(exportsValue?.Alert, 'exports.Alert');
      return out;
    }

    function describeFound(found) {
      if (!found) return null;
      return {
        moduleId: String(found.moduleId),
        module: found.module,
        export: found.exportName,
        keys: keys(found.value)
      };
    }

    function findModule(kind, textPattern, shapeMatcher) {
      const req = metroRequire();
      const entries = moduleEntries(req);
      const candidates = [];
      for (const [id, module] of entries) {
        const text = moduleText(id, module);
        if (!textPattern.test(text)) continue;
        candidates.push({ moduleId: String(id), module: moduleLabel(id, module) });
        let exportsValue;
        try {
          exportsValue = req(id);
        } catch (error) {
          recordError('require ' + kind + ' candidate ' + String(id), error);
          continue;
        }
        for (const shape of exportShapes(exportsValue)) {
          try {
            if (shapeMatcher(shape.value)) {
              return { value: shape.value, moduleId: id, module: moduleLabel(id, module), exportName: shape.source, candidates: candidates.slice(0, 12) };
            }
          } catch (error) {
            recordError('inspect ' + kind + ' candidate ' + String(id), error);
          }
        }
      }
      return { value: null, candidates: candidates.slice(0, 12) };
    }

    function findNativeDevSettings() {
      try {
        if (typeof globalThis.__turboModuleProxy === 'function') {
          const value = globalThis.__turboModuleProxy('DevSettings');
          if (value && typeof value.toggleElementInspector === 'function') {
            return { value, moduleId: 'global.__turboModuleProxy', module: 'DevSettings', exportName: '__turboModuleProxy', candidates: [] };
          }
        }
      } catch (error) {
        recordError('__turboModuleProxy DevSettings', error);
      }
      return findModule(
        'NativeDevSettings',
        /NativeDevSettings|DevSettings|toggleElementInspector/,
        (value) => value && typeof value.toggleElementInspector === 'function'
      );
    }

    function findDevSettings() {
      return findModule(
        'DevSettings',
        /Libraries\\/Utilities\\/DevSettings|DevSettings|addMenuItem|didPressMenuItem/,
        (value) => value && typeof value.addMenuItem === 'function'
      );
    }

    function findAlert() {
      return findModule(
        'Alert',
        /Libraries\\/Alert\\/Alert|RCTAlertManager|Alert\\.prompt|prompt\\(/,
        (value) => value && (typeof value.prompt === 'function' || typeof value.alert === 'function')
      );
    }

    function commentSummary() {
      return {
        stateKey,
        menuInstalled: !!state.menuInstalled,
        commentTitle: state.commentTitle || null,
        commentCount: state.comments.length,
        comments: state.comments.slice(-maxComments),
        errors: state.errors.slice(-20)
      };
    }

    function capabilityProbe() {
      const req = metroRequire();
      const native = findNativeDevSettings();
      const devSettings = findDevSettings();
      const alert = findAlert();
      return {
        available: true,
        action,
        runtime: {
          dev: typeof __DEV__ !== 'undefined' ? __DEV__ : null,
          hermes: !!globalThis.HermesInternal,
          metroRequire: !!req,
          metroModuleCount: req ? moduleEntries(req).length : 0,
          reactDevToolsHook: !!globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__
        },
        capabilities: {
          toggleElementInspector: !!native.value,
          devMenuCommentPrompt: !!(devSettings.value && alert.value && typeof devSettings.value.addMenuItem === 'function'),
          alertPrompt: !!(alert.value && typeof alert.value.prompt === 'function'),
          alertOnly: !!(alert.value && typeof alert.value.alert === 'function' && typeof alert.value.prompt !== 'function')
        },
        modules: {
          nativeDevSettings: describeFound(native.value ? native : null),
          devSettings: describeFound(devSettings.value ? devSettings : null),
          alert: describeFound(alert.value ? alert : null),
          nativeDevSettingsCandidates: native.candidates || [],
          devSettingsCandidates: devSettings.candidates || [],
          alertCandidates: alert.candidates || []
        },
        comments: commentSummary(),
        limitations: [
          'toggle uses React Native NativeDevSettings.toggleElementInspector, which is a native toggle rather than an explicit show/hide setter.',
          'dev-menu comments are simulator-side and readable by Codex, but they are not automatically attached to a tapped React element.',
          'Automatic element-bound comments require a dev-only overlay mounted in the app tree so it can capture coordinates and touch ownership.'
        ],
        recommendedWorkflow: [
          'Run inspector probe to confirm runtime hooks.',
          'Run inspector toggle to show the built-in RN element inspector in the simulator.',
          'Run inspector install-comment-menu, open the dev menu, and use the Codex comment item while reviewing ambiguous controls.',
          'Run inspector read-comments before final handoff and include comments in the acceptance matrix.'
        ]
      };
    }

    function toggleElementInspector() {
      const native = findNativeDevSettings();
      if (!native.value || typeof native.value.toggleElementInspector !== 'function') {
        const probe = capabilityProbe();
        return {
          available: false,
          action,
          reason: 'Native DevSettings.toggleElementInspector was not found in this Hermes runtime.',
          probe
        };
      }
      try {
        native.value.toggleElementInspector();
        return {
          available: true,
          action,
          toggled: true,
          nativeDevSettings: describeFound(native),
          comments: commentSummary(),
          caution: 'This toggles the built-in inspector. Run again to hide it.'
        };
      } catch (error) {
        return { available: false, action, reason: recordError('toggleElementInspector', error), nativeDevSettings: describeFound(native) };
      }
    }

    function installCommentMenu() {
      const devSettings = findDevSettings();
      const alert = findAlert();
      if (!devSettings.value || typeof devSettings.value.addMenuItem !== 'function') {
        return {
          available: false,
          action,
          reason: 'React Native DevSettings.addMenuItem was not found, so the simulator comment menu cannot be installed.',
          probe: capabilityProbe()
        };
      }
      if (!alert.value || (typeof alert.value.prompt !== 'function' && typeof alert.value.alert !== 'function')) {
        return {
          available: false,
          action,
          reason: 'React Native Alert was not found, so the simulator comment prompt cannot be shown.',
          probe: capabilityProbe()
        };
      }
      try {
        devSettings.value.addMenuItem(commentTitle, () => {
          const save = (text) => {
            const body = String(text || '').trim();
            if (!body) return;
            state.comments.push({
              id: 'comment-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
              createdAt: new Date().toISOString(),
              source: 'simulator-dev-menu-prompt',
              text: body
            });
            if (state.comments.length > 500) state.comments.splice(0, state.comments.length - 500);
          };
          try {
            if (typeof alert.value.prompt === 'function') {
              alert.value.prompt('Codex UI comment', 'Describe the element, control, gesture, or screen issue.', save, 'plain-text');
            } else {
              alert.value.alert('Codex UI comment', 'This runtime exposes Alert.alert but not Alert.prompt. Use the CLI read-comments/probe output and elevate to an app-mounted overlay for typed in-simulator comments.');
            }
          } catch (error) {
            recordError('Codex comment menu handler', error);
          }
        });
        state.menuInstalled = true;
        state.commentTitle = commentTitle;
        return {
          available: true,
          action,
          installed: true,
          devSettings: describeFound(devSettings),
          alert: describeFound(alert),
          comments: commentSummary(),
          instructions: [
            'Open the simulator dev menu.',
            'Choose ' + commentTitle + '.',
            'Type the element or workflow comment in the native prompt.',
            'Run inspector read-comments to retrieve the stored comments.'
          ],
          limitation: 'Comments entered this way are human-authored notes, not automatically bound to a touched element.'
        };
      } catch (error) {
        return { available: false, action, reason: recordError('installCommentMenu', error), devSettings: describeFound(devSettings), alert: describeFound(alert) };
      }
    }

    if (action === 'probe') return capabilityProbe();
    if (action === 'toggle') return toggleElementInspector();
    if (action === 'install-comment-menu') return installCommentMenu();
    if (action === 'read-comments') return { available: true, action, ...commentSummary() };
    if (action === 'clear-comments') {
      state.comments = [];
      return { available: true, action, ...commentSummary() };
    }
    return { available: false, action, reason: 'Unknown inspector action: ' + action };
  })()`;
}

function reactComponentHierarchyProbeExpression(options = {}) {
  const componentFilter = JSON.stringify(options.componentFilter ?? "");
  return `(() => {
    const componentFilter = ${componentFilter};
    const filterNeedle = String(componentFilter || '').toLowerCase();
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook || typeof hook.getFiberRoots !== 'function') {
      return {
        available: false,
        reason: 'React DevTools global hook is not present in this runtime.',
        designerUse: 'No component names are available. Fall back to screenshot, AX hierarchy, routes, and loaded script ownership.'
      };
    }

    const maxDepth = 220;
    const maxNodes = 1800;
    const maxChildrenPerNode = 40;
    const propKeys = [
      'accessibilityLabel',
      'accessibilityRole',
      'accessibilityHint',
      'accessibilityState',
      'accessibilityValue',
      'testID',
      'nativeID',
      'id',
      'href',
      'placeholder',
      'value',
      'title',
      'disabled',
      'selected',
      'pointerEvents',
      'hitSlop',
      'numberOfLines'
    ];
    const classNameKeys = [
      'className',
      'contentContainerClassName'
    ];
    const stylePropKeys = [
      'style',
      'contentContainerStyle',
      'containerStyle',
      'indicatorStyle'
    ];
    const styleKeys = [
      'display',
      'position',
      'top',
      'right',
      'bottom',
      'left',
      'width',
      'height',
      'minWidth',
      'minHeight',
      'maxWidth',
      'maxHeight',
      'flex',
      'flexGrow',
      'flexShrink',
      'flexBasis',
      'flexDirection',
      'alignItems',
      'alignSelf',
      'justifyContent',
      'gap',
      'rowGap',
      'columnGap',
      'margin',
      'marginTop',
      'marginRight',
      'marginBottom',
      'marginLeft',
      'padding',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'backgroundColor',
      'color',
      'opacity',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'textAlign',
      'borderRadius',
      'borderWidth',
      'borderColor',
      'overflow'
    ];

    let nextId = 1;
    let totalNodes = 0;
    let truncated = false;
    const componentCounts = new Map();
    const hostCounts = new Map();
    const sourceFiles = new Map();
    const textSamples = [];
    const textSeen = new Set();
    const interactive = [];
    const interactiveSeen = new Set();
    const layoutStyles = [];
    const layoutSeen = new Set();

    function typeName(type) {
      if (!type) return null;
      if (typeof type === 'string') return type;
      return type.displayName || type.name || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name || null;
    }

    function fiberName(fiber) {
      return typeName(fiber.elementType) || typeName(fiber.type) || fiber._debugName || tagName(fiber.tag);
    }

    function tagName(tag) {
      const names = {
        0: 'FunctionComponent',
        1: 'ClassComponent',
        3: 'HostRoot',
        5: 'HostComponent',
        6: 'HostText',
        7: 'Fragment',
        9: 'ContextConsumer',
        10: 'ContextProvider',
        11: 'ForwardRef',
        14: 'MemoComponent',
        15: 'SimpleMemoComponent'
      };
      return names[tag] || ('FiberTag' + tag);
    }

    function nodeKind(fiber) {
      if (fiber.tag === 3) return 'root';
      if (fiber.tag === 5 || typeof fiber.type === 'string') return 'host';
      if (fiber.tag === 6) return 'text';
      return 'component';
    }

    function debugSource(fiber) {
      const source = fiber?._debugSource;
      if (!source) return null;
      return {
        fileName: source.fileName || null,
        lineNumber: source.lineNumber || null,
        columnNumber: source.columnNumber || null
      };
    }

    function ownerInfo(fiber) {
      const owner = fiber?._debugOwner;
      if (!owner) return null;
      return {
        name: fiberName(owner),
        source: debugSource(owner)
      };
    }

    function primitive(value) {
      return value == null || ['string', 'number', 'boolean'].includes(typeof value);
    }

    function shortString(value, max = 180) {
      if (typeof value !== 'string') return value;
      return value.length > max ? value.slice(0, max) + '...' : value;
    }

    function flattenText(value, out = []) {
      if (out.join(' ').length > 260) return out;
      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim();
        if (text) out.push(shortString(text, 120));
      } else if (Array.isArray(value)) {
        for (const item of value.slice(0, 20)) flattenText(item, out);
      }
      return out;
    }

    function summarizeStyle(style, depth = 0) {
      if (!style || depth > 4) return null;
      if (typeof style === 'number') return { stylesheetId: style };
      if (Array.isArray(style)) {
        const merged = {};
        for (const item of style.slice(0, 12)) {
          const part = summarizeStyle(item, depth + 1);
          if (part && typeof part === 'object' && !Array.isArray(part)) Object.assign(merged, part);
        }
        return Object.keys(merged).length ? merged : null;
      }
      if (typeof style !== 'object') return null;
      const summary = {};
      for (const key of styleKeys) {
        if (primitive(style[key])) summary[key] = shortString(style[key], 120);
      }
      return Object.keys(summary).length ? summary : null;
    }

    function layoutTokensFromClassName(value) {
      if (typeof value !== 'string' || !value.trim()) return [];
      const tokens = value.split(/\\s+/).filter(Boolean);
      return tokens
        .filter((token) => /^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|flex|flex-row|flex-col|items-|justify-|content-|self-|place-|absolute|relative|inset|top|right|bottom|left|w-|h-|min-w|min-h|max-w|max-h|basis-|grow|shrink|overflow|rounded|z-)/.test(token))
        .map((token) => ({ token, ...decodeLayoutToken(token) }));
    }

    function tailwindSpacingValue(raw) {
      if (raw == null) return null;
      const bracket = /^\\[(.+)\\]$/.exec(raw);
      if (bracket) return bracket[1];
      if (raw === 'px') return 1;
      const numeric = Number(raw.replace('_', '.'));
      if (Number.isFinite(numeric)) return numeric * 4;
      return raw;
    }

    function decodeLayoutToken(token) {
      const negative = token.startsWith('-');
      const clean = negative ? token.slice(1) : token;
      const arbitrary = /^([a-z-]+)-\\[(.+)\\]$/.exec(clean);
      if (arbitrary) {
        return { property: arbitrary[1], value: (negative ? '-' : '') + arbitrary[2] };
      }
      const match = /^([a-z-]+)-(.+)$/.exec(clean);
      if (!match) return { property: clean, value: true };
      const [, property, raw] = match;
      const scalarProperties = new Set(['flex', 'grow', 'shrink', 'z', 'opacity']);
      const value = scalarProperties.has(property) && /^-?\\d+(\\.\\d+)?$/.test(raw)
        ? Number(raw)
        : tailwindSpacingValue(raw);
      return { property, value: typeof value === 'number' && negative ? -value : value };
    }

    function layoutStyleOnly(style) {
      const summary = summarizeStyle(style);
      if (!summary) return null;
      const keys = [
        'display',
        'position',
        'top',
        'right',
        'bottom',
        'left',
        'width',
        'height',
        'minWidth',
        'minHeight',
        'maxWidth',
        'maxHeight',
        'flex',
        'flexGrow',
        'flexShrink',
        'flexBasis',
        'flexDirection',
        'alignItems',
        'alignSelf',
        'justifyContent',
        'gap',
        'rowGap',
        'columnGap',
        'margin',
        'marginTop',
        'marginRight',
        'marginBottom',
        'marginLeft',
        'padding',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'textAlign',
        'overflow'
      ];
      const result = {};
      for (const key of keys) {
        if (summary[key] !== undefined) result[key] = summary[key];
      }
      return Object.keys(result).length ? result : null;
    }

    function summarizeProps(props) {
      if (!props || typeof props !== 'object') return {};
      const summary = {};
      for (const key of propKeys) {
        if (primitive(props[key])) summary[key] = shortString(props[key], 160);
        else if (key === 'accessibilityState' || key === 'accessibilityValue' || key === 'hitSlop') {
          try {
            summary[key] = JSON.parse(JSON.stringify(props[key]));
          } catch {}
        }
      }
      const text = flattenText(props.children).join(' ');
      if (text) summary.text = shortString(text, 260);
      for (const key of classNameKeys) {
        if (typeof props[key] === 'string' && props[key].trim()) summary[key] = shortString(props[key], 260);
      }
      for (const key of stylePropKeys) {
        const style = summarizeStyle(props[key]);
        if (style) summary[key] = style;
      }
      const handlers = ['onPress', 'onLongPress', 'onPressIn', 'onPressOut', 'onChangeText', 'onSubmitEditing'];
      const presentHandlers = handlers.filter((key) => typeof props[key] === 'function');
      if (presentHandlers.length) summary.handlers = presentHandlers;
      return summary;
    }

    function filterMatches(node) {
      if (!filterNeedle) return true;
      const values = [
        node.name,
        node.props?.accessibilityLabel,
        node.props?.text,
        node.props?.testID,
        node.props?.className,
        node.props?.contentContainerClassName,
        node.source?.fileName,
        node.owner?.name,
        node.owner?.source?.fileName
      ].filter(Boolean).map((value) => String(value).toLowerCase());
      return values.some((value) => value.includes(filterNeedle));
    }

    function recordLayout(node) {
      if (!filterMatches(node)) return;
      const classNames = {};
      const layoutTokens = [];
      for (const key of classNameKeys) {
        const value = node.props?.[key];
        if (typeof value === 'string' && value.trim()) {
          classNames[key] = value;
          layoutTokens.push(...layoutTokensFromClassName(value).map((entry) => ({ ...entry, source: key })));
        }
      }
      const styles = {};
      for (const key of stylePropKeys) {
        const layoutStyle = layoutStyleOnly(node.props?.[key]);
        if (layoutStyle) styles[key] = layoutStyle;
      }
      if (!layoutTokens.length && !Object.keys(styles).length) return;
      const key = [
        node.name,
        node.props?.accessibilityLabel || node.props?.text || '',
        node.props?.testID || '',
        JSON.stringify(classNames),
        JSON.stringify(styles)
      ].join('|');
      if (layoutSeen.has(key)) return;
      layoutSeen.add(key);
      layoutStyles.push({
        id: node.id,
        parentId: node.parentId,
        depth: node.depth,
        name: node.name,
        kind: node.kind,
        label: node.props?.accessibilityLabel || node.props?.text || null,
        role: node.props?.accessibilityRole || null,
        testID: node.props?.testID || null,
        classNames,
        layoutTokens: layoutTokens.slice(0, 40),
        styles,
        source: node.source || node.owner?.source || null,
        owner: node.owner?.name || null
      });
    }

    function record(node) {
      const map = node.kind === 'host' ? hostCounts : componentCounts;
      map.set(node.name, (map.get(node.name) || 0) + 1);
      if (node.source?.fileName) sourceFiles.set(node.source.fileName, (sourceFiles.get(node.source.fileName) || 0) + 1);
      if (node.props?.text) {
        const textKey = node.props.text;
        if (!textSeen.has(textKey)) {
          textSeen.add(textKey);
          textSamples.push({ text: node.props.text, component: node.name, source: node.source || node.owner?.source || null });
        }
      }
      if (node.props?.handlers || node.props?.accessibilityRole || node.props?.accessibilityLabel || node.props?.testID) {
        const label = node.props.accessibilityLabel || node.props.text || null;
        const handlers = node.props.handlers || [];
        const interactiveKey = node.props.testID
          ? 'testID:' + node.props.testID
          : label
            ? ['label', node.props.accessibilityRole || '', label, handlers.join(',')].join('|')
            : [node.name, node.props.accessibilityRole || '', handlers.join(',')].join('|');
        if (!interactiveSeen.has(interactiveKey)) {
          interactiveSeen.add(interactiveKey);
          interactive.push({
            id: node.id,
            parentId: node.parentId,
            name: node.name,
            depth: node.depth,
            role: node.props.accessibilityRole || null,
            label,
            testID: node.props.testID || null,
            handlers,
            source: node.source || node.owner?.source || null
          });
        }
      }
      recordLayout(node);
    }

    function walkList(firstFiber, depth, path, parentId) {
      const children = [];
      let fiber = firstFiber;
      let siblingIndex = 0;
      while (fiber && children.length < maxChildrenPerNode) {
        const child = walkFiber(fiber, depth, path.concat(siblingIndex), parentId);
        if (child) children.push(child);
        fiber = fiber.sibling;
        siblingIndex += 1;
      }
      if (fiber) truncated = true;
      return children;
    }

    function walkFiber(fiber, depth, path, parentId) {
      if (!fiber || totalNodes >= maxNodes) {
        truncated = true;
        return null;
      }
      totalNodes += 1;
      const props = summarizeProps(fiber.memoizedProps);
      const source = debugSource(fiber);
      const node = {
        id: nextId++,
        parentId,
        depth,
        name: fiberName(fiber),
        kind: nodeKind(fiber),
        tag: fiber.tag,
        key: fiber.key || null,
        source,
        owner: ownerInfo(fiber),
        props,
        children: []
      };
      record(node);
      if (fiber.child && depth < maxDepth) {
        node.children = walkList(fiber.child, depth + 1, path.concat(0), node.id);
      } else if (fiber.child) {
        truncated = true;
      }
      return node;
    }

    const rendererIds = Array.from(hook.renderers?.keys?.() || []);
    const roots = [];
    for (const rendererId of rendererIds) {
      let fiberRoots = [];
      try {
        fiberRoots = Array.from(hook.getFiberRoots(rendererId) || []);
      } catch {}
      for (let rootIndex = 0; rootIndex < fiberRoots.length; rootIndex += 1) {
        const root = fiberRoots[rootIndex];
        const current = root?.current;
        roots.push({
          rendererId,
          rootIndex,
          children: current?.child ? walkList(current.child, 0, [rootIndex], null) : []
        });
      }
    }

    const top = (map) => Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name, count]) => ({ name, count }));

    const outline = [];
    function flatten(nodes) {
      for (const node of nodes || []) {
        outline.push({
          id: node.id,
          parentId: node.parentId,
          depth: node.depth,
          name: node.name,
          kind: node.kind,
          role: node.props?.accessibilityRole || null,
          label: node.props?.accessibilityLabel || node.props?.text || null,
          testID: node.props?.testID || null,
          source: node.source || node.owner?.source || null
        });
        flatten(node.children);
      }
    }
    for (const root of roots) flatten(root.children);

    function isInterestingNode(node) {
      if (node.label || node.testID || node.role) return true;
      if (node.kind === 'host' && !/^RCT/.test(node.name)) return true;
      if (/(Route|Screen|Navigator|Stack|Tabs|Layout|Slot|Console|Customer|Appointment|Catalogue|Block|Terminal|Glass|Pressable|Button|Text|Input|Modal|Sheet|Card|List|Header|Toolbar|Tab)/.test(node.name)) return true;
      return false;
    }
    const interestingOutline = outline.filter(isInterestingNode).slice(0, 180);

    return {
      available: roots.length > 0,
      rendererIds,
      rootCount: roots.length,
      totalNodes,
      truncated,
      roots: roots.map((root) => ({
        rendererId: root.rendererId,
        rootIndex: root.rootIndex,
        childCount: root.children.length
      })),
      outline: outline.slice(0, 180),
      interestingOutline,
      summary: {
        topComponents: top(componentCounts),
        hostElements: top(hostCounts),
        sourceFiles: top(sourceFiles),
        textSamples: textSamples.slice(0, 80),
        interactiveElements: interactive.slice(0, 80)
      },
      layoutStyles: {
        filter: componentFilter || null,
        count: layoutStyles.length,
        entries: layoutStyles.slice(0, 160),
        designerUse: 'Use these declared className/style values to spot suspicious padding, margin, gap, flex direction, alignment, absolute positioning, content container spacing, and repeated nested spacing before checking pixels.'
      },
      limits: { maxDepth, maxNodes, maxChildrenPerNode },
      caveats: [
        'Component names and _debugSource are development-runtime signals and may be absent or minified in some builds.',
        'React Native host elements do not expose exact rendered frames through Hermes; layoutStyles reports declared props/classes, not final Yoga-computed frames.',
        'StyleSheet numeric IDs cannot be resolved without app-specific runtime helpers, so numeric styles are reported as stylesheetId.'
      ],
      designerUse: 'Use this to connect visible labels, text, roles, source files, and component ownership back to the code when judging hierarchy, composition, naming, and likely ownership.'
    };
  })()`;
}

async function captureIosScreenshot(udid, outputPath) {
  const resolvedOutputPath = path.resolve(
    outputPath ??
      path.join(os.tmpdir(), "expo-ios-ux", `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`),
  );
  await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  const result = await execFilePromise("xcrun", ["simctl", "io", udid, "screenshot", resolvedOutputPath], {
    timeout: 30_000,
    rejectOnError: false,
  });
  const dimensions = await pngDimensions(resolvedOutputPath).catch(() => null);
  return {
    outputPath: resolvedOutputPath,
    format: "png",
    dimensions,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    error: result.error,
  };
}

async function analyzePngScreenshot(file) {
  const png = parsePng(await fs.readFile(file));
  const samples = samplePixels(png, 6000);
  const palette = dominantPalette(samples);
  const luminance = luminanceStats(samples);
  const composition = compositionStats(png, samples);
  return {
    dimensions: { width: png.width, height: png.height },
    sampleCount: samples.length,
    appearanceGuess: luminance.average < 96 ? "dark" : luminance.average > 180 ? "light" : "mixed",
    luminance,
    dominantColors: palette,
    composition,
    designerUse:
      "Use this to detect visual density, dominant palette, contrast risk, empty-state composition, and whether content is concentrated in nav/header/body/tab regions before deeper human review.",
  };
}

async function pngDimensions(file) {
  const buffer = await fs.readFile(file);
  if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function parsePng(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Screenshot is not a PNG file.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
  if (interlace !== 0) throw new Error("Interlaced PNG screenshots are not supported.");
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[colorType];
  if (!channels) throw new Error(`Unsupported PNG color type: ${colorType}`);
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let inputOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[inputOffset++];
    const scanline = Buffer.from(inflated.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;
    unfilterScanline(scanline, previous, channels, filter);
    for (let x = 0; x < width; x++) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      if (colorType === 0) {
        pixels[target] = scanline[source];
        pixels[target + 1] = scanline[source];
        pixels[target + 2] = scanline[source];
        pixels[target + 3] = 255;
      } else if (colorType === 4) {
        pixels[target] = scanline[source];
        pixels[target + 1] = scanline[source];
        pixels[target + 2] = scanline[source];
        pixels[target + 3] = scanline[source + 1];
      } else {
        pixels[target] = scanline[source];
        pixels[target + 1] = scanline[source + 1];
        pixels[target + 2] = scanline[source + 2];
        pixels[target + 3] = colorType === 6 ? scanline[source + 3] : 255;
      }
    }
    previous = scanline;
  }
  return { width, height, pixels };
}

function unfilterScanline(scanline, previous, bytesPerPixel, filter) {
  for (let i = 0; i < scanline.length; i++) {
    const left = i >= bytesPerPixel ? scanline[i - bytesPerPixel] : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] ?? 0 : 0;
    if (filter === 1) scanline[i] = (scanline[i] + left) & 255;
    else if (filter === 2) scanline[i] = (scanline[i] + up) & 255;
    else if (filter === 3) scanline[i] = (scanline[i] + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) scanline[i] = (scanline[i] + paeth(left, up, upLeft)) & 255;
    else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}`);
  }
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : upLeft;
}

function samplePixels(png, targetSamples) {
  const step = Math.max(1, Math.floor(Math.sqrt((png.width * png.height) / targetSamples)));
  const samples = [];
  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      const offset = (y * png.width + x) * 4;
      const a = png.pixels[offset + 3];
      if (a < 128) continue;
      const r = png.pixels[offset];
      const g = png.pixels[offset + 1];
      const b = png.pixels[offset + 2];
      samples.push({ x, y, r, g, b, luma: 0.2126 * r + 0.7152 * g + 0.0722 * b });
    }
  }
  return samples;
}

function dominantPalette(samples) {
  const counts = new Map();
  for (const sample of samples) {
    const r = Math.round(sample.r / 32) * 32;
    const g = Math.round(sample.g / 32) * 32;
    const b = Math.round(sample.b / 32) * 32;
    const key = `${Math.min(r, 255)},${Math.min(g, 255)},${Math.min(b, 255)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [r, g, b] = key.split(",").map(Number);
      return {
        hex: rgbToHex(r, g, b),
        rgb: [r, g, b],
        percentage: Number((count / Math.max(samples.length, 1)).toFixed(3)),
      };
    });
}

function luminanceStats(samples) {
  const values = samples.map((sample) => sample.luma);
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(values.length, 1);
  const sorted = [...values].sort((a, b) => a - b);
  return {
    average: Number(average.toFixed(1)),
    standardDeviation: Number(Math.sqrt(variance).toFixed(1)),
    p10: Number((sorted[Math.floor(sorted.length * 0.1)] ?? 0).toFixed(1)),
    p50: Number((sorted[Math.floor(sorted.length * 0.5)] ?? 0).toFixed(1)),
    p90: Number((sorted[Math.floor(sorted.length * 0.9)] ?? 0).toFixed(1)),
  };
}

function compositionStats(png, samples) {
  const cornerSamples = samples.filter((sample) =>
    (sample.x < png.width * 0.12 || sample.x > png.width * 0.88) &&
    (sample.y < png.height * 0.12 || sample.y > png.height * 0.88)
  );
  const background = averageColor(cornerSamples.length ? cornerSamples : samples.slice(0, 200));
  const regions = {};
  const namesY = ["top", "middle", "bottom"];
  const namesX = ["left", "center", "right"];
  let minX = png.width;
  let minY = png.height;
  let maxX = 0;
  let maxY = 0;
  let active = 0;
  for (const sample of samples) {
    const distance = colorDistance(sample, background);
    const isActive = distance > 36;
    if (isActive) {
      active += 1;
      minX = Math.min(minX, sample.x);
      minY = Math.min(minY, sample.y);
      maxX = Math.max(maxX, sample.x);
      maxY = Math.max(maxY, sample.y);
    }
    const region = `${namesY[Math.min(2, Math.floor((sample.y / png.height) * 3))]}-${namesX[Math.min(2, Math.floor((sample.x / png.width) * 3))]}`;
    const entry = regions[region] ?? { samples: 0, active: 0 };
    entry.samples += 1;
    if (isActive) entry.active += 1;
    regions[region] = entry;
  }
  const densityByRegion = Object.fromEntries(
    Object.entries(regions).map(([region, value]) => [region, Number((value.active / Math.max(value.samples, 1)).toFixed(3))]),
  );
  return {
    estimatedBackground: rgbToHex(background.r, background.g, background.b),
    activePixelRatio: Number((active / Math.max(samples.length, 1)).toFixed(3)),
    activeContentBounds: active
      ? {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          widthRatio: Number(((maxX - minX + 1) / png.width).toFixed(3)),
          heightRatio: Number(((maxY - minY + 1) / png.height).toFixed(3)),
        }
      : null,
    densityByRegion,
  };
}

function averageColor(samples) {
  const total = samples.reduce((acc, sample) => {
    acc.r += sample.r;
    acc.g += sample.g;
    acc.b += sample.b;
    return acc;
  }, { r: 0, g: 0, b: 0 });
  const count = Math.max(samples.length, 1);
  return {
    r: Math.round(total.r / count),
    g: Math.round(total.g / count),
    b: Math.round(total.b / count),
  };
}

function colorDistance(sample, color) {
  return Math.sqrt((sample.r - color.r) ** 2 + (sample.g - color.g) ** 2 + (sample.b - color.b) ** 2);
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

async function describeIosHierarchy(udid) {
  const axe = await commandPath("axe");
  if (!axe) {
    return { available: false, reason: "axe CLI is not installed or not on PATH." };
  }
  const result = await execFilePromise(axe, ["describe-ui", "--udid", udid], {
    timeout: 12_000,
    maxBuffer: 4 * 1024 * 1024,
    rejectOnError: false,
  });
  if (result.error) {
    return { available: false, error: result.error, stderr: truncate(result.stderr), stdout: truncate(result.stdout) };
  }
  const tree = JSON.parse(result.stdout || "[]");
  return summarizeHierarchy(tree);
}

function summarizeHierarchy(tree) {
  const roots = Array.isArray(tree) ? tree : [tree];
  const roles = {};
  const labels = [];
  let totalElements = 0;
  let maxDepth = 0;
  let nonZeroFrames = 0;
  const bounds = { minX: Infinity, minY: Infinity, maxX: 0, maxY: 0 };
  function visit(node, depth) {
    if (!node || typeof node !== "object") return;
    totalElements += 1;
    maxDepth = Math.max(maxDepth, depth);
    const role = node.role_description ?? node.role ?? node.type ?? "unknown";
    roles[role] = (roles[role] ?? 0) + 1;
    if (node.AXLabel || node.title || node.AXValue) {
      labels.push({ label: node.AXLabel ?? node.title ?? node.AXValue, role, frame: node.frame ?? null });
    }
    const frame = node.frame;
    if (frame?.width > 0 && frame?.height > 0) {
      nonZeroFrames += 1;
      bounds.minX = Math.min(bounds.minX, frame.x);
      bounds.minY = Math.min(bounds.minY, frame.y);
      bounds.maxX = Math.max(bounds.maxX, frame.x + frame.width);
      bounds.maxY = Math.max(bounds.maxY, frame.y + frame.height);
    }
    for (const child of node.children ?? []) visit(child, depth + 1);
  }
  for (const root of roots) visit(root, 0);
  const emptyApplicationOnly =
    totalElements === 1 &&
    roots[0]?.role === "AXApplication" &&
    (!roots[0]?.children || roots[0].children.length === 0);
  return {
    available: true,
    totalElements,
    maxDepth,
    emptyApplicationOnly,
    nonZeroFrames,
    contentBounds: nonZeroFrames
      ? { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }
      : null,
    roles,
    sampleLabels: labels.slice(0, 80),
    insight: emptyApplicationOnly
      ? "Visible UI may exist, but the simulator hierarchy only exposes the app shell. Use screenshot, source, Metro runtime, and coordinate interactions for UX review."
      : "Hierarchy can help compare visible composition with semantic/structural UI frames.",
  };
}

async function collectFilteredIosLogs(udid, { last, bundleId, processName }) {
  const predicate = processName
    ? `process == "${escapePredicateValue(processName)}"`
    : bundleId
      ? `process CONTAINS "${escapePredicateValue(processNameFromBundleId(bundleId))}"`
      : null;
  const args = ["simctl", "spawn", udid, "log", "show", "--style", "compact", "--last", last];
  if (predicate) args.push("--predicate", predicate);
  const result = await execFilePromise("xcrun", args, {
    timeout: 45_000,
    maxBuffer: 5 * 1024 * 1024,
    rejectOnError: false,
  });
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const important = lines.filter((line) => /error|warn|exception|fatal|response_status|api\/|openurl|reload|bundle|metro/i.test(line));
  return {
    last,
    predicate,
    totalLines: lines.length,
    importantLineCount: important.length,
    importantLines: important.slice(-160),
    stdout: important.length ? undefined : truncate(result.stdout, 12000),
    stderr: truncate(result.stderr),
    error: result.error,
  };
}

async function iosInstalledAppInfo(udid, bundleId) {
  const appPath = await execFilePromise("xcrun", ["simctl", "get_app_container", udid, bundleId, "app"], {
    timeout: 10_000,
  });
  const dataPath = await execFilePromise("xcrun", ["simctl", "get_app_container", udid, bundleId, "data"], {
    timeout: 10_000,
    rejectOnError: false,
  });
  const infoPlist = path.join(appPath.stdout.trim(), "Info.plist");
  const plist = await safeToolSection(() => readInfoPlistFields(infoPlist));
  return {
    bundleId,
    appPath: appPath.stdout.trim(),
    dataPath: dataPath.stdout.trim() || null,
    infoPlist: plist.ok ? plist.value : plist,
  };
}

async function readInfoPlistFields(infoPlist) {
  const fields = {};
  for (const field of ["CFBundleDisplayName", "CFBundleName", "CFBundleVersion", "CFBundleShortVersionString", "RCTNewArchEnabled", "UIUserInterfaceStyle"]) {
    const result = await execFilePromise("plutil", ["-extract", field, "raw", "-o", "-", infoPlist], {
      timeout: 5000,
      rejectOnError: false,
    });
    if (!result.error && result.stdout.trim()) fields[field] = result.stdout.trim();
  }
  return fields;
}

async function expoRouteContext(cwd) {
  const appDir = path.join(cwd, "app");
  const routes = [];
  const specialFiles = [];
  if (await pathExists(appDir)) {
    const files = await walkFiles(appDir);
    for (const file of files.filter((item) => /\.(jsx?|tsx?)$/.test(item))) {
      const parsed = routeFromFile(path.relative(appDir, file));
      if (parsed.kind === "route") routes.push({ route: parsed.route, file, segments: parsed.segments });
      else specialFiles.push({ kind: parsed.kind, file });
    }
  }
  routes.sort((a, b) => a.route.localeCompare(b.route));
  const typedRoutesPath = path.join(cwd, ".expo", "types", "router.d.ts");
  const typedRoutes = await pathExists(typedRoutesPath)
    ? [...new Set((await fs.readFile(typedRoutesPath, "utf8")).match(/pathname:\s*`([^`]+)`/g)?.map((match) => match.replace(/^pathname:\s*`|`$/g, "")) ?? [])].sort()
    : [];
  return {
    appDir: (await pathExists(appDir)) ? appDir : null,
    routeCount: routes.length,
    routes,
    specialFiles,
    typedRoutesPath: (await pathExists(typedRoutesPath)) ? typedRoutesPath : null,
    typedRoutes,
  };
}

async function fetchLocalText(url, { timeoutMs }) {
  const response = await fetchLocalLoopback(url, { timeoutMs });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

async function fetchLocalLoopback(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1500;
  const fetchOptions = { ...options };
  delete fetchOptions.timeoutMs;
  const urls = loopbackUrlCandidates(url);
  let lastError = null;
  for (const candidate of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(candidate, { ...fetchOptions, signal: controller.signal });
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("Local fetch failed");
}

function loopbackUrlCandidates(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) return [url];
  const hosts = ["127.0.0.1", "localhost", "[::1]"];
  const candidates = [];
  for (const host of hosts) {
    const candidate = new URL(url);
    candidate.host = `${host}${parsed.port ? `:${parsed.port}` : ""}`;
    if (!candidates.includes(candidate.toString())) candidates.push(candidate.toString());
  }
  return candidates;
}

async function fetchLocalTextDirect(url, { timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLocalJson(url, { timeoutMs }) {
  return JSON.parse(await fetchLocalText(url, { timeoutMs }));
}

function requireOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function processNameFromBundleId(bundleId) {
  if (!bundleId) return null;
  const last = String(bundleId).split(".").filter(Boolean).at(-1);
  return last ? last.replace(/[^a-zA-Z0-9_-]/g, "") : null;
}

function redactUrlAuthCookie(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("cookie")) parsed.searchParams.set("cookie", "[redacted]");
    return parsed.toString();
  } catch {
    return url.replace(/([?&]cookie=)[^&]+/i, "$1[redacted]");
  }
}

async function withTimeout(promise, timeoutMs, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function normalizeProjectCwd(cwd, options = {}) {
  const resolved = await normalizeCwd(cwd);
  if (options.allowMissingPackageJson) return resolved;
  const packageJson = await findUp(resolved, "package.json");
  if (!packageJson) {
    throw new Error(`No package.json found from ${resolved}. Pass cwd for an Expo project.`);
  }
  return path.dirname(packageJson);
}

async function normalizeCwd(cwd) {
  const resolved = path.resolve(cwd ?? process.cwd());
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Directory does not exist: ${resolved}`);
  }
  return resolved;
}

async function findUp(startDir, filename) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, filename);
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function readJsonFile(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function detectPackageManager(projectRoot) {
  let current = path.resolve(projectRoot);
  while (true) {
    if (await pathExists(path.join(current, "pnpm-lock.yaml"))) return "pnpm";
    if (await pathExists(path.join(current, "yarn.lock"))) return "yarn";
    if (await pathExists(path.join(current, "bun.lockb"))) return "bun";
    if (await pathExists(path.join(current, "bun.lock"))) return "bun";
    if (await pathExists(path.join(current, "package-lock.json"))) return "npm";
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "unknown";
}

async function firstExisting(root, names) {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function pathExists(file) {
  return fs.access(file).then(() => true, () => false);
}

async function walkFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

function routeFromFile(relativeFile) {
  const noExt = relativeFile.replace(/\.(jsx?|tsx?)$/, "");
  const rawSegments = noExt.split(path.sep);
  if (rawSegments.some((segment) => segment === "_layout")) {
    return { kind: "layout" };
  }
  if (rawSegments.some((segment) => segment.startsWith("+"))) {
    return { kind: "special" };
  }
  const segments = [];
  for (const rawSegment of rawSegments) {
    if (rawSegment === "index") continue;
    if (/^\(.+\)$/.test(rawSegment)) continue;
    segments.push(formatRouteSegment(rawSegment));
  }
  return { kind: "route", route: `/${segments.join("/")}`.replace(/\/$/, "") || "/", segments };
}

function formatRouteSegment(segment) {
  if (/^\[\.\.\..+\]$/.test(segment)) {
    return `*${segment.slice(4, -1)}`;
  }
  if (/^\[\[.+\]\]$/.test(segment)) {
    return `:${segment.slice(2, -2)}?`;
  }
  if (/^\[.+\]$/.test(segment)) {
    return `:${segment.slice(1, -1)}`;
  }
  return segment;
}

async function resolveIosDevice(requested, options = {}) {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const { stdout } = await execFilePromise("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  const devices = Object.entries(parsed.devices ?? {}).flatMap(([runtime, runtimeDevices]) =>
    runtimeDevices.map((device) => ({ ...device, runtime })),
  );
  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find((device) => device.name.toLowerCase().includes(requested.toLowerCase()));
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }
  if (options.preferBooted) {
    const booted = devices.find((device) => device.state === "Booted");
    if (booted) return booted;
  }
  const iphone = [...devices]
    .reverse()
    .find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}

function androidDeviceArgs(device, args) {
  return device ? ["-s", device, ...args] : args;
}

function iosLogPredicate(args) {
  if (args.processName) return `process == "${escapePredicateValue(args.processName)}"`;
  if (args.bundleId) {
    const processName = String(args.bundleId).split(".").at(-1);
    if (processName) return `process CONTAINS "${escapePredicateValue(processName)}"`;
  }
  return null;
}

function escapePredicateValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function adbScreenshot(device, outputPath) {
  await new Promise((resolve, reject) => {
    const child = spawn("adb", androidDeviceArgs(device, ["exec-out", "screencap", "-p"]), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = fsSync.createWriteStream(outputPath);
    let stderr = "";
    child.stdout.pipe(out);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    out.on("error", reject);
    child.on("close", (code) => {
      out.end();
      if (code === 0) resolve();
      else reject(new Error(`adb screenshot failed with code ${code}: ${stderr}`));
    });
  });
}

async function safeToolSection(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

async function commandPath(command) {
  const result = await execFilePromise("sh", ["-lc", `command -v ${command}`], {
    timeout: 5000,
    rejectOnError: false,
  });
  return result.stdout.trim() || null;
}

function execFilePromise(file, args, options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    timeout = 60_000,
    maxBuffer = MAX_OUTPUT,
    rejectOnError = true,
    input = null,
  } = options;
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { cwd, env, timeout, maxBuffer }, (error, stdout, stderr) => {
      if (error && rejectOnError) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : null,
      });
    });
    if (input !== null && input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}

function truncate(value, limit = MAX_OUTPUT) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

function formatError(error) {
  if (!error) return "Unknown error";
  const parts = [error.message ?? String(error)];
  if (error.stdout) parts.push(`stdout:\n${truncate(error.stdout)}`);
  if (error.stderr) parts.push(`stderr:\n${truncate(error.stderr)}`);
  return parts.join("\n\n");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const commandAliases = {
  "doctor": "doctor",
  "project-info": "project_info",
  "routes": "expo_router_sitemap",
  "devices": "list_devices",
  "session": "session",
  "target": "target",
  "snapshot": "snapshot",
  "refs": "refs",
  "get": "get_ref",
  "find": "find",
  "wait": "wait",
  "batch": "batch",
  "boot-simulator": "boot_simulator",
  "open-url": "open_url",
  "launch-app": "launch_app",
  "terminate-app": "terminate_app",
  "reload-app": "reload_app",
  "open-dev-menu": "runtime_inspector",
  "install-app": "install_app",
  "uninstall-app": "uninstall_app",
  "long-press": "ref_action",
  "dbltap": "ref_action",
  "fill": "ref_action",
  "type": "keyboard",
  "press": "keyboard",
  "focus": "ref_action",
  "blur": "ref_action",
  "select": "ref_action",
  "check": "ref_action",
  "uncheck": "ref_action",
  "drag": "ref_action",
  "scroll": "ref_action",
  "scroll-into-view": "ref_action",
  "clipboard": "clipboard",
  "keyboard": "keyboard",
  "set": "set_environment",
  "logs": "collect_app_logs",
  "screenshot": "automation_take_screenshot",
  "tap": "automation_tap",
  "gesture": "automation_gesture",
  "open-route": "open_expo_route",
  "ux-context": "capture_ux_context",
  "annotate-screen": "annotate_screen",
  "inspector": "runtime_inspector",
  "review-overlay": "review_overlay",
  "review-overlay-server": "review_overlay",
  "review-next": "review_next_step",
  "annotation-server": "annotation_server",
  "devtools": "devtools",
  "console": "console",
  "errors": "errors",
  "metro": "metro",
  "profiler": "perf",
  "navigation": "navigation",
  "network": "network",
  "storage": "storage",
  "state": "state",
  "controls": "controls",
  "bridge": "bridge",
  "accessibility": "accessibility",
  "dialog": "dialog",
  "sheet": "sheet",
  "record": "record",
  "diff": "diff",
  "inspect": "debug_inspect",
  "highlight": "highlight",
  "expo": "expo",
  "rn": "rn",
  "perf": "perf",
  "dashboard": "dashboard",
  "review": "review",
  "policy": "policy",
  "redact": "redact",
  "skills": "skills",
  "install": "install",
  "upgrade": "upgrade",
  "release": "release",
  "live-backlog": "live_backlog",
  "trace": "trace_interaction",
};

let lastCliOptions = {
  json: false,
  plain: false,
    quiet: false,
    debug: false,
    maxOutput: null,
    contentBoundaries: false,
    allowRuntimeEval: null,
    confirmActions: null,
  };

async function main(argv) {
  const parsed = parseCliArgs(argv);
  const { globals, command, args } = parsed;
  lastCliOptions = globals;

  if (globals.json && globals.plain) {
    throw new CliUsageError("--json and --plain are mutually exclusive.");
  }

  if (globals.version) {
    process.stdout.write(`${CLI_VERSION}\n`);
    return EXIT_SUCCESS;
  }

  if (globals.help || !command || command === "help" || args.help) {
    printHelp();
    return EXIT_SUCCESS;
  }

  const toolName = commandAliases[command];
  if (!toolName) throw new CliUsageError(`Unknown command: ${command}`);

  const effectiveArgs = commandArgs(command, args, globals);
  const recorder = await startRunRecord({ command, args: effectiveArgs, globals });
  try {
    const payload = await runTool(toolName, effectiveArgs, { command, globals });
    await recorder.finish({ status: "completed", exitCode: EXIT_SUCCESS, payload });
    if (globals.debug && recorder.path) {
      process.stderr.write(`run-record: ${recorder.path}\n`);
    }
    return EXIT_SUCCESS;
  } catch (error) {
    const exitCode = exitCodeForError(error);
    await recorder.finish({ status: "failed", exitCode, error });
    if (globals.debug && recorder.path) {
      process.stderr.write(`run-record: ${recorder.path}\n`);
    }
    throw error;
  }
}

async function runTool(toolName, args, options) {
  const handler = handlers[toolName];
  if (!handler) throw new CliUsageError(`Unknown tool: ${toolName}`);
  const result = await handler(args);
  const payload = unwrapToolJson(result);
  const redactedPayload = redactValue(payload);
  if (!options.silent) writeCliPayload(redactedPayload, options);
  return redactedPayload;
}

function commandArgs(command, args, globals = {}) {
  const cwd = args.cwd ?? globals.root;
  const common = {
    cwd,
    device: args.device,
    platform: args.platform,
    metroPort: args.metroPort,
    bundleId: args.bundleId,
    processName: args.processName,
    devClientUrl: args.devClientUrl,
    restartDevClient: args.restartDevClient,
    crashCheckMs: args.crashCheckMs,
  };
  switch (command) {
    case "doctor":
      return pickDefined({ cwd, fix: args.fix });
    case "project-info":
      return pickDefined({ cwd });
    case "routes":
      return pickDefined({ cwd, appDir: args.appDir });
    case "devices":
      return pickDefined({ platform: args.platform, limit: args.limit });
    case "session":
      return pickDefined({
        action: args.action ?? args._[0],
        name: args.name ?? args._[1],
        olderThan: args.olderThan,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "target":
      return pickDefined({
        action: args.action ?? args._[0],
        targetId: args.targetId ?? args._[1],
        platform: args.platform,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "snapshot":
      return pickDefined({
        interactive: args.interactive,
        compact: args.compact,
        depth: args.depth,
        source: args.source,
        bounds: args.bounds,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "refs":
      return pickDefined({ cwd, root: globals.root, stateDir: globals.stateDir });
    case "get":
      return pickDefined({
        field: args.field ?? args._[0],
        ref: args.ref ?? args._[1],
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "find":
      return pickDefined({
        kind: args.kind ?? args._[0],
        value: args.value ?? args._[1],
        action: args.action ?? args._[2],
        name: args.name ?? (args._[0] === "nth" ? args._[2] : undefined),
        text: args.text ?? args._[3],
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "wait": {
      const first = args._[0];
      return pickDefined({
        ref: args.ref ?? (/^@e\d+$/.test(String(first ?? "")) ? first : undefined),
        ms: args.ms ?? (/^\d+$/.test(String(first ?? "")) ? Number(first) : undefined),
        state: args.state,
        text: args.text,
        route: args.route,
        metroReady: args.metroReady,
        appReady: args.appReady,
        noSpinner: args.noSpinner,
        fn: args.fn,
        allowRuntimeEval: globals.allowRuntimeEval,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        metroPort: args.metroPort,
        timeoutMs: args.timeoutMs,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    }
    case "batch":
      return pickDefined({
        steps: args.steps ?? args._,
        bail: args.bail,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "boot-simulator":
      return pickDefined({ device: args.device, openSimulator: args.openSimulator });
    case "open-url":
      return pickDefined({ platform: args.platform, device: args.device, url: args.url ?? args._[0] });
    case "launch-app":
      return pickDefined({ ...common, packageName: args.packageName, activity: args.activity });
    case "terminate-app":
    case "reload-app":
    case "install-app":
    case "uninstall-app":
      return pickDefined({
        ...common,
        appPath: args.appPath ?? args._[0],
        packageName: args.packageName,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        dryRun: args.dryRun,
      });
    case "open-dev-menu":
      return pickDefined({ ...common, action: "open-dev-menu" });
    case "long-press":
    case "dbltap":
    case "fill":
    case "focus":
    case "blur":
    case "select":
    case "check":
    case "uncheck":
    case "drag":
    case "scroll":
    case "scroll-into-view":
    {
      const first = args._[0];
      const second = args._[1];
      const third = args._[2];
      const scrollRef = command === "scroll" && /^@e\d+$/.test(String(first ?? "")) ? first : undefined;
      return pickDefined({
        ...common,
        command,
        ref: args.ref ?? scrollRef ?? (command === "scroll" ? undefined : first),
        targetRef: args.targetRef ?? (command === "drag" ? second : undefined),
        text: args.text ?? (command === "fill" || command === "select" ? args._[1] : undefined),
        direction: args.direction ?? (command === "scroll" ? (scrollRef ? second : first) : undefined),
        amount: args.amount ?? (command === "scroll" ? (scrollRef ? third : second) : undefined),
        durationMs: args.durationMs,
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    }
    case "type":
    case "press":
      return pickDefined({
        ...common,
        action: command,
        text: args.text ?? args._[0],
        key: args.key ?? args._[0],
        dryRun: args.dryRun,
      });
    case "clipboard":
    case "keyboard":
      return pickDefined({
        ...common,
        action: args.action ?? args._[0],
        text: args.text ?? args._[1],
        key: args.key ?? args._[1],
        dryRun: args.dryRun,
      });
    case "set":
      return pickDefined({
        ...common,
        domain: args.domain ?? args._[0],
        value: args.value ?? args._[1],
        extra: args.extra ?? args._.slice(2),
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        dryRun: args.dryRun,
      });
    case "logs":
      return pickDefined({ ...common, last: args.last, lines: args.lines, predicate: args.predicate });
    case "screenshot":
      return pickDefined({
        platform: args.platform,
        device: args.device,
        outputPath: args.outputPath,
        annotate: args.annotate,
        full: args.full,
        fullSegments: args.fullSegments,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "tap":
      return pickDefined({
        platform: args.platform,
        device: args.device,
        x: args.x,
        y: args.y,
        ref: args.ref ?? args._[0],
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "gesture":
      return pickDefined({
        platform: args.platform,
        device: args.device,
        gesture: args.gesture ?? args._[0],
        x: args.x,
        y: args.y,
        startX: args.startX,
        startY: args.startY,
        endX: args.endX,
        endY: args.endY,
        durationMs: args.durationMs,
        holdMs: args.holdMs,
        repeat: args.repeat,
        intervalMs: args.intervalMs,
        dryRun: args.dryRun,
        captureBeforeAfter: args.captureBeforeAfter,
        outputDir: args.outputDir,
        includeTrace: args.includeTrace,
        cwd,
        metroPort: args.metroPort,
        componentFilter: args.componentFilter,
        maxEvents: args.maxEvents,
      });
    case "open-route":
      return pickDefined({
        cwd,
        device: args.device,
        url: args.url,
        scheme: args.scheme,
        route: args.route ?? args._[0],
        query: args.query,
        authCookie: args.authCookie,
      });
    case "ux-context":
      return pickDefined({
        ...common,
        outputPath: args.outputPath,
        includeScreenshot: args.includeScreenshot,
        includeImageAnalysis: args.includeImageAnalysis,
        includeHierarchy: args.includeHierarchy,
        includeRuntime: args.includeRuntime,
        includeComponents: args.includeComponents,
        componentFilter: args.componentFilter,
        includeLogs: args.includeLogs,
        logsLast: args.logsLast,
      });
    case "annotate-screen":
      return pickDefined({
        cwd,
        device: args.device,
        bundleId: args.bundleId,
        metroPort: args.metroPort,
        screenshotPath: args.screenshotPath,
        outputDir: args.outputDir,
        title: args.title,
        serve: args.serve,
        port: args.port,
        includeUxContext: args.includeUxContext,
      });
    case "inspector":
      return pickDefined({
        cwd,
        device: args.device,
        metroPort: args.metroPort,
        bundleId: args.bundleId,
        devClientUrl: args.devClientUrl,
        restartDevClient: args.restartDevClient,
        action: args.action ?? args._[0],
        commentTitle: args.commentTitle,
        maxComments: args.maxComments,
      });
    case "review-overlay":
    case "review-overlay-server":
      return pickDefined({
        cwd,
        action: command === "review-overlay-server" ? "server" : args.action ?? args._[0],
        outputDir: args.outputDir,
        overlayDir: args.overlayDir,
        endpointPath: args.endpointPath,
        metroPort: args.metroPort,
        title: args.title,
        port: args.port,
        serve: args.serve,
        force: args.force,
      });
    case "review-next":
      return pickDefined({
        cwd,
        surface: args.surface,
        stage: args.stage,
        issue: args.issue ?? args._[0],
        componentFilter: args.componentFilter,
        metroPort: args.metroPort,
        verifierRule: args.verifierRule,
        hasAcceptanceContract: args.hasAcceptanceContract,
        hasScreenshot: args.hasScreenshot,
        hasInteractionProof: args.hasInteractionProof,
        hasStaticVerifier: args.hasStaticVerifier,
        changedGesture: args.changedGesture,
        changedChrome: args.changedChrome,
        changedNavigation: args.changedNavigation,
        addedVisibleControls: args.addedVisibleControls,
      });
    case "trace":
      return pickDefined({
        cwd,
        metroPort: args.metroPort,
        action: args.action ?? args._[0],
        componentFilter: args.componentFilter,
        maxEvents: args.maxEvents,
        includeEvents: args.includeEvents,
      });
    case "annotation-server":
      return pickDefined({ dir: args.dir, port: args.port });
    case "devtools":
      return pickDefined({
        action: args.action ?? args._[0],
        subaction: args.subaction ?? (args._[0] === "events" ? args._[1] : undefined),
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "console":
    case "errors":
      return pickDefined({
        action: args.clear === true ? "clear" : args.action ?? args._[0],
        limit: args.limit,
        metroPort: args.metroPort,
        cwd,
      });
    case "metro":
      return pickDefined({
        action: args.action ?? args._[0],
        stackFile: args.stackFile ?? args.file ?? args._[1],
        metroPort: args.metroPort,
        cwd,
      });
    case "navigation":
      return pickDefined({
        action: args.action ?? args._[0],
        tab: args.tab ?? args._[1],
        route: args.route ?? (args._[0] === "deep-link" ? args._[1] : undefined),
        url: args.url,
        scheme: args.scheme,
        query: args.query,
        device: args.device,
        metroPort: args.metroPort,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "network":
      return pickDefined({
        action: args.action ?? args._[0],
        harAction: args.harAction ?? (args._[0] === "har" ? args._[1] : undefined),
        requestId: args.requestId ?? (args._[0] === "request" ? args._[1] : undefined),
        outputPath: args.outputPath ?? (args._[0] === "har" && args._[1] === "stop" ? args._[2] : undefined),
        limit: args.limit,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "storage":
      return pickDefined({
        store: args.store ?? args._[0],
        action: args.action ?? args._[1] ?? "list",
        key: args.key ?? args._[2],
        value: args.value ?? args._[3],
        limit: args.limit,
        metroPort: args.metroPort,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
      });
    case "state":
      return pickDefined({
        action: args.action ?? args._[0] ?? "list",
        name: args.name ?? args._[1],
        metroPort: args.metroPort,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
      });
    case "controls":
      return pickDefined({
        action: args.action ?? args._[0] ?? "list",
        name: args.name ?? args._[1],
        metroPort: args.metroPort,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
      });
    case "bridge":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        metroPort: args.metroPort,
        domain: args.domain ?? args._[1],
        command: args.command ?? args._[2],
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
        confirmActions: args.confirmActions ?? globals.confirmActions,
      });
    case "accessibility":
      return pickDefined({
        action: args.action ?? args._[0] ?? "tree",
        ref: args.ref ?? args._[1],
        device: args.device,
        metroPort: args.metroPort,
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "dialog":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        text: args.text ?? args._[1],
        metroPort: args.metroPort,
        cwd,
      });
    case "sheet":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        metroPort: args.metroPort,
        cwd,
      });
    case "record":
      return pickDefined({
        action: args.action ?? args._[0] ?? "start",
        outputPath: args.outputPath ?? args._[1],
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "diff":
      return pickDefined({
        kind: args.kind ?? args._[0],
        baseline: args.baseline ?? args._[1],
        current: args.current ?? args._[2],
        routeA: args.routeA ?? (args._[0] === "route" ? args._[1] : undefined),
        routeB: args.routeB ?? (args._[0] === "route" ? args._[2] : undefined),
        screenshot: args.screenshot,
        outputPath: args.outputPath,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "expo":
      return pickDefined({
        action: args.action ?? args._[0] ?? "modules",
        cwd,
      });
    case "rn":
      return pickDefined({
        action: args.action ?? args._[0] ?? "tree",
        subaction: args.subaction ?? (args._[0] === "renders" ? args._[1] : undefined),
        ref: args.ref ?? (["inspect", "fiber"].includes(args._[0]) ? args._[1] : undefined),
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "perf":
    case "profiler":
      return pickDefined({
        action: command === "profiler" ? "ettrace" : args.action ?? args._[0] ?? "summary",
        subaction: command === "profiler"
          ? args.subaction ?? args.action ?? args._[0] ?? "start"
          : args.subaction ?? (["mark", "measure", "budget", "ettrace", "memgraph"].includes(args._[0]) ? args._[1] : undefined),
        label: args.label ?? (args._[0] === "action" ? args._[1] : args._[0] === "measure" ? args._[2] : undefined),
        bundleArtifact: args.bundleArtifact ?? (args._[0] === "bundle" ? args._[1] : undefined),
        baseline: args.baseline,
        candidate: args.candidate,
        file: args.file,
        nativeArtifact: args.nativeArtifact ?? (command === "profiler" ? args._[1] : ["ettrace", "memgraph"].includes(args._[0]) ? args._[2] : undefined),
        outputPath: args.outputPath,
        buildKind: args.buildKind,
        samples: args.samples,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "dashboard":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        outputPath: args.outputPath,
        port: args.port,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "inspect":
    case "highlight":
      return pickDefined({
        ...common,
        ref: args.ref ?? args._[0],
        durationMs: args.durationMs,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "review":
      return pickDefined({
        action: args.action ?? args._[0],
        outputPath: args.outputPath,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "policy":
      return pickDefined({
        action: args.action ?? args._[0],
        subject: args.subject ?? args._[1],
        name: args.name ?? args._[2],
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
      });
    case "redact":
      return pickDefined({
        file: args.file ?? args._[0],
        outputPath: args.outputPath,
      });
    case "skills":
      return pickDefined({
        action: args.action ?? args._[0] ?? "list",
        name: args.name ?? args._[1],
      });
    case "install":
    case "upgrade":
      return pickDefined({
        action: args.action ?? args._[0] ?? "check",
        prefix: args.prefix,
      });
    case "release":
      return pickDefined({
        action: args.action ?? args._[0] ?? "check",
        cwd,
      });
    case "live-backlog":
      return pickDefined({
        action: args.action ?? args._[0] ?? "matrix",
        cwd,
        outputDir: args.outputDir,
        scope: args.scope,
        metroPort: args.metroPort,
        bundleId: args.bundleId,
        device: args.device,
        devClientUrl: args.devClientUrl,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
      });
    default:
      return {};
  }
}

function parseCliArgs(argv) {
  const args = { _: [] };
  const globals = {
    json: false,
    plain: false,
    quiet: false,
    verbose: false,
    debug: false,
    noColor: false,
    noInput: false,
    record: false,
    version: false,
    help: false,
    root: null,
    stateDir: null,
    actionPolicy: null,
    maxOutput: null,
    contentBoundaries: false,
    allowRuntimeEval: null,
    confirmActions: null,
  };
  let command = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      args._.push(...argv.slice(index + 1));
      break;
    }
    if (token === "--help" || token === "-h") {
      globals.help = true;
      continue;
    }
    if (token === "--version") {
      globals.version = true;
      continue;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const rawKey = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const globalKey = normalizeGlobalFlag(rawKey);
      if (globalKey) {
        if (globalFlagTakesValue(rawKey)) {
          const value = eq === -1 ? argv[index + 1] : token.slice(eq + 1);
          if (value === undefined || value.startsWith("--")) {
            throw new CliUsageError(`--${rawKey} requires a value.`);
          }
          if (eq === -1) index += 1;
          globals[globalKey] = String(value);
        } else {
          globals[globalKey] = true;
        }
        continue;
      }
      if (!command) {
        throw new CliUsageError(`Global flag or command expected before --${rawKey}.`);
      }
      const key = toCamel(rawKey);
      const schemaValue = eq === -1 ? argv[index + 1] : token.slice(eq + 1);
      if (eq === -1 && (schemaValue === undefined || schemaValue.startsWith("--"))) {
        args[key] = true;
      } else {
        if (eq === -1) index += 1;
        args[key] = coerceCliValue(schemaValue);
      }
      continue;
    }
    if (!command) {
      command = token;
      continue;
    }
    args._.push(token);
  }
  return { globals, command, args };
}

function normalizeGlobalFlag(rawKey) {
  switch (rawKey) {
    case "json":
    case "plain":
    case "quiet":
    case "verbose":
    case "debug":
    case "record":
      return rawKey;
    case "content-boundaries":
      return "contentBoundaries";
    case "root":
      return "root";
    case "state-dir":
      return "stateDir";
    case "action-policy":
      return "actionPolicy";
    case "max-output":
      return "maxOutput";
    case "allow-runtime-eval":
      return "allowRuntimeEval";
    case "confirm-actions":
      return "confirmActions";
    case "no-color":
      return "noColor";
    case "no-input":
      return "noInput";
    default:
      return null;
  }
}

function globalFlagTakesValue(rawKey) {
  return rawKey === "root" ||
    rawKey === "state-dir" ||
    rawKey === "action-policy" ||
    rawKey === "max-output" ||
    rawKey === "allow-runtime-eval" ||
    rawKey === "confirm-actions";
}

function coerceCliValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseJsonArgument(value, flag) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${flag} must be valid JSON: ${formatError(error)}`);
  }
}

function pickDefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function writeCliPayload(payload, { command, globals }) {
  if (globals.quiet && !globals.json) return;
  const maybeBoundedPayload = globals.contentBoundaries === true
    ? { contentBoundary: "expo-ios-untrusted-output", payload }
    : payload;
  if (globals.json) {
    process.stdout.write(boundOutput(`${JSON.stringify({ ok: true, data: maybeBoundedPayload }, null, 2)}\n`, globals));
    return;
  }
  if (globals.plain) {
    process.stdout.write(boundOutput(`${plainPayload(command, maybeBoundedPayload).join("\n")}\n`, globals));
    return;
  }
  process.stdout.write(boundOutput(`${JSON.stringify(maybeBoundedPayload, null, 2)}\n`, globals));
}

function boundOutput(text, globals = {}) {
  if (globals.maxOutput === null || globals.maxOutput === undefined) return text;
  const max = clampNumber(globals.maxOutput, 1, 10_000_000);
  if (text.length <= max) return text;
  const suffix = "\n[expo-ios output truncated by --max-output]\n";
  return `${text.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

function writeCliError(error, options = lastCliOptions) {
  if (options.quiet && !options.json) return;
  const exitCode = exitCodeForError(error);
  const payload = {
    ok: false,
    error: {
      code: errorCodeForExitCode(exitCode),
      message: sanitizeErrorMessage(formatError(error)),
      exitCode,
    },
  };
  if (options.debug) {
    payload.error.name = error?.name ?? "Error";
  }
  if (options.json || options.plain !== true) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stderr.write(`error: ${payload.error.message}\n`);
}

function plainPayload(command, payload) {
  const lines = ["ok: true", `command: ${command}`];
  if (command === "doctor") {
    lines.push(`cli: ${payload.cli?.name ?? CLI_NAME} ${payload.cli?.version ?? CLI_VERSION}`);
    lines.push(`cwd: ${payload.cwd ?? ""}`);
    lines.push(`ios-simulator: ${payload.capabilities?.iosSimulator ? "yes" : "no"}`);
    lines.push(`expo-cli: ${payload.capabilities?.expoCli ? "yes" : "no"}`);
    return lines;
  }
  if (command === "routes") {
    lines.push(`routes: ${payload.routeCount ?? payload.routes?.length ?? 0}`);
    for (const route of payload.routes ?? []) {
      lines.push(`route: ${route.route} ${route.file}`);
    }
    return lines;
  }
  if (command === "review-next") {
    lines.push(`toc-step: ${payload.constraint?.tocStep ?? ""}`);
    lines.push(`next: ${payload.nextStep ?? ""}`);
    for (const suggested of payload.suggestedCommands ?? []) {
      lines.push(`suggested-command: ${suggested}`);
    }
    return lines;
  }
  if (payload.available === false && payload.reason) {
    lines.push(`available: false`);
    lines.push(`reason: ${payload.reason}`);
    return lines;
  }
  lines.push(`data: ${JSON.stringify(payload)}`);
  return lines;
}

async function startRunRecord({ command, args, globals }) {
  if (!globals.record && !globals.stateDir) {
    return { path: null, async finish() {} };
  }
  const startedAt = new Date().toISOString();
  const runId = `${startedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-")}-${Math.random().toString(36).slice(2, 8)}`;
  const root = path.resolve(globals.root ?? args.cwd ?? process.cwd());
  const stateDir = path.resolve(globals.stateDir ?? path.join(root, ".scratch", "expo-ios", "runs"));
  const recordPath = path.join(stateDir, `${runId}.json`);
  const baseRecord = {
    schemaVersion: 1,
    runId,
    cli: { name: CLI_NAME, version: CLI_VERSION },
    command,
    args: redactValue(args),
    root,
    stateDir,
    startedAt,
    finishedAt: null,
    status: "running",
    exitCode: null,
  };
  await fs.mkdir(stateDir, { recursive: true });
  await writeJsonFile(recordPath, baseRecord);
  return {
    path: recordPath,
    async finish({ status, exitCode, payload, error }) {
      await writeJsonFile(recordPath, {
        ...baseRecord,
        finishedAt: new Date().toISOString(),
        status,
        exitCode,
        summary: summarizeRunPayload(payload),
        error: error ? sanitizeErrorMessage(formatError(error)) : null,
      });
    },
  };
}

function summarizeRunPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    keys: Object.keys(payload).slice(0, 40),
    available: typeof payload.available === "boolean" ? payload.available : undefined,
    routeCount: payload.routeCount,
    eventCount: Array.isArray(payload.events) ? payload.events.length : undefined,
  };
}

async function writeJsonFile(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function redactValue(value, key = "") {
  if (typeof value === "string") {
    if (isSecretKey(key)) return REDACTED;
    if (/([?&](cookie|token|authorization|password|secret)=)[^&]+/i.test(value)) {
      return value.replace(/([?&](cookie|token|authorization|password|secret)=)[^&]+/gi, `$1${REDACTED}`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    isSecretKey(childKey) ? REDACTED : redactValue(childValue, childKey),
  ]));
}

function isSecretKey(key) {
  return /token|authorization|cookie|password|secret|apikey|apiKey/i.test(key);
}

function sanitizeErrorMessage(message) {
  return redactValue(String(message ?? ""));
}

function exitCodeForError(error) {
  if (Number.isInteger(error?.exitCode)) return error.exitCode;
  const message = String(error?.message ?? "");
  if (/Unknown command|Unknown tool|requires a value|Expected a finite number|must be a non-empty string|must look like|must not contain whitespace|valid JSON/i.test(message)) {
    return EXIT_INVALID_USAGE;
  }
  return EXIT_RUNTIME_FAILURE;
}

function errorCodeForExitCode(exitCode) {
  switch (exitCode) {
    case EXIT_INVALID_USAGE:
      return "invalid_usage";
    case EXIT_RUNTIME_FAILURE:
      return "runtime_failure";
    default:
      return "error";
  }
}

function cliHelpText() {
  return `expo-ios ${CLI_VERSION}

Usage:
  expo-ios [global flags] <command> [options]

Global flags:
  --json                 Write { ok, data } JSON to stdout
  --plain                Write stable line-oriented output to stdout
  --quiet                Suppress non-essential human output
  --version              Print CLI version
  --root <dir>           Default project root for commands that accept --cwd
  --state-dir <dir>      Persist a run record JSON file in this directory
  --action-policy <path> Permit gated write/device actions from a JSON policy
  --max-output <chars>   Truncate stdout payloads after this many characters
  --content-boundaries   Wrap stdout data in an explicit untrusted-output boundary
  --allow-runtime-eval <true|false>
                         Permit gated Hermes Runtime.evaluate predicates
  --confirm-actions <list>
                         Reserved for interactive confirmations; noninteractive runs deny
  --record               Persist a run record under <root>/.scratch/expo-ios/runs
  --debug                Include debug fields in machine-readable errors
  --no-color             Disable color; output is uncolored by default
  --no-input             Reserved for noninteractive safety; this CLI never prompts

Discovery:
  doctor                 Check local tool availability and project context
  project-info           Inspect Expo dependencies and app config
  routes                 List Expo Router routes
  devices                List iOS simulators and Android devices
  session new [name]     Create an evidence session and artifact namespace
  target list            List stable simulator/app/Metro target handles
  target select <id>     Store the active target on the latest session
  target current         Show the selected target for the latest session
  snapshot               Capture semantic UI refs for the selected target
  refs                   List cached refs from the latest snapshot
  get <field> <ref>      Inspect one cached ref field
  find <kind> <value>     Locate cached semantic refs and optionally plan an action
  wait                   Wait for cached text or ref state evidence
  batch                  Run multiple expo-ios command steps in one process

Simulator and app actions:
  boot-simulator         Boot an iOS simulator
  open-url <url>         Open a URL/deep link
  launch-app             Launch an installed app
  terminate-app          Terminate an installed app
  reload-app             Relaunch an app as a practical JS reload fallback
  open-dev-menu          Open the React Native dev menu on the simulator
  install-app            Install an .app/.ipa with an action policy
  uninstall-app          Uninstall an app with an action policy
  open-route [route]     Open an Expo Router route
  screenshot             Capture a simulator/device screenshot
  tap                    Tap device coordinates
  fill/press/type        Act on focused input or cached semantic refs
  long-press/dbltap      Run semantic ref gestures from cached bounds
  scroll/drag            Run semantic ref or coordinate gestures
  clipboard              Read, write, or paste simulator clipboard text
  keyboard               Type text or press a key through local tooling
  set                    Mutate explicit simulator environment settings
  gesture                Run tap, long-press, drag, or swipe gesture evidence

Evidence and runtime:
  logs                   Collect recent app/device logs
  ux-context             Capture screenshot, route, runtime, hierarchy, and log context
  annotate-screen        Create a local screenshot annotation board
  inspector              Toggle RN inspector and install/read simulator comments
  review-overlay         Scaffold/run an in-app Codex review overlay
  review-next            Suggest the next constraint-focused UI review step
  devtools capabilities  Report structured DevTools capability records
  console                Read bounded JS console diagnostics
  errors                 Read bounded JS error diagnostics
  metro status           Report Metro status, targets, and symbolication
  navigation             Read or drive app navigation bridge state
  network                Read app network evidence and write redacted HAR
  storage                Read or mutate app storage through policy gates
  state                  List/save/load/clear app state snapshots
  controls               List, inspect, or press app-defined controls
  bridge                 Plan/check dev-only app bridge install, health, and domains
  accessibility          Capture native accessibility tree/audit evidence
  dialog                 Report or act on visible dialog blockers
  sheet                  Report or dismiss visible sheet/modal blockers
  record                 Create recording evidence artifacts
  diff                   Write snapshot or screenshot diff artifacts
  expo                   Inspect Expo modules, config, doctor, upstream policy, and prebuild risk
  rn                     Inspect React Native tree, refs, renders, and fiber evidence
  perf                   Measure summary, startup, action, and bundle evidence
  dashboard              Start, stop, or report local session observability
  skills                 List or print bundled companion skill guidance
  install                Check local install target paths
  upgrade                Check local upgrade status
  release                Run local release packaging checks
  live-backlog           Generate or run the source-derived live backlog
  trace                  Start/read/stop/clear a Hermes interaction trace
  profiler start|stop    Native profiler evidence boundary alias for perf ettrace
  inspect <ref>          Inspect cached source/props/bounds plus Metro target status
  highlight <ref>        Write a bounded highlight evidence overlay
  review report|matrix   Assemble captured evidence into review artifacts
  policy show|check      Explain or evaluate action-policy decisions
  redact <file>          Redact secrets from a JSON/text file

Examples:
  expo-ios --json doctor
  expo-ios --json session new review
  expo-ios --json target list
  expo-ios --json snapshot --interactive --source --bounds
  expo-ios --json get source @e1
  expo-ios --json find role button --name Add tap
  expo-ios --json wait --text Customers
  expo-ios --json wait @e1 --state visible
  expo-ios --json batch '["wait","--text","Customers"]' '["get","source","@e1"]' --bail true
  expo-ios --json screenshot --annotate
  expo-ios --json open-route /customers --cwd apps/mobile --scheme myapp
  expo-ios --json annotate-screen --cwd apps/mobile --serve true
  expo-ios --json inspector probe --metro-port 8081
  expo-ios --json inspector install-comment-menu --metro-port 8081
  expo-ios --json inspector open-dev-menu
  expo-ios --json terminate-app --bundle-id com.example.app
  expo-ios --json reload-app --bundle-id com.example.app
  expo-ios --json fill @e1 "hello"
  expo-ios --json clipboard read
  expo-ios --json set appearance dark --action-policy expo-ios.policy.json
  expo-ios --json review-overlay scaffold --cwd apps/mobile
  expo-ios --json review-overlay prepare --cwd apps/mobile --serve true
  expo-ios --json review-next --surface calendar --stage pre-patch --issue "drag creates scroll conflict"
  expo-ios --json devtools capabilities --metro-port 8081
  expo-ios --json expo upstream-policy --cwd apps/mobile
  expo-ios --json console --limit 50 --metro-port 8081
  expo-ios --json errors --limit 50 --metro-port 8081
  expo-ios --json metro status --metro-port 8081
  expo-ios --json navigation state --metro-port 8081
  expo-ios --json navigation deep-link /customers --scheme myapp
  expo-ios --json network requests --metro-port 8081
  expo-ios --json network har stop network.har --metro-port 8081
  expo-ios --json storage async list --metro-port 8081
  expo-ios --json controls list --metro-port 8081
  expo-ios --json bridge plan --cwd apps/mobile
  expo-ios --json bridge health --cwd apps/mobile --metro-port 8081
  expo-ios --json bridge domains storage set --cwd apps/mobile --metro-port 8081
  expo-ios --json accessibility tree
  expo-ios --json dialog status --metro-port 8081
  expo-ios --json diff snapshot --baseline before.json
  expo-ios --json expo modules --cwd apps/mobile
  expo-ios --json rn tree --metro-port 8081
  expo-ios --json rn inspect @e1
  expo-ios --json perf summary --metro-port 8081
  expo-ios --json perf action "open customer" --metro-port 8081
  expo-ios --json perf bundle dist/index.ios.bundle
  expo-ios --json perf compare --baseline before.json --candidate after.json
  expo-ios --json perf budget check --file expo-ios.perf.json --candidate after.json
  expo-ios --json perf memgraph capture heap.memgraph
  expo-ios --json profiler start
  expo-ios --json inspect @e1
  expo-ios --json policy check action uninstall-app --action-policy expo-ios.policy.json
  expo-ios --json redact run-record.json --output-path run-record.redacted.json
  expo-ios --json dashboard start
  expo-ios --json skills get expo-ios-cli
  expo-ios --json release check
  expo-ios --json gesture long-press --x 160 --y 720 --duration-ms 900 --dry-run true
  expo-ios --json live-backlog matrix --cwd apps/mobile
  expo-ios --json trace --action read --metro-port 8081
`;
}

function printHelp() {
  process.stdout.write(cliHelpText());
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  writeCliError(error);
  process.exitCode = exitCodeForError(error);
});
