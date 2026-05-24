import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MetroInspectorClient,
  clampNumber,
  formatError,
  metroCommand,
  metroTargets,
  probeMetroSymbolication,
  targetSummary,
} from "../main/index.js";
import type {
  ComponentStackFrame,
  FetchResponseLike,
  MetroCommandDependencies,
  MetroInspectorClientDependencies,
  ToolTextResult,
} from "../main/index.js";

const LIMITATIONS = [
  "This command probes existing Metro HTTP endpoints only and never starts Metro implicitly.",
  "Connected targets can be stale when multiple apps or devices are attached.",
];

const VALID_TARGET_RAW = {
  id: "target-1",
  title: "Expo Go",
  description: "",
  appId: "host.exp.Exponent",
  deviceName: "iPhone 15",
  devtoolsFrontendUrl: "http://127.0.0.1:8081/debugger-ui",
  webSocketDebuggerUrl: "ws://127.0.0.1:8081/inspector/debug?device=iPhone",
  reactNative: { logicalDeviceId: "device-1", capabilities: ["native"] },
};

const VALID_TARGET = {
  id: "target-1",
  title: "Expo Go",
  description: null,
  appId: "host.exp.Exponent",
  deviceName: "iPhone 15",
  devtoolsFrontendUrl: "http://127.0.0.1:8081/debugger-ui",
  webSocketDebuggerUrl: "ws://127.0.0.1:8081/inspector/debug?device=iPhone",
  reactNative: { logicalDeviceId: "device-1", capabilities: ["native"] },
  capabilities: {
    hermesRuntime: true,
    devtoolsFrontend: true,
    reactNative: true,
  },
};

describe("metro-probes legacy characterization", () => {
  describe("port clamping and command dispatch", () => {
    it("clamps finite Metro port values to the legacy 1..65535 range", () => {
      assert.equal(clampNumber(8081, 1, 65535), 8081);
      assert.equal(clampNumber("19000", 1, 65535), 19000);
      assert.equal(clampNumber(0, 1, 65535), 1);
      assert.equal(clampNumber(-20, 1, 65535), 1);
      assert.equal(clampNumber(70000, 1, 65535), 65535);
      assert.equal(clampNumber("65536", 1, 65535), 65535);
      assert.throws(() => clampNumber("not-a-port", 1, 65535), /Expected a finite number, got not-a-port\./);
      assert.throws(() => clampNumber(Number.POSITIVE_INFINITY, 1, 65535), /Expected a finite number, got Infinity\./);
    });

    it("defaults metroCommand to status and delegates reload and symbolicate actions", async () => {
      const calls: string[] = [];
      const deps: MetroCommandDependencies = {
        metroStatusPayload: async (args) => {
          calls.push(`status:${String(args.metroPort)}`);
          return { available: true, action: "status", metroPort: args.metroPort ?? 8081 };
        },
        metroReloadPayload: async (args) => {
          calls.push(`reload:${String(args.metroPort)}`);
          return { available: false, action: "reload", metroPort: args.metroPort ?? 8081 };
        },
        metroSymbolicatePayload: async (args) => {
          calls.push(`symbolicate:${String(args.stackFile)}`);
          return { available: true, action: "symbolicate", stackFile: args.stackFile };
        },
      };

      assert.deepEqual(parseToolJson(await metroCommand({ metroPort: 19000 }, deps)), {
        available: true,
        action: "status",
        metroPort: 19000,
      });
      assert.deepEqual(parseToolJson(await metroCommand({ action: "reload", metroPort: 19001 }, deps)), {
        available: false,
        action: "reload",
        metroPort: 19001,
      });
      assert.deepEqual(parseToolJson(await metroCommand({ action: "symbolicate", stackFile: "stack.txt" }, deps)), {
        available: true,
        action: "symbolicate",
        stackFile: "stack.txt",
      });
      assert.deepEqual(calls, ["status:19000", "reload:19001", "symbolicate:stack.txt"]);
    });

    it("default reload action evaluates the legacy Hermes reload expression against the first Metro target", async () => {
      let evaluated: { webSocketDebuggerUrl: string; expression: string; timeoutMs: number } | undefined;

      assert.deepEqual(parseToolJson(await metroCommand({ action: "reload", metroPort: 19000 }, {
        fetchLocalJson: async () => [VALID_TARGET_RAW],
        evaluateHermesExpression: async (webSocketDebuggerUrl, expression, options) => {
          evaluated = { webSocketDebuggerUrl, expression, timeoutMs: options.timeoutMs };
          return { result: { result: { value: { available: true, strategy: "DevSettings.reload" } } } };
        },
      })), {
        available: true,
        strategy: "DevSettings.reload",
        action: "reload",
        metroPort: 19000,
        target: VALID_TARGET,
      });
      if (!evaluated) throw new Error("Expected reload to evaluate a Hermes expression.");
      assert.deepEqual(evaluated, {
        webSocketDebuggerUrl: VALID_TARGET.webSocketDebuggerUrl,
        expression: evaluated.expression,
        timeoutMs: 3000,
      });
      assert.match(evaluated.expression, /DevSettings\.reload/);
    });

    it("default symbolicate action requires stackFile, accepts positional fallback, and posts parsed frames", async () => {
      let postedBody: unknown = null;

      await assert.rejects(() => metroCommand({ action: "symbolicate" }), /stackFile must be a non-empty string\./);
      assert.deepEqual(parseToolJson(await metroCommand({ action: "symbolicate", _: ["stack.txt"], metroPort: 19000 }, {
        resolvePath: (filePath) => `/abs/${filePath}`,
        readTextFile: async (filePath, encoding) => {
          assert.equal(filePath, "/abs/stack.txt");
          assert.equal(encoding, "utf8");
          return [
            "    at App (http://127.0.0.1:8081/index.bundle:10:12)",
            "ignored line",
            "    at  (http://127.0.0.1:8081/index.bundle:20:2)",
          ].join("\n");
        },
        fetchLocalLoopback: async (url, options) => {
          assert.equal(url, "http://127.0.0.1:19000/symbolicate");
          postedBody = JSON.parse(options.body);
          return response(true, 200, { stack: [{ methodName: "App", file: "/src/App.tsx" }] });
        },
      })), {
        available: true,
        action: "symbolicate",
        metroPort: 19000,
        stackFile: "/abs/stack.txt",
        frameCount: 2,
        result: { stack: [{ methodName: "App", file: "/src/App.tsx" }] },
      });
      assert.deepEqual(postedBody, {
        stack: [
          { methodName: "App", file: "http://127.0.0.1:8081/index.bundle", lineNumber: 10, column: 12 },
          { methodName: "<anonymous>", file: "http://127.0.0.1:8081/index.bundle", lineNumber: 20, column: 2 },
        ],
      });
    });

    it("rejects unknown or blank metro actions with legacy messages", async () => {
      await assert.rejects(() => metroCommand({ action: "launch" }), /Unknown metro action: launch/);
      await assert.rejects(() => metroCommand({ action: "   " }), /action must be a non-empty string\./);
    });
  });

  describe("target summaries and target normalization", () => {
    it("returns null summaries for missing targets and computes fallback capabilities", () => {
      assert.equal(targetSummary(null), null);
      assert.equal(targetSummary(undefined), null);
      assert.deepEqual(targetSummary({
        id: "target-1",
        title: "Expo Go",
        devtoolsFrontendUrl: "http://devtools",
        webSocketDebuggerUrl: "ws://runtime",
        reactNative: { appId: "host.exp.Exponent" },
      }), {
        id: "target-1",
        title: "Expo Go",
        description: null,
        appId: null,
        deviceName: null,
        devtoolsFrontendUrl: "http://devtools",
        webSocketDebuggerUrl: "ws://runtime",
        reactNative: { appId: "host.exp.Exponent" },
        capabilities: {
          hermesRuntime: true,
          devtoolsFrontend: true,
          reactNative: true,
        },
      });
      assert.deepEqual(targetSummary({
        id: "target-2",
        capabilities: { hermesRuntime: false, devtoolsFrontend: false, reactNative: false },
      }), {
        id: "target-2",
        title: null,
        description: null,
        appId: null,
        deviceName: null,
        devtoolsFrontendUrl: null,
        webSocketDebuggerUrl: null,
        reactNative: null,
        capabilities: { hermesRuntime: false, devtoolsFrontend: false, reactNative: false },
      });
    });

    it("rejects non-object, array, and metadata-free targets with response shape evidence", () => {
      const client = new MetroInspectorClient(8081);

      assert.deepEqual(client.normalizeTarget(["not", "object"], 3), {
        target: null,
        error: {
          index: 3,
          reason: "Target was not an object.",
          shape: { type: "array", length: 2 },
        },
      });
      assert.deepEqual(client.normalizeTarget("target", 4), {
        target: null,
        error: {
          index: 4,
          reason: "Target was not an object.",
          shape: { type: "string" },
        },
      });
      assert.deepEqual(client.normalizeTarget({ appId: "only.bundle.id", deviceName: "iPhone" }, 5), {
        target: null,
        error: {
          index: 5,
          reason: "Target did not include any stable identifying metadata.",
          shape: { type: "object", keys: ["appId", "deviceName"] },
        },
      });
    });

    it("normalizes optional strings, React Native metadata, and capability flags from raw targets", () => {
      const client = new MetroInspectorClient(8081);

      assert.deepEqual(client.normalizeTarget({
        id: "target-1",
        title: "",
        description: 42,
        appId: "host.exp.Exponent",
        deviceName: "",
        devtoolsFrontendUrl: "",
        webSocketDebuggerUrl: "http://not-a-websocket",
        reactNative: "truthy-but-not-object",
      }, 0), {
        target: {
          id: "target-1",
          title: null,
          description: null,
          appId: "host.exp.Exponent",
          deviceName: null,
          devtoolsFrontendUrl: null,
          webSocketDebuggerUrl: "http://not-a-websocket",
          reactNative: null,
          capabilities: {
            hermesRuntime: false,
            devtoolsFrontend: false,
            reactNative: true,
          },
        },
        error: null,
      });
      assert.deepEqual(client.normalizeTarget(VALID_TARGET_RAW, 1), {
        target: VALID_TARGET,
        error: null,
      });
    });
  });

  describe("Metro target discovery", () => {
    it("returns an unavailable /json/list envelope when fetching targets fails", async () => {
      const client = new MetroInspectorClient(8081, {
        fetchLocalJson: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:8081");
        },
      });

      assert.deepEqual(await client.targets(), {
        available: false,
        endpoint: "/json/list",
        targets: [],
        malformedTargets: [],
        reason: "connect ECONNREFUSED 127.0.0.1:8081",
      });
    });

    it("returns an unavailable malformed envelope when /json/list is not an array", async () => {
      const client = new MetroInspectorClient(8081, {
        fetchLocalJson: async () => ({ error: "not an array" }),
      });

      assert.deepEqual(await client.targets(), {
        available: false,
        endpoint: "/json/list",
        targets: [],
        malformedTargets: [{
          index: null,
          reason: "Metro target list was not an array.",
          shape: { type: "object", keys: ["error"] },
        }],
        reason: "Metro target list was malformed.",
      });
    });

    it("skips malformed target entries while preserving valid targets and reporting the skip reason", async () => {
      const client = new MetroInspectorClient(8081, {
        fetchLocalJson: async () => [
          ["bad"],
          VALID_TARGET_RAW,
          { appId: "no-stable-identifier" },
          { title: "Fallback Target" },
        ],
      });

      assert.deepEqual(await client.targets(), {
        available: true,
        endpoint: "/json/list",
        targets: [
          VALID_TARGET,
          {
            id: null,
            title: "Fallback Target",
            description: null,
            appId: null,
            deviceName: null,
            devtoolsFrontendUrl: null,
            webSocketDebuggerUrl: null,
            reactNative: null,
            capabilities: {
              hermesRuntime: false,
              devtoolsFrontend: false,
              reactNative: false,
            },
          },
        ],
        malformedTargets: [
          { index: 0, reason: "Target was not an object.", shape: { type: "array", length: 1 } },
          {
            index: 2,
            reason: "Target did not include any stable identifying metadata.",
            shape: { type: "object", keys: ["appId"] },
          },
        ],
        reason: "Some Metro targets were malformed and skipped.",
      });
    });

    it("metroTargets unwraps the normalized target list from MetroInspectorClient.targets", async () => {
      assert.deepEqual(await metroTargets(8081, {
        fetchLocalJson: async () => [VALID_TARGET_RAW],
      }), [VALID_TARGET]);
    });
  });

  describe("status, version, and formatted errors", () => {
    it("returns available status and version endpoint envelopes", async () => {
      const client = new MetroInspectorClient(19000, {
        fetchLocalText: async (url, options) => {
          assert.equal(url, "http://127.0.0.1:19000/status");
          assert.deepEqual(options, { timeoutMs: 1500 });
          return "packager-status:running";
        },
        fetchLocalJson: async (url, options) => {
          assert.equal(url, "http://127.0.0.1:19000/json/version");
          assert.deepEqual(options, { timeoutMs: 1500 });
          return { Browser: "Hermes", "Protocol-Version": "1.3" };
        },
      });

      assert.deepEqual(await client.status(), {
        available: true,
        endpoint: "/status",
        text: "packager-status:running",
        error: null,
      });
      assert.deepEqual(await client.version(), {
        available: true,
        endpoint: "/json/version",
        value: { Browser: "Hermes", "Protocol-Version": "1.3" },
        error: null,
      });
    });

    it("default local fetches try localhost when 127.0.0.1 fails", async () => {
      const originalFetch = globalThis.fetch;
      const attemptedUrls: string[] = [];
      globalThis.fetch = (async (url: string | URL | Request) => {
        attemptedUrls.push(String(url));
        if (String(url).startsWith("http://127.0.0.1:19000")) {
          throw new Error("connection refused");
        }
        return {
          ok: true,
          status: 200,
          text: async () => "packager-status:running",
          json: async () => ({ ignored: true }),
        } as Response;
      }) as typeof fetch;

      try {
        assert.deepEqual(await new MetroInspectorClient(19000).status(), {
          available: true,
          endpoint: "/status",
          text: "packager-status:running",
          error: null,
        });
        assert.deepEqual(attemptedUrls, [
          "http://127.0.0.1:19000/status",
          "http://localhost:19000/status",
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns unavailable status and version envelopes with formatted errors", async () => {
      const statusError = Object.assign(new Error("HTTP 500"), { stdout: "server said no", stderr: "trace line" });
      const client = new MetroInspectorClient(8081, {
        fetchLocalText: async () => {
          throw statusError;
        },
        fetchLocalJson: async () => {
          throw new Error("invalid json");
        },
      });

      assert.equal(formatError(statusError), "HTTP 500\n\nstdout:\nserver said no\n\nstderr:\ntrace line");
      assert.deepEqual(await client.status(), {
        available: false,
        endpoint: "/status",
        text: null,
        error: "HTTP 500\n\nstdout:\nserver said no\n\nstderr:\ntrace line",
      });
      assert.deepEqual(await client.version(), {
        available: false,
        endpoint: "/json/version",
        value: null,
        error: "invalid json",
      });
    });
  });

  describe("symbolication probes", () => {
    it("posts the stack to /symbolicate and returns the JSON value when Metro responds OK", async () => {
      const requests: unknown[] = [];
      const stack = [frame("App", "http://127.0.0.1:8081/index.bundle", 10, 12)];
      const client = new MetroInspectorClient(8081, {
        fetchLocalLoopback: async (url, options) => {
          requests.push({ url, options });
          return response(true, 200, { stack: [{ methodName: "App", file: "/src/App.tsx" }] });
        },
      });

      assert.deepEqual(await client.symbolicate(stack), {
        available: true,
        endpoint: "/symbolicate",
        status: 200,
        reason: null,
        value: { stack: [{ methodName: "App", file: "/src/App.tsx" }] },
      });
      assert.deepEqual(requests, [{
        url: "http://127.0.0.1:8081/symbolicate",
        options: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stack }),
          timeoutMs: 1500,
        },
      }]);
    });

    it("keeps symbolication available with null value when OK JSON parsing fails", async () => {
      const client = new MetroInspectorClient(8081, {
        fetchLocalLoopback: async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("bad json");
          },
        }),
      });

      assert.deepEqual(await client.symbolicate([]), {
        available: true,
        endpoint: "/symbolicate",
        status: 200,
        reason: null,
        value: null,
      });
    });

    it("returns non-OK symbolication as unavailable without reading JSON", async () => {
      let jsonCalls = 0;
      const client = new MetroInspectorClient(8081, {
        fetchLocalLoopback: async () => ({
          ok: false,
          status: 404,
          json: async () => {
            jsonCalls += 1;
            return { ignored: true };
          },
        }),
      });

      assert.deepEqual(await client.symbolicate([]), {
        available: false,
        endpoint: "/symbolicate",
        status: 404,
        reason: "Metro symbolicate HTTP 404",
        value: null,
      });
      assert.equal(jsonCalls, 0);
    });

    it("returns fetch failures as unavailable symbolication envelopes", async () => {
      const client = new MetroInspectorClient(8081, {
        fetchLocalLoopback: async () => {
          throw new Error("fetch failed");
        },
      });

      assert.deepEqual(await client.symbolicate([]), {
        available: false,
        endpoint: "/symbolicate",
        status: null,
        reason: "fetch failed",
        value: null,
      });
    });

    it("probeSymbolication and probeMetroSymbolication project the symbolication envelope", async () => {
      const deps: MetroInspectorClientDependencies = {
        fetchLocalLoopback: async () => response(false, 500, null),
      };

      assert.deepEqual(await new MetroInspectorClient(8081, deps).probeSymbolication(), {
        available: false,
        endpoint: "/symbolicate",
        status: 500,
        reason: "Metro symbolicate HTTP 500",
      });
      assert.deepEqual(await probeMetroSymbolication(8081, deps), {
        available: false,
        endpoint: "/symbolicate",
        status: 500,
        reason: "Metro symbolicate HTTP 500",
      });
    });
  });

  describe("statusPayload composition", () => {
    it("does not call target, version, or symbolication probes when /status is unavailable", async () => {
      let jsonCalls = 0;
      let symbolicationCalls = 0;
      const client = new MetroInspectorClient(8081, {
        fetchLocalText: async () => {
          throw new Error("ECONNREFUSED");
        },
        fetchLocalJson: async () => {
          jsonCalls += 1;
          return [];
        },
        fetchLocalLoopback: async () => {
          symbolicationCalls += 1;
          return response(true, 200, null);
        },
      });

      assert.deepEqual(await client.statusPayload(), {
        available: false,
        reason: "Metro is not reachable on the requested port.",
        metroPort: 8081,
        status: "unavailable",
        statusText: null,
        error: "ECONNREFUSED",
        version: null,
        versionError: "Metro is unavailable.",
        targetCount: 0,
        targets: [],
        targetDiscovery: {
          endpoint: "/json/list",
          available: false,
          reason: "Metro is unavailable.",
          malformedTargets: [],
        },
        symbolication: {
          available: false,
          reason: "Metro is unavailable.",
          endpoint: "/symbolicate",
        },
        limitations: LIMITATIONS,
      });
      assert.equal(jsonCalls, 0);
      assert.equal(symbolicationCalls, 0);
    });

    it("includes version, target discovery, symbolication, limitations, and status fields when Metro is reachable", async () => {
      const jsonUrls: string[] = [];
      const client = new MetroInspectorClient(19000, {
        fetchLocalText: async () => "packager-status:running",
        fetchLocalJson: async (url) => {
          jsonUrls.push(url);
          if (url.endsWith("/json/list")) return [VALID_TARGET_RAW, "bad"];
          return { Browser: "Hermes", "Protocol-Version": "1.3" };
        },
        fetchLocalLoopback: async () => response(true, 200, { stack: [] }),
      });

      assert.deepEqual(await client.statusPayload(), {
        available: true,
        reason: null,
        metroPort: 19000,
        status: "available",
        statusText: "packager-status:running",
        error: null,
        version: { Browser: "Hermes", "Protocol-Version": "1.3" },
        versionError: null,
        targetCount: 1,
        targets: [VALID_TARGET],
        targetDiscovery: {
          endpoint: "/json/list",
          available: true,
          reason: "Some Metro targets were malformed and skipped.",
          malformedTargets: [{ index: 1, reason: "Target was not an object.", shape: { type: "string" } }],
        },
        symbolication: {
          available: true,
          endpoint: "/symbolicate",
          status: 200,
          reason: null,
        },
        limitations: LIMITATIONS,
      });
      assert.deepEqual(jsonUrls, [
        "http://127.0.0.1:19000/json/list",
        "http://127.0.0.1:19000/json/version",
      ]);
    });
  });
});

function parseToolJson(result: ToolTextResult): unknown {
  const text = result.content[0]?.text;
  if (typeof text !== "string") return result;
  return JSON.parse(text);
}

function frame(methodName: string, file: string, lineNumber: number, column: number): ComponentStackFrame {
  return { methodName, file, lineNumber, column };
}

function response(ok: boolean, status: number, value: unknown): FetchResponseLike {
  return {
    ok,
    status,
    json: async () => value,
  };
}
