import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  clampNumber,
  consoleCommand,
  devtoolsCommand,
  devtoolsEventsPayload,
  devtoolsOpenPayload,
  devtoolsStatusPayload,
  diagnosticMessagesCommand,
  diagnosticsExpression,
  errorsCommand,
  reactNativeDevToolsReport,
} from "../main/index.js";
import type { DevtoolsDiagnosticsDependencies, ToolTextResult } from "../main/index.js";

const METRO_AVAILABLE = {
  available: true,
  reason: null,
  metroPort: 19000,
  status: "available",
  symbolication: { available: true, reason: null },
  targetCount: 1,
  targets: [
    {
      id: "device-1",
      title: "Expo Go",
      description: "Hermes app",
      appId: "host.exp.Exponent",
      deviceName: "iPhone 15",
      devtoolsFrontendUrl: "/debugger-ui?unstable_enableNetworkPanel=true",
      webSocketDebuggerUrl: "ws://127.0.0.1:19000/inspector/debug",
      reactNative: { debuggerFrontendConnected: true },
      capabilities: { hermesRuntime: true, devtoolsFrontend: true, reactNative: true },
    },
  ],
};

const METRO_UNAVAILABLE = {
  available: false,
  reason: "Metro is not reachable on the requested port.",
  metroPort: 19000,
  status: "unavailable",
  symbolication: { available: false, reason: "Metro is unavailable." },
  targetCount: 0,
  targets: [],
};

describe("devtools-diagnostics legacy characterization", () => {
  describe("DevTools target and panel normalization", () => {
    it("normalizes relative DevTools frontend URLs, network panel detection, attachment state, and panel groups", () => {
      const report = reactNativeDevToolsReport(METRO_AVAILABLE);

      assert.equal(report.frontend.available, true);
      assert.equal(report.frontend.url, "http://127.0.0.1:19000/debugger-ui?unstable_enableNetworkPanel=true");
      assert.equal(report.frontend.launchPath, "metro-devtools-frontend-url");
      assert.deepEqual(report.attachmentState, { state: "attached", detectable: true });
      assert.deepEqual(report.attachmentRisk, {
        level: "medium",
        mayDetachHumanDebugger: true,
        reason: "Opening React Native DevTools can attach to the selected target and may affect an existing human debugger session.",
      });
      assert.deepEqual(report.panels.map((panel) => [panel.name, panel.kind, panel.available]), [
        ["debugger", "human-visible-panel", true],
        ["network", "human-visible-panel", true],
        ["console", "machine-readable-domain", true],
        ["errors", "machine-readable-domain", true],
        ["react-components", "machine-readable-domain", true],
      ]);
    });

    it("reports unavailable panel state when Metro has no target or frontend", () => {
      const report = reactNativeDevToolsReport(METRO_UNAVAILABLE);

      assert.equal(report.target, null);
      assert.deepEqual(report.frontend, { available: false, url: null, launchPath: null });
      assert.deepEqual(report.attachmentState, {
        state: "unavailable",
        detectable: false,
        reason: "No Metro target.",
      });
      assert.deepEqual(report.panels.map((panel) => [panel.name, panel.available]), [
        ["debugger", false],
        ["network", false],
        ["console", false],
        ["errors", false],
        ["react-components", false],
      ]);
    });

    it("detects debugger attachment aliases and malformed DevTools URLs like legacy", () => {
      assert.equal(reactNativeDevToolsReport({
        ...METRO_AVAILABLE,
        targets: [{ ...METRO_AVAILABLE.targets[0], reactNative: { debuggerConnected: false } }],
      }).attachmentState.state, "not-attached");

      assert.equal(reactNativeDevToolsReport({
        ...METRO_AVAILABLE,
        targets: [{ ...METRO_AVAILABLE.targets[0], reactNative: { isDebuggerConnected: true } }],
      }).attachmentState.state, "attached");

      assert.equal(reactNativeDevToolsReport({
        ...METRO_AVAILABLE,
        targets: [{ ...METRO_AVAILABLE.targets[0], devtoolsFrontendUrl: "http://%zz?unstable_enableNetworkPanel=true" }],
      }).panels.find((panel) => panel.name === "network")?.available, true);
    });
  });

  describe("DevTools command payloads", () => {
    it("builds capabilities from Metro, symbolication, runtime, frontend, network, console, and errors availability", async () => {
      const payload = parseToolJson(await devtoolsCommand({}, deps({ metro: METRO_AVAILABLE })));

      assert.equal(payload.action, "capabilities");
      assert.equal(payload.metroPort, 19000);
      assert.equal(payload.capabilities.length, 7);
      assert.deepEqual(payload.capabilities.map((capability: { name: string; available: boolean }) => [
        capability.name,
        capability.available,
      ]), [
        ["metro-http", true],
        ["metro-symbolication", true],
        ["hermes-runtime", true],
        ["react-native-devtools", true],
        ["react-native-devtools-network-panel", true],
        ["console", true],
        ["errors", true],
      ]);
      assert.equal(payload.capabilities[3].writeCommands[0], "devtools open");
    });

    it("returns status and panels payloads with machine-readable and human-visible groupings", async () => {
      const status = await devtoolsStatusPayload({ metroPort: 19000 }, "panels", deps({ metro: METRO_AVAILABLE }));

      assert.equal(status.available, true);
      assert.equal(status.action, "panels");
      assert.equal(status.machineReadableDomains.length, 3);
      assert.deepEqual(status.machineReadableDomains.map((panel) => panel.name), ["console", "errors", "react-components"]);
      assert.deepEqual(status.humanVisiblePanels.map((panel) => panel.name), ["debugger", "network"]);
    });

    it("redacts exported status payloads before package consumers see target metadata", async () => {
      const status: any = await devtoolsStatusPayload({ metroPort: 19000 }, "status", deps({
        metro: {
          ...METRO_AVAILABLE,
          targets: [{
            ...METRO_AVAILABLE.targets[0],
            devtoolsFrontendUrl: "/debugger-ui?apiKey=secret&unstable_enableNetworkPanel=true",
            cookie: "session=secret",
          }],
        },
      }));

      assert.equal(status.target.cookie, "[redacted]");
      assert.equal(status.frontend.url, "http://127.0.0.1:19000/debugger-ui?apiKey=%5Bredacted%5D&unstable_enableNetworkPanel=true");
      assert.equal(status.metro.targets[0].devtoolsFrontendUrl, "/debugger-ui?apiKey=[redacted]&unstable_enableNetworkPanel=true");
    });

    it("opens the DevTools frontend through macOS open and preserves launch diagnostics", async () => {
      const execs: unknown[] = [];
      const payload = await devtoolsOpenPayload({ metroPort: 19000 }, deps({
        metro: METRO_AVAILABLE,
        execFile: async (file, args, options) => {
          execs.push({ file, args, options });
          return { stdout: "opened", stderr: "", error: null };
        },
      }));

      assert.equal(payload.available, true);
      assert.equal(payload.url, "http://127.0.0.1:19000/debugger-ui?unstable_enableNetworkPanel=true");
      assert.equal(payload.launchPath, "metro-devtools-frontend-url");
      assert.equal(payload.mirrorsUpstreamLaunch, true);
      assert.deepEqual(execs, [{
        file: "open",
        args: ["http://127.0.0.1:19000/debugger-ui?unstable_enableNetworkPanel=true"],
        options: { timeout: 10000, rejectOnError: false },
      }]);
    });

    it("returns an unavailable open payload when no frontend URL is available", async () => {
      const payload: any = await devtoolsOpenPayload({}, deps({
        metro: { ...METRO_UNAVAILABLE, token: "secret" },
      }));

      assert.equal(payload.available, false);
      assert.equal(payload.action, "open");
      assert.equal(payload.reason, "No DevTools frontend URL is available.");
      assert.equal(payload.reactNativeDevTools.frontend.available, false);
      assert.equal(payload.metro.token, "[redacted]");
    });

    it("records DevTools events under the expo state root and resets events on start", async () => {
      const writes: Array<{ file: string; payload: unknown }> = [];
      const payload: any = await devtoolsEventsPayload({ subaction: "read" }, deps({
        metro: METRO_AVAILABLE,
        now: () => "2026-05-23T10:20:30.000Z",
        stateRoot: "/tmp/state",
        readJsonFile: async () => ({ events: [{ type: "devtools.start", timestamp: "old", metro: null }] }),
        writeJsonFile: async (file, payload) => writes.push({ file, payload }),
        mkdir: async () => undefined,
      }));

      assert.equal(payload.available, true);
      assert.equal(payload.artifact, "/tmp/state/artifacts/devtools-events/events.json");
      assert.deepEqual(payload.events.map((event: any) => event.type), ["devtools.start", "devtools.read"]);
      assert.deepEqual(writes, [{ file: payload.artifact, payload }]);

      const start = await devtoolsEventsPayload({ subaction: "start" }, deps({
        metro: METRO_AVAILABLE,
        now: () => "2026-05-23T10:20:31.000Z",
        stateRoot: "/tmp/state",
        readJsonFile: async () => ({ events: [{ type: "devtools.read" }] }),
        writeJsonFile: async () => undefined,
        mkdir: async () => undefined,
      }));
      assert.deepEqual(start.events.map((event) => event.type), ["devtools.start"]);
    });

    it("rejects unknown DevTools actions and subactions with legacy messages", async () => {
      await assert.rejects(() => devtoolsCommand({ action: "bad" }, deps({ metro: METRO_AVAILABLE })), /Unknown devtools action: bad/);
      await assert.rejects(() => devtoolsEventsPayload({ subaction: "pause" }, deps({ metro: METRO_AVAILABLE })), /Unknown devtools events action: pause/);
    });
  });

  describe("console and errors diagnostics", () => {
    it("returns an unavailable diagnostics payload when no Hermes websocket target exists", async () => {
      const payload = parseToolJson(await consoleCommand({ metroPort: 19000 }, deps({
        targetDiscovery: {
          available: true,
          endpoint: "/json/list",
          targets: [],
          malformedTargets: [],
          reason: null,
        },
      })));

      assert.deepEqual(payload, {
        available: false,
        kind: "console",
        source: "hermes-runtime",
        reason: "No Metro inspector target.",
        metroPort: 19000,
        messages: [],
        targetDiscovery: {
          available: true,
          endpoint: "/json/list",
          targets: [],
          malformedTargets: [],
          reason: null,
        },
        limitations: ["Start Metro and connect a debuggable Hermes target before reading JS diagnostics."],
      });
    });

    it("reads diagnostics with clamped limits, target summary, and CDP diagnostics", async () => {
      let evaluated: { url: string; expression: string; timeoutMs: number } | undefined;
      const payload = parseToolJson(await diagnosticMessagesCommand("errors", { limit: 2, metroPort: 19000 }, deps({
        targetDiscovery: {
          available: true,
          endpoint: "/json/list",
          targets: METRO_AVAILABLE.targets,
          malformedTargets: [],
          reason: null,
        },
        evaluateHermesExpression: async (url, expression, options) => {
          evaluated = { url, expression, timeoutMs: options.timeoutMs };
          return {
            result: {
              result: {
                value: {
                  available: true,
                  source: "runtime-diagnostics-buffer",
                  total: 3,
                  messages: [{ message: "a" }, { message: "b" }, { message: "c" }],
                },
              },
            },
            diagnostics: { calls: 1 },
          };
        },
      })));

      assert.equal(payload.kind, "errors");
      assert.equal(payload.limit, 2);
      assert.deepEqual(payload.messages, [{ message: "b" }, { message: "c" }]);
      assert.equal(payload.target.webSocketDebuggerUrl, "ws://127.0.0.1:19000/inspector/debug");
      assert.deepEqual(payload.cdp, { calls: 1 });
      assert.equal(evaluated?.timeoutMs, 5000);
      assert.match(evaluated?.expression ?? "", /const kind = "errors"/);
      assert.match(evaluated?.expression ?? "", /const limit = 2/);
    });

    it("redacts sensitive diagnostic payload fields and bounds large message strings", async () => {
      const longStack = "x".repeat(40_005);
      const payload = parseToolJson(await diagnosticMessagesCommand("console", { limit: 1, metroPort: 19000 }, deps({
        targetDiscovery: {
          available: true,
          endpoint: "/json/list",
          targets: METRO_AVAILABLE.targets,
          malformedTargets: [],
          reason: null,
        },
        evaluateHermesExpression: async () => ({
          result: {
            result: {
              value: {
                available: true,
                source: "runtime-diagnostics-buffer",
                total: 1,
                messages: [{
                  message: "https://app.local/path?token=secret&ok=1",
                  stack: longStack,
                  authorization: "Bearer secret",
                }],
              },
            },
          },
          diagnostics: { cookie: "session=secret" },
        }),
      })));

      assert.equal(payload.messages[0].message, "https://app.local/path?token=%5Bredacted%5D&ok=1");
      assert.equal(payload.messages[0].authorization, "[redacted]");
      assert.match(payload.messages[0].stack, /\.\.\.\[truncated 5 chars\]$/);
      assert.equal(payload.cdp.cookie, "[redacted]");
    });

    it("clears diagnostics and surfaces runtime fallback errors", async () => {
      const cleared = parseToolJson(await errorsCommand({ action: "clear" }, deps({
        targetDiscovery: {
          available: true,
          endpoint: "/json/list",
          targets: METRO_AVAILABLE.targets,
          malformedTargets: [],
          reason: null,
        },
        evaluateHermesExpression: async () => ({
          result: { result: { value: { available: true, cleared: true } } },
          cdp: { ok: true },
        }),
      })));
      assert.deepEqual(cleared, {
        available: true,
        cleared: true,
        kind: "errors",
        action: "clear",
        metroPort: 8081,
        target: {
          id: "device-1",
          title: "Expo Go",
          description: "Hermes app",
          appId: "host.exp.Exponent",
          deviceName: "iPhone 15",
          devtoolsFrontendUrl: "/debugger-ui?unstable_enableNetworkPanel=true",
          webSocketDebuggerUrl: "ws://127.0.0.1:19000/inspector/debug",
          reactNative: { debuggerFrontendConnected: true },
          capabilities: { hermesRuntime: true, devtoolsFrontend: true, reactNative: true },
        },
        cdp: { ok: true },
      });

      const failed = parseToolJson(await errorsCommand({ action: "clear" }, deps({
        targetDiscovery: {
          available: true,
          endpoint: "/json/list",
          targets: METRO_AVAILABLE.targets,
          malformedTargets: [],
          reason: null,
        },
        evaluateHermesExpression: async () => ({ error: "boom" }),
      })));
      assert.equal(failed.available, false);
      assert.equal(failed.reason, "boom");
    });

    it("clamps finite numeric diagnostic limits and rejects non-finite values", async () => {
      assert.equal(clampNumber("1001", 1, 1000), 1000);
      await assert.rejects(() => consoleCommand({ limit: "abc" }, deps({
        targetDiscovery: {
          available: true,
          endpoint: "/json/list",
          targets: [],
          malformedTargets: [],
          reason: null,
        },
      })), /Expected a finite number, got abc\./);
    });

    it("generates the legacy runtime diagnostics expression with fallback buffers", () => {
      const expression = diagnosticsExpression({ kind: "console", limit: 25 });

      assert.match(expression, /__EXPO_IOS_DIAGNOSTICS__/);
      assert.match(expression, /__CODEX_DIAGNOSTICS__/);
      assert.match(expression, /diagnostics\[kind === 'errors' \? 'error' : 'logs'\]/);
      assert.match(expression, /raw\.slice\(-limit\)\.map/);
      assert.match(expression, /Runtime diagnostics reflect the app-provided buffer; native logs are not included\./);
    });
  });

  describe("persisted DevTools evidence safety", () => {
    it("redacts sensitive Metro event payload values before persisting", async () => {
      const writes: Array<{ file: string; payload: any }> = [];
      const payload: any = await devtoolsEventsPayload({ subaction: "read" }, deps({
        metro: {
          ...METRO_AVAILABLE,
          targets: [{
            ...METRO_AVAILABLE.targets[0],
            devtoolsFrontendUrl: "/debugger-ui?token=secret&unstable_enableNetworkPanel=true",
            authorization: "Bearer secret",
          }],
        },
        stateRoot: "/tmp/state",
        readJsonFile: async () => ({ events: [] }),
        writeJsonFile: async (file, persisted) => writes.push({ file, payload: persisted }),
        mkdir: async () => undefined,
      }));

      assert.equal(payload.events[0].metro.targets[0].authorization, "[redacted]");
      assert.equal(
        payload.events[0].metro.targets[0].devtoolsFrontendUrl,
        "/debugger-ui?token=[redacted]&unstable_enableNetworkPanel=true",
      );
      assert.deepEqual(writes[0]?.payload, payload);
    });

    it("caps persisted event arrays to a bounded recent window", async () => {
      const payload: any = await devtoolsEventsPayload({ subaction: "read" }, deps({
        metro: METRO_AVAILABLE,
        stateRoot: "/tmp/state",
        readJsonFile: async () => ({
          events: Array.from({ length: 505 }, (_, index) => ({ type: `old-${index}` })),
        }),
        writeJsonFile: async () => undefined,
        mkdir: async () => undefined,
      }));

      assert.equal(payload.events.length, 500);
      assert.equal(payload.events[0].type, "old-6");
      assert.equal(payload.events[499].type, "devtools.read");
    });
  });
});

function deps(overrides: Partial<DevtoolsDiagnosticsDependencies> & {
  metro?: any;
  stateRoot?: string;
} = {}): DevtoolsDiagnosticsDependencies {
  return {
    metroStatusPayload: async () => overrides.metro ?? METRO_UNAVAILABLE,
    resolveExpoStateRoot: () => overrides.stateRoot ?? "/state",
    now: overrides.now,
    execFile: overrides.execFile,
    readJsonFile: overrides.readJsonFile,
    writeJsonFile: overrides.writeJsonFile,
    mkdir: overrides.mkdir,
    targetDiscovery: overrides.targetDiscovery,
    evaluateHermesExpression: overrides.evaluateHermesExpression,
  };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
