import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function importSourceModule(name, sourcePath, exportNames) {
  const scratchRoot = resolve(".scratch", "module-tests");
  await mkdir(scratchRoot, { recursive: true });
  const dir = await mkdtemp(resolve(scratchRoot, `${name}-`));
  const entry = resolve(dir, "entry.ts");
  const outfile = resolve(dir, "module.mjs");
  await writeFile(
    entry,
    `export { ${exportNames.join(", ")} } from ${JSON.stringify(resolve(sourcePath))};\n`,
    "utf8",
  );
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    external: ["ws"],
    logLevel: "silent",
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

function parseToolJson(result) {
  return JSON.parse(result.content[0].text);
}

describe("network evidence pure logic", () => {
  it("redacts secret-bearing request data and annotates HAR metadata", async () => {
    const {
      annotateHar,
      harFromNetworkRequests,
      normalizeNetworkEvidence,
      redactNetworkEvidence,
    } = await importSourceModule("network", "src/commands/network-evidence/src/main/index.ts", [
      "annotateHar",
      "harFromNetworkRequests",
      "normalizeNetworkEvidence",
      "redactNetworkEvidence",
    ]);

    const redacted = redactNetworkEvidence({
      requests: [{
        id: "req-1",
        url: "https://api.example.test/items?token=secret&query=ok",
        method: "POST",
        headers: { authorization: "Bearer secret", "x-request-id": "abc" },
        request: { headers: { cookie: "sid=secret" }, postData: "body-secret" },
        response: { status: 200, headers: { "set-cookie": "sid=next", "content-type": "application/json" } },
      }],
    });

    assert.equal(redacted.requests[0].headers.authorization, "[redacted]");
    assert.equal(redacted.requests[0].request.headers.cookie, "[redacted]");
    assert.equal(redacted.requests[0].response.headers["set-cookie"], "[redacted]");
    assert.match(redacted.requests[0].url, /token=/);
    assert.doesNotMatch(redacted.requests[0].url, /secret/);

    const normalized = normalizeNetworkEvidence({ available: true, source: "plugin-bridge", requests: [] }, "requests");
    assert.equal(normalized.available, false);
    assert.equal(normalized.code, "no-observed-traffic");
    assert.equal(normalized.realValidation.state, "partial");

    const har = harFromNetworkRequests(redacted.requests, { now: () => new Date("2026-01-01T00:00:00.000Z") });
    const annotated = annotateHar(har, {
      source: "plugin-bridge",
      transport: null,
      limitations: ["redacted"],
      captureTiming: { startedAt: null, stoppedAt: null, durationMs: null, complete: false },
    });
    assert.equal(annotated.log._expoIos.redaction.bodies, true);
    assert.deepEqual(annotated.log._expoIos.redaction.headers.slice(0, 2), ["authorization", "cookie"]);
  });
});

describe("perf validation pure logic", () => {
  it("distinguishes validated interaction evidence from placeholder-only evidence", async () => {
    const { perfValidation } = await importSourceModule("perf-validation", "src/commands/perf-evidence/src/main/validation.ts", [
      "perfValidation",
    ]);

    const validated = perfValidation({
      available: true,
      requests: [{ durationMs: 80 }],
      renders: { commits: [{ durationMs: 12 }] },
      frames: { samples: [{ deltaMs: 17 }] },
      context: { build: { releaseLike: true, mode: "release" } },
      metrics: [{ name: "interaction.networkDuration", value: 80, confidence: "medium" }],
    }, "interaction");
    assert.equal(validated.state, "validated");
    assert.equal(validated.claimsAllowed.networkLatency, true);
    assert.equal(validated.claimsAllowed.renderCost, true);
    assert.equal(validated.claimsAllowed.frameJank, true);
    assert.equal(validated.claimsAllowed.releasePerformance, true);

    const placeholder = perfValidation({
      available: true,
      metrics: [{ name: "bridge.available", value: 1, confidence: "low" }],
      context: { build: { releaseLike: false, mode: "development" } },
    }, "interaction");
    assert.equal(placeholder.state, "partial");
    assert.equal(placeholder.claimsAllowed.releasePerformance, false);
    assert.ok(placeholder.missingEvidence.some((entry) => entry.signal === "release-like-build"));
  });
});

describe("Hermes CDP URL helpers", () => {
  it("normalizes loopback WebSocket candidates and Metro Origin headers", async () => {
    const {
      loopbackWebSocketCandidates,
      metroOriginForWebSocket,
    } = await importSourceModule("hermes", "src/platform/hermes-cdp-client/src/main/index.ts", [
      "loopbackWebSocketCandidates",
      "metroOriginForWebSocket",
    ]);

    const candidates = loopbackWebSocketCandidates("ws://localhost:8081/inspector/debug?device=1&page=1");
    assert.equal(candidates[0], "ws://localhost:8081/inspector/debug?device=1&page=1");
    assert.ok(candidates.includes("ws://127.0.0.1:8081/inspector/debug?device=1&page=1"));
    assert.ok(candidates.some((candidate) => candidate.includes("[::1]:8081")));
    assert.equal(metroOriginForWebSocket("ws://localhost:19000/inspector"), "http://127.0.0.1:19000");
    assert.equal(metroOriginForWebSocket("not a url"), "http://127.0.0.1");
  });
});

describe("interaction command planning", () => {
  it("plans platform-specific gestures and simulator environment mutations", async () => {
    const {
      gestureCommandPlan,
      setEnvironmentPlan,
    } = await importSourceModule("interaction", "src/commands/interaction-actions/src/main/index.ts", [
      "gestureCommandPlan",
      "setEnvironmentPlan",
    ]);

    const androidTap = gestureCommandPlan({
      platform: "android",
      gesture: "tap",
      coordinates: { x: 10, y: 20 },
      durationMs: 250,
      holdMs: null,
      repeat: 2,
      intervalMs: 100,
    });
    assert.deepEqual(androidTap.command, ["adb", "shell", "input", "tap", "10", "20"]);
    assert.equal(androidTap.repeat, 2);

    const iosSwipe = gestureCommandPlan({
      platform: "ios",
      gesture: "swipe",
      coordinates: { startX: 1, startY: 2, endX: 3, endY: 4 },
      durationMs: 500,
      holdMs: 100,
      repeat: 1,
      intervalMs: 0,
    });
    assert.equal(iosSwipe.tool, "idb");
    assert.ok(iosSwipe.command.includes("--duration"));
    assert.ok(iosSwipe.notes.length > 0);

    const appearance = setEnvironmentPlan("appearance", { value: "dark" }, { udid: "sim-1", name: "iPhone" });
    assert.deepEqual(appearance.command, ["xcrun", "simctl", "ui", "sim-1", "appearance", "dark"]);
    assert.throws(() => setEnvironmentPlan("appearance", { value: "sepia" }, { udid: "sim-1" }), /appearance must be dark or light/);
  });
});

describe("policy gate negative paths", () => {
  it("keeps policy decisions fail-closed for device, write, and runtime-eval actions", async () => {
    const { decideActionPolicy } = await importSourceModule("policy", "src/core/policy-redaction/src/main/policy-service.ts", [
      "decideActionPolicy",
    ]);

    assert.equal(decideActionPolicy({ action: "devices", sideEffect: "read" }).allowed, true);
    assert.equal(decideActionPolicy({ action: "open-url", sideEffect: "device" }).allowed, false);
    assert.equal(decideActionPolicy({
      action: "open-url",
      sideEffect: "device",
      policy: { allow: ["state.save"] },
      source: "policy.json",
    }).allowed, false);
    assert.equal(decideActionPolicy({
      action: "open-url",
      sideEffect: "device",
      policy: { actions: { "open-url": "allow" } },
      source: "policy.json",
    }).allowed, true);
    assert.equal(decideActionPolicy({ action: "wait.fn", sideEffect: "runtime-eval" }).allowed, false);
    assert.equal(decideActionPolicy({ action: "wait.fn", sideEffect: "runtime-eval", allowRuntimeEval: true }).allowed, true);
  });

  it("denies route mutations before touching fake executors and allows explicit policy", async () => {
    const { openUrl } = await importSourceModule("route-policy", "src/commands/route-url-actions/src/main/index.ts", [
      "openUrl",
    ]);
    let execCalls = 0;
    const execFile = async () => {
      execCalls += 1;
      return { stdout: "ok", stderr: "" };
    };

    const denied = parseToolJson(await openUrl({ platform: "android", url: "exp://example.test" }, { execFile }));
    assert.equal(denied.code, "policy-denied");
    assert.equal(denied.denied, true);
    assert.equal(execCalls, 0);

    const allowed = parseToolJson(await openUrl({
      platform: "android",
      url: "exp://example.test",
      actionPolicy: "policy.json",
    }, {
      execFile,
      resolvePath: (file) => `/tmp/${file}`,
      readJsonFile: async () => ({ allow: ["open-url"] }),
    }));
    assert.equal(execCalls, 1);
    assert.equal(allowed.platform, "android");
    assert.equal(allowed.stderr, "");
  });

  it("denies app lifecycle mutations before device resolution or subprocess execution", async () => {
    const { bootSimulator } = await importSourceModule("app-policy", "src/commands/app-lifecycle-actions/src/main/index.ts", [
      "bootSimulator",
    ]);
    let resolvedDevice = false;
    let execCalls = 0;
    const deniedPolicy = {
      checked: true,
      action: "boot-simulator",
      sideEffect: "device",
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation.",
    };

    const payload = await bootSimulator({}, {
      execFile: async () => {
        execCalls += 1;
        return {};
      },
      resolveIosDevice: async () => {
        resolvedDevice = true;
        return { udid: "sim-1", name: "iPhone", state: "Booted" };
      },
      wait: async () => {},
      now: () => 0,
      policyDecision: async () => deniedPolicy,
      runtimeSummary: async () => null,
      listDiagnosticReports: async () => [],
    });

    assert.equal(payload.code, "policy-denied");
    assert.equal(payload.denied, true);
    assert.equal(resolvedDevice, false);
    assert.equal(execCalls, 0);
  });

  it("denies bridge-backed writes before Metro/Hermes and executes allowed state writes", async () => {
    const {
      stateCommand,
      storageCommand,
    } = await importSourceModule("bridge-policy", "src/commands/bridge-domain-actions/src/main/index.ts", [
      "stateCommand",
      "storageCommand",
    ]);
    let metroCalls = 0;
    let evalCalls = 0;
    const deps = {
      metroTargets: async () => {
        metroCalls += 1;
        return [{ webSocketDebuggerUrl: "ws://localhost:8081/debug", id: "target-1" }];
      },
      evaluateHermesExpression: async () => {
        evalCalls += 1;
        return { result: { result: { value: { available: true, result: { ok: true } } } } };
      },
      resolvePath: (file) => `/tmp/${file}`,
      readJsonFile: async () => ({ allow: ["state.save"] }),
    };

    const denied = parseToolJson(await storageCommand({ store: "async-storage", action: "set", key: "theme", value: "{}" }, deps));
    assert.equal(denied.code, "policy-denied");
    assert.equal(denied.policy.allowed, false);
    assert.equal(metroCalls, 0);
    assert.equal(evalCalls, 0);

    const allowed = parseToolJson(await stateCommand({ action: "save", name: "checkpoint", actionPolicy: "policy.json" }, deps));
    assert.equal(allowed.available, true);
    assert.equal(allowed.policy.allowed, true);
    assert.equal(metroCalls, 1);
    assert.equal(evalCalls, 1);
  });

  it("denies modal mutations before Metro/Hermes and allows explicit dialog policy", async () => {
    const { dialogCommand, sheetCommand } = await importSourceModule("modal-policy", "src/commands/modal-blocker-actions/src/main/index.ts", [
      "dialogCommand",
      "sheetCommand",
    ]);
    let metroCalls = 0;
    let evalCalls = 0;
    const deps = {
      metroTargets: async () => {
        metroCalls += 1;
        return [{ webSocketDebuggerUrl: "ws://localhost:8081/debug", id: "target-1" }];
      },
      evaluateHermesExpression: async () => {
        evalCalls += 1;
        return { result: { result: { value: { available: true, result: { dismissed: true } } } } };
      },
      resolvePath: (file) => `/tmp/${file}`,
      readJsonFile: async () => ({ allow: ["dialog.dismiss"] }),
    };

    const denied = parseToolJson(await sheetCommand({ action: "dismiss" }, deps));
    assert.equal(denied.code, "policy-denied");
    assert.equal(denied.policy.action, "sheet.dismiss");
    assert.equal(metroCalls, 0);
    assert.equal(evalCalls, 0);

    const allowed = parseToolJson(await dialogCommand({ action: "dismiss", actionPolicy: "policy.json" }, deps));
    assert.equal(allowed.available, true);
    assert.equal(allowed.policy.allowed, true);
    assert.equal(metroCalls, 1);
    assert.equal(evalCalls, 1);
  });
});
