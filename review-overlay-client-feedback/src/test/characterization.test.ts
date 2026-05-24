import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  copyEndpointFrom,
  copyFeedbackToClipboard,
  escapeMarkdown,
  firstComponentStackSource,
  formatElementLink,
  formatElementLocation,
  formatElementSource,
  formatFeedbackMarkdown,
  formatSource,
  inspectElementAtPoint,
  isNoisyHierarchyName,
  normalizeInspectorData,
  parseSourceFromComponentStack,
  pointFromCoordinates,
  pointFromNativeEvent,
  pointFromPointerEvent,
  pointerEndpointFrom,
  primitiveString,
} from "../main/index.js";
import type { InspectedElement } from "../main/index.js";

const VIEWPORT = { width: 393, height: 852 };

describe("review-overlay-client-feedback legacy characterization", () => {
  it("clamps native and pointer event coordinates to the viewport and computes normalized points", () => {
    assert.deepEqual(pointFromNativeEvent({ pageX: 500, pageY: -10 }, VIEWPORT), {
      x: 393,
      y: 0,
      nx: 1,
      ny: 0,
    });
    assert.deepEqual(pointFromPointerEvent({ nativeEvent: { x: 100, y: 200 } }, VIEWPORT), {
      x: 100,
      y: 200,
      nx: 100 / 393,
      ny: 200 / 852,
    });
    assert.deepEqual(pointFromPointerEvent({ nativeEvent: { locationX: 9, locationY: 8 } }, VIEWPORT), {
      x: 9,
      y: 8,
      nx: 9 / 393,
      ny: 8 / 852,
    });
    assert.deepEqual(pointFromCoordinates(-1, 900, VIEWPORT), {
      x: 0,
      y: 852,
      nx: 0,
      ny: 1,
    });
  });

  it("rewrites pointer and copy endpoints or falls back to the legacy default ports", () => {
    assert.equal(pointerEndpointFrom("http://127.0.0.1:17655/events?x=1#hash"), "http://127.0.0.1:17655/pointer");
    assert.equal(copyEndpointFrom("http://127.0.0.1:17655/events?x=1#hash"), "http://127.0.0.1:17655/copy");
    assert.equal(pointerEndpointFrom("not a url"), "http://127.0.0.1:17655/pointer");
    assert.equal(copyEndpointFrom("not a url"), "http://127.0.0.1:17655/copy");
  });

  it("posts JSON feedback text to the copy endpoint and returns false on fetch failures", async () => {
    const calls: unknown[] = [];
    assert.equal(await copyFeedbackToClipboard("http://localhost:17655/events", "hello", (url, init) => {
      calls.push({ url, init });
      return { ok: true };
    }), true);
    assert.deepEqual(calls, [{
      url: "http://localhost:17655/copy",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{\"text\":\"hello\"}",
      },
    }]);
    assert.equal(await copyFeedbackToClipboard("http://localhost:17655/events", "hello", () => ({ ok: false })), false);
    assert.equal(await copyFeedbackToClipboard("http://localhost:17655/events", "hello", () => {
      throw new Error("offline");
    }), false);
  });

  it("normalizes inspector data with selected hierarchy props and source parsing", () => {
    const element = normalizeInspectorData({
      frame: { x: 1, y: 2 },
      selectedIndex: 1,
      props: { accessibilityLabel: "Fallback" },
      componentStack: [
        "    at Wrapper (http://localhost/node_modules/pkg/index.js:1:1)",
        "    at SaveButton (/app/screens/settings.tsx:42:7)",
      ].join("\n"),
      hierarchy: [
        { name: "RCTView" },
        {
          name: "SaveButton",
          getInspectorData: () => ({
            props: {
              accessibilityLabel: "Save",
              testID: "save-button",
              accessibilityRole: "button",
            },
          }),
        },
      ],
    });

    assert.deepEqual(element, {
      frame: { x: 1, y: 2 },
      name: "SaveButton",
      label: "Save",
      testID: "save-button",
      role: "button",
      source: { fileName: "/app/screens/settings.tsx", lineNumber: 42, columnNumber: 7 },
      componentStack: "    at Wrapper (http://localhost/node_modules/pkg/index.js:1:1)\n    at SaveButton (/app/screens/settings.tsx:42:7)",
      hierarchy: [
        { name: "RCTView", selected: false },
        { name: "SaveButton", selected: true },
      ],
    });
  });

  it("falls back to view props, selected last hierarchy item, children labels, and undefined for missing frames", () => {
    assert.equal(normalizeInspectorData(null), undefined);
    assert.equal(normalizeInspectorData({ hierarchy: [] }), undefined);
    assert.deepEqual(normalizeInspectorData({
      frame: { width: 10 },
      props: { children: 123 },
      hierarchy: [{ name: "Container" }, { name: null }],
    }), {
      frame: { width: 10 },
      name: null,
      label: "123",
      testID: null,
      role: null,
      source: null,
      componentStack: null,
      hierarchy: [
        { name: "Container", selected: false },
        { name: null, selected: true },
      ],
    });
  });

  it("wraps inspector lookup failures and unavailable inspector globals as undefined callbacks", () => {
    const results: unknown[] = [];
    inspectElementAtPoint(null, { x: 1, y: 2, nx: 0, ny: 0 }, (element) => results.push(element));
    inspectElementAtPoint({}, { x: 1, y: 2, nx: 0, ny: 0 }, (element) => results.push(element));
    inspectElementAtPoint({}, { x: 3, y: 4, nx: 0, ny: 0 }, (element) => results.push(element), () => {
      throw new Error("boom");
    });
    inspectElementAtPoint({ id: 1 }, { x: 3, y: 4, nx: 0, ny: 0 }, (element) => results.push(element), (_view, x, y, callback) => {
      assert.equal(x, 3);
      assert.equal(y, 4);
      callback({ frame: { x, y }, hierarchy: [] });
    });

    assert.deepEqual(results, [
      undefined,
      undefined,
      undefined,
      {
        frame: { x: 3, y: 4 },
        name: null,
        label: null,
        testID: null,
        role: null,
        source: null,
        componentStack: null,
        hierarchy: [],
      },
    ]);
  });

  it("parses component-stack sources while skipping node_modules and supports URL stack fallback formatting", () => {
    assert.deepEqual(parseSourceFromComponentStack([
      "    at Internal (/repo/node_modules/react/index.js:1:1)",
      "    at Screen (/repo/app/index.tsx:12:34)",
    ].join("\n")), {
      fileName: "/repo/app/index.tsx",
      lineNumber: 12,
      columnNumber: 34,
    });
    assert.deepEqual(parseSourceFromComponentStack("at /repo/app/other.tsx:9:8"), {
      fileName: "/repo/app/other.tsx",
      lineNumber: 9,
      columnNumber: 8,
    });
    assert.equal(firstComponentStackSource([
      "    at RCTView (http://localhost:8081/node_modules/react.js:1:1)",
      "    at FancyButton (http://localhost:8081/app/button.tsx:5:6)",
    ].join("\n")), "FancyButton @ http://localhost:8081/app/button.tsx:5:6");
  });

  it("formats element links, locations, sources, and noisy hierarchy names like the legacy client", () => {
    const element = inspectedElement({
      name: "SaveButton",
      label: "Save",
      source: { fileName: "/app/settings.tsx", lineNumber: 10, columnNumber: 2 },
      hierarchy: [
        { name: "App", selected: false },
        { name: "RCTView", selected: false },
        { name: "SettingsScreen", selected: false },
        { name: "SaveButton", selected: true },
      ],
    });

    assert.equal(formatElementLink(element), "SaveButton - /app/settings.tsx:10");
    assert.equal(formatElementLocation(element), "SettingsScreen > SaveButton");
    assert.equal(formatElementSource(element), "/app/settings.tsx:10:2");
    assert.equal(formatSource({ fileName: "/app/settings.tsx", lineNumber: 0, columnNumber: 0 }), "/app/settings.tsx");
    assert.equal(isNoisyHierarchyName("RCTScrollView"), true);
    assert.equal(isNoisyHierarchyName("SettingsScreen"), false);
  });

  it("falls back to component stack source or source unavailable when direct source is absent", () => {
    assert.equal(formatElementLink(inspectedElement({ name: null, source: null })), "Element - source unavailable");
    assert.equal(formatElementSource(inspectedElement({
      source: null,
      componentStack: "    at Fancy (http://localhost:8081/app/fancy.tsx:1:2)",
    })), "Fancy @ http://localhost:8081/app/fancy.tsx:1:2");
    assert.equal(formatElementSource(inspectedElement({ source: null, componentStack: null })), "source unavailable");
  });

  it("formats feedback markdown with escaped quotes and coordinate fallback", () => {
    assert.equal(formatFeedbackMarkdown({
      screenName: "Settings",
      viewport: { width: 393.4, height: 851.6 },
      point: { x: 12.4, y: 98.6 },
      element: inspectedElement({
        name: "SaveButton",
        label: "Save \"now\"",
        source: { fileName: "/app/settings.tsx", lineNumber: 10, columnNumber: 2 },
        hierarchy: [{ name: "Settings", selected: false }, { name: "SaveButton", selected: true }],
      }),
      text: "Looks cramped",
    }), [
      "## Page Feedback: Settings",
      "**Viewport:** 393x852",
      "",
      "### 1. \\\"Save \\\"now\\\".\\\"",
      "**Location:** Settings > SaveButton",
      "**Source:** /app/settings.tsx:10:2",
      "**Feedback:** Looks cramped",
      "",
    ].join("\n"));

    assert.equal(formatFeedbackMarkdown({
      screenName: "Home",
      viewport: VIEWPORT,
      point: { x: 12.4, y: 98.6 },
      element: null,
      text: "Missing label",
    }), [
      "## Page Feedback: Home",
      "**Viewport:** 393x852",
      "",
      "### 1. \\\"Selected element.\\\"",
      "**Location:** x 12, y 99",
      "**Source:** source unavailable",
      "**Feedback:** Missing label",
      "",
    ].join("\n"));
  });

  it("preserves primitive string and markdown escaping helpers", () => {
    assert.equal(primitiveString("text"), "text");
    assert.equal(primitiveString(42), "42");
    assert.equal(primitiveString(true), null);
    assert.equal(escapeMarkdown("  \"quoted\"  "), "\\\"quoted\\\"");
  });
});

function inspectedElement(overrides: Partial<InspectedElement> = {}): InspectedElement {
  return {
    frame: {},
    name: "Element",
    label: null,
    testID: null,
    role: null,
    source: null,
    componentStack: null,
    hierarchy: [],
    ...overrides,
  };
}
