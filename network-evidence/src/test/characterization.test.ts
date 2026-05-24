import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  annotateHar,
  clampNumber,
  harFromNetworkRequests,
  networkCaptureTiming,
  networkCommand,
  networkExpression,
  networkLimitations,
  networkTransport,
  networkUnavailable,
  normalizeNetworkEvidence,
  redactNetworkEvidence,
  targetSummary,
} from "../main/index.js";
import type {
  NetworkCaptureTiming,
  NetworkCommandDependencies,
  NetworkEvidencePayload,
  NetworkRequest,
  NetworkTarget,
  NetworkTargetSummary,
  NetworkTransport,
  ToolTextResult,
} from "../main/index.js";

const REDACTED = "[redacted]";

const BASE_LIMITATIONS = [
  "Network evidence is limited to traffic observed by the selected React Native DevTools or app bridge network domain.",
  "Headers, cookies, credentials, request bodies, and response bodies are redacted before stdout and artifact writes.",
];

const UNAVAILABLE_LIMITATIONS = [
  "Network evidence requires dev-only app instrumentation that patches fetch/XHR or an equivalent app network adapter.",
  "Native networking stacks are unavailable unless the app exposes them through the bridge.",
];

const TARGET: NetworkTarget = {
  id: "target-1",
  title: "Expo Go",
  description: "",
  appId: "host.exp.Exponent",
  deviceName: "iPhone 15",
  devtoolsFrontendUrl: "http://127.0.0.1:8081/debugger-ui",
  webSocketDebuggerUrl: "ws://127.0.0.1:8081/inspector/debug?device=iPhone",
  reactNative: { logicalDeviceId: "device-1" },
};

const TARGET_SUMMARY: NetworkTargetSummary = {
  id: "target-1",
  title: "Expo Go",
  description: "",
  appId: "host.exp.Exponent",
  deviceName: "iPhone 15",
  devtoolsFrontendUrl: "http://127.0.0.1:8081/debugger-ui",
  webSocketDebuggerUrl: "ws://127.0.0.1:8081/inspector/debug?device=iPhone",
  reactNative: { logicalDeviceId: "device-1" },
  capabilities: {
    hermesRuntime: true,
    devtoolsFrontend: true,
    reactNative: true,
  },
};

const SECRET_REQUEST: NetworkRequest = {
  id: "req-1",
  method: "POST",
  url: "https://user:pass@api.example.test/customers?token=secret-token&status=open&api_key=secret-key",
  startedAt: "2026-05-22T10:00:00.000Z",
  durationMs: 42,
  headers: {
    authorization: "Bearer secret-token",
    cookie: "sid=secret-cookie",
    accept: "application/json",
    "x-api-key": "secret-key",
  },
  request: {
    method: "POST",
    url: "https://api.example.test/customers?session=secret-session&status=open",
    headers: {
      token: "secret-token",
      accept: "application/json",
    },
    cookies: [{ name: "sid", value: "secret-cookie" }],
    body: "{\"password\":\"secret-password\"}",
    postData: "password=secret-password",
    content: { mimeType: "application/json", text: "{\"password\":\"secret-password\"}" },
  },
  response: {
    status: 200,
    statusText: "OK",
    headers: {
      "set-cookie": "sid=secret-cookie",
      "content-type": "application/json",
    },
    cookies: [{ name: "sid", value: "secret-cookie" }],
    body: "{\"token\":\"secret-token\"}",
    content: { mimeType: "application/json", text: "{\"token\":\"secret-token\"}" },
  },
};

describe("network-evidence legacy characterization", () => {
  describe("command validation and numeric bounds", () => {
    it("rejects unknown network actions and unknown HAR sub-actions with legacy messages", async () => {
      await assert.rejects(() => networkCommand({ action: "metrics" }), /Unknown network action: metrics/);
      await assert.rejects(() => networkCommand({ action: "   " }), /action must be a non-empty string\./);
      await assert.rejects(() => networkCommand({ action: "har", harAction: "archive" }), /Unknown network HAR action: archive/);
      await assert.rejects(() => networkCommand({ action: "har", harAction: " " }), /harAction must be a non-empty string\./);
    });

    it("clamps finite Metro port and request limit values to legacy ranges", async () => {
      assert.equal(clampNumber(0, 1, 65535), 1);
      assert.equal(clampNumber("65536", 1, 65535), 65535);
      assert.equal(clampNumber("7", 1, 1000), 7);
      assert.equal(clampNumber(2000, 1, 1000), 1000);
      assert.throws(() => clampNumber("NaNish", 1, 65535), /Expected a finite number, got NaNish\./);

      const metroPorts: number[] = [];
      const expressions: string[] = [];
      const deps: NetworkCommandDependencies = {
        metroTargets: async (metroPort) => {
          metroPorts.push(metroPort);
          return [TARGET];
        },
        evaluateHermesExpression: async (_webSocketDebuggerUrl, expression) => {
          expressions.push(expression);
          return { result: { result: { value: { available: true, source: "plugin-bridge", requests: [publicRequest()] } } } };
        },
      };

      parseToolJson(await networkCommand({ action: "requests", metroPort: 0, limit: 2000 }, deps));
      parseToolJson(await networkCommand({ action: "request", requestId: "req-1", metroPort: 70000, limit: 0 }, deps));

      assert.deepEqual(metroPorts, [1, 65535]);
      assert.equal(expressions.length, 2);
      assert.match(expressions[0] ?? "", /const limit = 1000;/);
      assert.match(expressions[1] ?? "", /const limit = 1;/);
      assert.match(expressions[1] ?? "", /const requestId = "req-1";/);
    });
  });

  describe("runtime availability and transport envelopes", () => {
    it("returns no-runtime-target unavailable evidence when Metro has no Hermes target", async () => {
      const payload = parseToolJson(await networkCommand({
        action: "status",
        metroPort: 19000,
      }, {
        metroTargets: async () => [
          { id: "metadata-only", title: "No runtime", webSocketDebuggerUrl: null },
        ],
      }));

      assert.deepEqual(payload, {
        available: false,
        action: "status",
        source: "runtime-target",
        evidenceSource: "unavailable",
        code: "no-runtime-target",
        reason: "No Metro inspector target.",
        metroPort: 19000,
        target: null,
        transport: {
          name: "metro-inspector-hermes-cdp",
          metroPort: 19000,
          protocol: "Runtime.evaluate",
          target: null,
          cdp: null,
        },
        requests: [],
        limitations: UNAVAILABLE_LIMITATIONS,
      });
    });

    it("returns transport-failure unavailable evidence when Hermes returns no runtime value", async () => {
      const payload = parseToolJson(await networkCommand({
        action: "requests",
        metroPort: 19001,
      }, {
        metroTargets: async () => [TARGET],
        evaluateHermesExpression: async () => ({
          error: "Runtime.evaluate failed.",
          diagnostics: { sessionId: "cdp-session-1", closeCode: 1006 },
        }),
      }));

      assert.deepEqual(payload, {
        available: false,
        action: "requests",
        source: "app-instrumentation",
        evidenceSource: "unavailable",
        code: "transport-failure",
        reason: "Runtime.evaluate failed.",
        metroPort: 19001,
        target: TARGET_SUMMARY,
        transport: {
          name: "metro-inspector-hermes-cdp",
          metroPort: 19001,
          protocol: "Runtime.evaluate",
          target: TARGET_SUMMARY,
          cdp: { sessionId: "cdp-session-1", closeCode: 1006 },
        },
        requests: [],
        limitations: UNAVAILABLE_LIMITATIONS,
      });
    });

    it("networkUnavailable uses unavailable evidenceSource and default Hermes transport metadata", () => {
      assert.deepEqual(networkUnavailable({
        action: "har-stop",
        metroPort: 8081,
        code: "no-bridge-domain",
        source: "app-instrumentation",
        reason: "Network bridge is not installed.",
        target: TARGET_SUMMARY,
      }), {
        available: false,
        action: "har-stop",
        source: "app-instrumentation",
        evidenceSource: "unavailable",
        code: "no-bridge-domain",
        reason: "Network bridge is not installed.",
        metroPort: 8081,
        target: TARGET_SUMMARY,
        transport: {
          name: "metro-inspector-hermes-cdp",
          metroPort: 8081,
          protocol: "Runtime.evaluate",
          target: TARGET_SUMMARY,
          cdp: null,
        },
        requests: [],
        limitations: UNAVAILABLE_LIMITATIONS,
      });
    });
  });

  describe("runtime expression generation", () => {
    it("embeds action, request id, limit, bridge version, and all legacy network bridge lookup paths", () => {
      const expression = networkExpression({ action: "request", requestId: "req-1", limit: 5 });

      assert.match(expression, /const action = "request";/);
      assert.match(expression, /const requestId = "req-1";/);
      assert.match(expression, /const limit = 5;/);
      assert.match(expression, /const expectedBridgeVersion = "1\.0\.0";/);
      assert.match(expression, /__EXPO_IOS_DEVTOOLS_BRIDGE__/);
      assert.match(expression, /__EXPO_IOS_PLUGIN_BRIDGE__/);
      assert.match(expression, /__ROZENITE_AGENT_BRIDGE__/);
      assert.match(expression, /__REACT_NATIVE_DEVTOOLS_NETWORK__/);
      assert.match(expression, /__RN_DEVTOOLS_NETWORK__/);
      assert.match(expression, /__REACT_DEVTOOLS_NETWORK__/);
      assert.match(expression, /__EXPO_IOS_NETWORK_BRIDGE__/);
      assert.match(expression, /__EXPO_IOS_INSTRUMENTATION__/);
      assert.match(expression, /callTool\('network\.' \+ name, payload\)/);
      assert.match(expression, /return Array\.isArray\(raw\) \? raw\.slice\(-limit\) : raw;/);
      assert.match(expression, /code: 'version-mismatch'/);
    });

    it("generates HAR-specific runtime actions and no request id when omitted", () => {
      const expression = networkExpression({ action: "har-stop", limit: 100 });

      assert.match(expression, /const action = "har-stop";/);
      assert.match(expression, /const requestId = null;/);
      assert.match(expression, /if \(action === 'har-start'\)/);
      assert.match(expression, /if \(action === 'har-stop'\)/);
      assert.match(expression, /startedAt: new Date\(\)\.toISOString\(\)/);
      assert.match(expression, /stoppedAt: new Date\(\)\.toISOString\(\)/);
    });
  });

  describe("normalization", () => {
    it("marks non-object runtime payloads as malformed", () => {
      assert.deepEqual(normalizeNetworkEvidence(null, "status"), {
        available: false,
        action: "status",
        source: "runtime",
        code: "malformed-payload",
        reason: "Network runtime returned a malformed payload.",
        requests: [],
      });
      assert.deepEqual(normalizeNetworkEvidence(["not", "object"], "requests"), {
        available: false,
        action: "requests",
        source: "runtime",
        code: "malformed-payload",
        reason: "Network runtime returned a malformed payload.",
        requests: [],
      });
    });

    it("marks malformed request lists and empty observed traffic as unavailable evidence", () => {
      assert.deepEqual(normalizeNetworkEvidence({
        available: true,
        source: "plugin-bridge",
        requests: "not-an-array",
      }, "requests"), {
        available: false,
        source: "plugin-bridge",
        action: "requests",
        code: "malformed-payload",
        reason: "Network runtime returned a malformed request list.",
        requests: [],
      });

      assert.deepEqual(normalizeNetworkEvidence({
        available: true,
        source: "plugin-bridge",
        requests: [],
      }, "requests"), {
        available: false,
        source: "plugin-bridge",
        requests: [],
        action: "requests",
        code: "no-observed-traffic",
        reason: "No network traffic was observed by the selected upstream/bridge path.",
      });

      assert.deepEqual(normalizeNetworkEvidence({
        available: true,
        source: "react-native-devtools-network",
        requests: [],
      }, "har-stop"), {
        available: false,
        source: "react-native-devtools-network",
        requests: [],
        action: "har-stop",
        code: "no-observed-traffic",
        reason: "No network traffic was observed by the selected upstream/bridge path.",
      });
    });

    it("does not convert empty requests for actions that legacy treats as status-like", () => {
      assert.deepEqual(normalizeNetworkEvidence({
        available: true,
        source: "plugin-bridge",
        requests: [],
      }, "status"), {
        available: true,
        source: "plugin-bridge",
        requests: [],
      });
    });
  });

  describe("redaction", () => {
    it("redacts request URL credentials, sensitive query values, headers, cookies, bodies, postData, and content text", () => {
      const redacted = redactNetworkEvidence({
        available: true,
        source: "plugin-bridge",
        requests: [SECRET_REQUEST],
        request: SECRET_REQUEST,
      }) as unknown as NetworkEvidencePayload;

      assert.deepEqual(redacted.requests?.[0]?.headers, {
        authorization: REDACTED,
        cookie: REDACTED,
        accept: "application/json",
        "x-api-key": REDACTED,
      });
      assert.equal(redacted.requests?.[0]?.request?.headers?.token, REDACTED);
      assert.equal(redacted.requests?.[0]?.request?.headers?.accept, "application/json");
      assert.equal(redacted.requests?.[0]?.request?.cookies, REDACTED);
      assert.equal(redacted.requests?.[0]?.request?.body, REDACTED);
      assert.equal(redacted.requests?.[0]?.request?.postData, REDACTED);
      assert.equal(redacted.requests?.[0]?.request?.content?.text, REDACTED);
      assert.equal(redacted.requests?.[0]?.response?.headers?.["set-cookie"], REDACTED);
      assert.equal(redacted.requests?.[0]?.response?.body, REDACTED);
      assert.equal(redacted.requests?.[0]?.response?.content?.text, REDACTED);
      assert.match(redacted.requests?.[0]?.url ?? "", /token=%5Bredacted%5D/);
      assert.match(redacted.requests?.[0]?.url ?? "", /api_key=%5Bredacted%5D/);
      assert.match(redacted.requests?.[0]?.url ?? "", /status=open/);
      assert.match(redacted.requests?.[0]?.url ?? "", /https:\/\/%5Bredacted%5D:%5Bredacted%5D@api\.example\.test/);
      assert.doesNotMatch(JSON.stringify(redacted), /secret-token|secret-cookie|secret-password|secret-session|secret-key/);
    });

    it("falls back to regex query redaction for invalid URL strings", () => {
      const redacted = redactNetworkEvidence({
        requests: [{ url: "/relative/path?session=secret-session&status=open&password=secret-password" }],
      }) as unknown as NetworkEvidencePayload;

      assert.equal(redacted.requests?.[0]?.url, "/relative/path?session=[redacted]&status=open&password=[redacted]");
    });

    it("redacts HAR entries before artifact writes", () => {
      const har = {
        log: {
          version: "1.2",
          creator: { name: "fixture", version: "1" },
          entries: [{
            request: {
              method: "POST",
              url: SECRET_REQUEST.url,
              headers: SECRET_REQUEST.headers,
              cookies: [{ name: "sid", value: "secret-cookie" }],
              postData: "token=secret-token",
            },
            response: {
              status: 200,
              headers: SECRET_REQUEST.response?.headers,
              cookies: [{ name: "sid", value: "secret-cookie" }],
              content: { text: "{\"token\":\"secret-token\"}" },
            },
          }],
        },
      };

      const redacted = redactNetworkEvidence({ available: true, har }) as NetworkEvidencePayload;
      const redactedHar = redacted.har as { log?: { entries?: Array<{ request?: Record<string, unknown>; response?: Record<string, unknown> }> } };

      assert.deepEqual(redactedHar.log?.entries?.[0]?.request?.headers, {
        authorization: REDACTED,
        cookie: REDACTED,
        accept: "application/json",
        "x-api-key": REDACTED,
      });
      assert.equal(redactedHar.log?.entries?.[0]?.request?.cookies, REDACTED);
      assert.equal(redactedHar.log?.entries?.[0]?.request?.postData, REDACTED);
      assert.deepEqual(redactedHar.log?.entries?.[0]?.response?.content, { text: REDACTED });
      assert.doesNotMatch(JSON.stringify(redacted), /secret-token|secret-cookie|secret-key/);
    });

    it("redacts HAR-standard header arrays and top-level request body fields", () => {
      const payload = redactNetworkEvidence({
        requests: [{
          url: "https://api.example.test/orders?token=secret-token",
          headers: [{ name: "Authorization", value: "Bearer secret-token" }, { name: "Accept", value: "application/json" }],
          cookies: [{ name: "sid", value: "secret-cookie" }],
          body: "{\"token\":\"secret-token\"}",
          postData: "token=secret-token",
          content: { text: "{\"token\":\"secret-token\"}" },
        }],
        har: {
          log: {
            entries: [{
              request: {
                url: "https://api.example.test/orders?token=secret-token",
                headers: [{ name: "Cookie", value: "sid=secret-cookie" }, { name: "Accept", value: "application/json" }],
              },
              response: {
                headers: [{ name: "Set-Cookie", value: "sid=secret-cookie" }, { name: "Content-Type", value: "application/json" }],
              },
            }],
          },
        },
      }) as unknown as NetworkEvidencePayload;

      assert.deepEqual(payload.requests?.[0]?.headers, [
        { name: "Authorization", value: REDACTED },
        { name: "Accept", value: "application/json" },
      ]);
      assert.equal(payload.requests?.[0]?.cookies, REDACTED);
      assert.equal(payload.requests?.[0]?.body, REDACTED);
      assert.equal(payload.requests?.[0]?.postData, REDACTED);
      assert.deepEqual(payload.requests?.[0]?.content, { text: REDACTED });
      const har = payload.har as { log?: { entries?: Array<{ request?: NetworkRequest; response?: NetworkRequest }> } };
      assert.deepEqual(har.log?.entries?.[0]?.request?.headers, [
        { name: "Cookie", value: REDACTED },
        { name: "Accept", value: "application/json" },
      ]);
      assert.deepEqual(har.log?.entries?.[0]?.response?.headers, [
        { name: "Set-Cookie", value: REDACTED },
        { name: "Content-Type", value: "application/json" },
      ]);
      assert.doesNotMatch(JSON.stringify(payload), /secret-token|secret-cookie/);
    });
  });

  describe("adapter boundaries", () => {
    it("requires explicit Metro and Hermes adapters instead of silently reporting no runtime target", async () => {
      await assert.rejects(() => networkCommand({ action: "status" }), /networkCommand requires a metroTargets adapter\./);
      await assert.rejects(() => networkCommand({ action: "status" }, {
        metroTargets: async () => [TARGET],
      }), /networkCommand requires an evaluateHermesExpression adapter\./);
    });
  });

  describe("transport, limitations, timing, and HAR helpers", () => {
    it("networkTransport records the Hermes Runtime.evaluate route and summarized target", () => {
      assert.deepEqual(networkTransport(19000, TARGET, { sessionId: "cdp-1" }), {
        name: "metro-inspector-hermes-cdp",
        metroPort: 19000,
        protocol: "Runtime.evaluate",
        target: TARGET_SUMMARY,
        cdp: { sessionId: "cdp-1" },
      });
      assert.equal(targetSummary(null), null);
    });

    it("networkLimitations adds app-instrumentation and no-observed-traffic caveats when applicable", () => {
      assert.deepEqual(networkLimitations({ available: true, source: "plugin-bridge" }), BASE_LIMITATIONS);
      assert.deepEqual(networkLimitations({
        available: false,
        source: "app-instrumentation",
        code: "no-observed-traffic",
      }), [
        ...BASE_LIMITATIONS,
        "Legacy app instrumentation was used because no upstream DevTools or plugin bridge network domain was available.",
        "No observed traffic is not proof that the app made no native network requests outside the selected domain.",
      ]);
    });

    it("networkCaptureTiming derives times from request arrays, single request detail, and clock fallback", () => {
      const clock = fixedClock("2026-05-23T12:34:56.789Z");

      assert.deepEqual(networkCaptureTiming({
        requests: [
          { startedAt: "2026-05-22T10:00:03.000Z" },
          { startedAt: "2026-05-22T10:00:01.000Z" },
        ],
        stoppedAt: "2026-05-22T10:00:05.000Z",
      }, clock), {
        startedAt: "2026-05-22T10:00:01.000Z",
        stoppedAt: "2026-05-22T10:00:05.000Z",
        observedRequestCount: 2,
      });

      assert.deepEqual(networkCaptureTiming({
        request: { startedAt: "2026-05-22T11:00:00.000Z" },
      }, clock), {
        startedAt: "2026-05-22T11:00:00.000Z",
        stoppedAt: "2026-05-23T12:34:56.789Z",
        observedRequestCount: 1,
      });

      assert.deepEqual(networkCaptureTiming({}, clock), {
        startedAt: null,
        stoppedAt: "2026-05-23T12:34:56.789Z",
        observedRequestCount: 0,
      });
    });

    it("annotateHar writes expo-ios metadata and declared redaction policy", () => {
      const timing: NetworkCaptureTiming = {
        startedAt: "2026-05-22T10:00:00.000Z",
        stoppedAt: "2026-05-22T10:00:05.000Z",
        observedRequestCount: 1,
      };
      const transport = networkTransport(19000, TARGET, null);
      const annotated = annotateHar({ log: { version: "1.2", creator: { name: "fixture", version: "1" }, entries: [] } }, {
        source: "plugin-bridge",
        transport,
        limitations: BASE_LIMITATIONS,
        captureTiming: timing,
      }) as { log?: { _expoIos?: Record<string, unknown> } };

      assert.deepEqual(annotated.log?._expoIos, {
        source: "plugin-bridge",
        transport,
        limitations: BASE_LIMITATIONS,
        captureTiming: timing,
        redaction: {
          headers: ["authorization", "cookie", "set-cookie", "token", "secret", "api-key"],
          bodies: true,
          query: ["token", "secret", "key", "password", "auth", "session", "cookie"],
        },
      });
    });

    it("harFromNetworkRequests converts observed request evidence into HAR entries with legacy defaults", () => {
      const har = harFromNetworkRequests([{
        startedAt: "2026-05-22T10:00:00.000Z",
        durationMs: 42,
        method: "POST",
        url: "https://api.example.test/customers",
        headers: { accept: "application/json" },
        response: {
          status: 201,
          statusText: "Created",
          headers: { "content-type": "application/json" },
          mimeType: "application/json",
          body: "{\"ok\":true}",
        },
      }]) as { log?: { version?: string; creator?: unknown; entries?: Array<Record<string, unknown>> } };

      assert.equal(har.log?.version, "1.2");
      assert.deepEqual(har.log?.creator, { name: "expo-ios", version: "0.1.0" });
      assert.deepEqual(har.log?.entries?.[0], {
        startedDateTime: "2026-05-22T10:00:00.000Z",
        time: 42,
        request: {
          method: "POST",
          url: "https://api.example.test/customers",
          headers: { accept: "application/json" },
          queryString: [],
          cookies: [],
        },
        response: {
          status: 201,
          statusText: "Created",
          headers: { "content-type": "application/json" },
          cookies: [],
          content: { size: 0, mimeType: "application/json", text: "{\"ok\":true}" },
        },
      });
    });
  });

  describe("successful command payload and HAR stop artifact writes", () => {
    it("redacts valid runtime evidence and adds action, target, transport, limitations, and timing", async () => {
      const payload = parseToolJson(await networkCommand({
        action: "requests",
        metroPort: 19002,
      }, {
        metroTargets: async () => [TARGET],
        evaluateHermesExpression: async () => ({
          result: {
            result: {
              value: {
                available: true,
                source: "plugin-bridge",
                domain: "network",
                bridgeVersion: "1.0.0",
                requests: [SECRET_REQUEST],
              },
            },
          },
          diagnostics: { sessionId: "cdp-session-2" },
        }),
        clock: fixedClock("2026-05-23T12:34:56.789Z"),
      }));

      assert.equal(payload.available, true);
      assert.equal(payload.action, "requests");
      assert.equal(payload.metroPort, 19002);
      assert.deepEqual(payload.target, TARGET_SUMMARY);
      assert.deepEqual(payload.transport, {
        name: "metro-inspector-hermes-cdp",
        metroPort: 19002,
        protocol: "Runtime.evaluate",
        target: TARGET_SUMMARY,
        cdp: { sessionId: "cdp-session-2" },
      });
      assert.equal(payload.evidenceSource, "plugin-bridge");
      assert.deepEqual(payload.limitations, BASE_LIMITATIONS);
      assert.deepEqual(payload.captureTiming, {
        startedAt: "2026-05-22T10:00:00.000Z",
        stoppedAt: "2026-05-23T12:34:56.789Z",
        observedRequestCount: 1,
      });
      assert.doesNotMatch(JSON.stringify(payload), /secret-token|secret-cookie|secret-password|secret-session|secret-key/);
    });

    it("har-stop writes a redacted HAR artifact through injected fs, clock, and path dependencies", async () => {
      const mkdirCalls: Array<{ path: string; recursive: true }> = [];
      const writes: Array<{ path: string; value: unknown }> = [];
      const deps: NetworkCommandDependencies = {
        metroTargets: async () => [TARGET],
        evaluateHermesExpression: async () => ({
          result: {
            result: {
              value: {
                available: true,
                source: "plugin-bridge",
                domain: "network",
                bridgeVersion: "1.0.0",
                requests: [SECRET_REQUEST],
                stoppedAt: "2026-05-22T10:00:45.000Z",
              },
            },
          },
          diagnostics: { sessionId: "cdp-session-3" },
        }),
        clock: fixedClock("2026-05-23T12:34:56.789Z"),
        resolveExpoStateRoot: () => "/state-root",
        path: {
          join: (...segments) => segments.join("/"),
          resolve: (filePath) => `/resolved${filePath.startsWith("/") ? "" : "/"}${filePath}`,
          dirname: (filePath) => filePath.slice(0, filePath.lastIndexOf("/")),
        },
        fileSystem: {
          mkdir: async (path, options) => {
            mkdirCalls.push({ path, recursive: options.recursive });
          },
          writeJsonFile: async (path, value) => {
            writes.push({ path, value });
          },
        },
      };

      const payload = parseToolJson(await networkCommand({
        action: "har",
        harAction: "stop",
        metroPort: 19003,
      }, deps));

      assert.equal(payload.action, "har-stop");
      assert.equal(payload.artifact, "/resolved/state-root/artifacts/network-2026-05-23T12-34-56-789Z.har");
      assert.deepEqual(mkdirCalls, [{ path: "/resolved/state-root/artifacts", recursive: true }]);
      assert.equal(writes.length, 1);
      assert.equal(writes[0]?.path, "/resolved/state-root/artifacts/network-2026-05-23T12-34-56-789Z.har");
      assert.deepEqual(payload.captureTiming, {
        startedAt: "2026-05-22T10:00:00.000Z",
        stoppedAt: "2026-05-22T10:00:45.000Z",
        observedRequestCount: 1,
      });
      assert.deepEqual((payload.har as { log?: { _expoIos?: Record<string, unknown> } }).log?._expoIos?.source, "plugin-bridge");
      assert.deepEqual((writes[0]?.value as { log?: { _expoIos?: Record<string, unknown> } }).log?._expoIos?.transport, {
        name: "metro-inspector-hermes-cdp",
        metroPort: 19003,
        protocol: "Runtime.evaluate",
        target: TARGET_SUMMARY,
        cdp: { sessionId: "cdp-session-3" },
      });
      assert.doesNotMatch(JSON.stringify(payload), /secret-token|secret-cookie|secret-password|secret-session|secret-key/);
      assert.doesNotMatch(JSON.stringify(writes[0]?.value), /secret-token|secret-cookie|secret-password|secret-session|secret-key/);
    });
  });
});

function parseToolJson(result: ToolTextResult): NetworkEvidencePayload {
  return JSON.parse(result.content[0]?.text ?? "{}") as NetworkEvidencePayload;
}

function publicRequest(): NetworkRequest {
  return {
    id: "req-public",
    method: "GET",
    url: "https://api.example.test/public",
    startedAt: "2026-05-22T10:00:00.000Z",
    durationMs: 12,
    response: { status: 200, statusText: "OK" },
  };
}

function fixedClock(iso: string): { now(): Date } {
  return {
    now: () => new Date(iso),
  };
}
