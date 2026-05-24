import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  actionSideEffect,
  boundOutput,
  decideActionPolicy,
  defaultPolicySummary,
  policyCommand,
  policyDeniedPayload,
  redactCommand,
  redactJson,
  redactText,
  requireBridgeConfirmation,
  sanitizeErrorMessage,
  summarizeRunPayload,
  type ToolTextResult,
  truncateSubprocessOutput,
} from "../main/index.js";
import type { JsonValue } from "../main/redactor.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = resolve(".tmp", `policy-redaction-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseToolJson(result: ToolTextResult): unknown {
  return JSON.parse(result.content[0].text);
}

describe("policy-redaction legacy characterization", () => {
  describe("policy decisions", () => {
    it("RULE-001 allows read side-effect policy without an action policy", () => {
      assert.deepEqual(
        decideActionPolicy({ action: "navigation.state", sideEffect: "read" }),
        {
          checked: true,
          action: "navigation.state",
          sideEffect: "read",
          allowed: true,
          source: null,
          reason: "Read action does not require policy approval.",
        },
      );
    });

    it("RULE-001 denies state-changing actions when no policy is present", () => {
      assert.deepEqual(
        decideActionPolicy({ action: "storage.set", sideEffect: "device" }),
        {
          checked: true,
          action: "storage.set",
          sideEffect: "device",
          allowed: false,
          source: null,
          reason: "No action policy allowed this state-changing operation.",
        },
      );
    });

    it("RULE-001 allows exact action matches in allow[]", () => {
      assert.deepEqual(
        decideActionPolicy({
          action: "storage.set",
          sideEffect: "device",
          policy: { allow: ["storage.set"] },
          source: "/tmp/expo-ios-policy.json",
        }),
        {
          checked: true,
          action: "storage.set",
          sideEffect: "device",
          allowed: true,
          source: "/tmp/expo-ios-policy.json",
          reason: "Action allowed by policy.",
        },
      );
    });

    it('RULE-001 allows exact action matches when actions[action] is "allow"', () => {
      assert.deepEqual(
        decideActionPolicy({
          action: "controls.press",
          sideEffect: "device",
          policy: { actions: { "controls.press": "allow" } },
          source: "/tmp/expo-ios-policy.json",
        }),
        {
          checked: true,
          action: "controls.press",
          sideEffect: "device",
          allowed: true,
          source: "/tmp/expo-ios-policy.json",
          reason: "Action allowed by policy.",
        },
      );
    });

    it("RULE-001 allows exact action matches when actions[action] is true", () => {
      assert.deepEqual(
        decideActionPolicy({
          action: "state.load",
          sideEffect: "device",
          policy: { actions: { "state.load": true } },
          source: "/tmp/expo-ios-policy.json",
        }),
        {
          checked: true,
          action: "state.load",
          sideEffect: "device",
          allowed: true,
          source: "/tmp/expo-ios-policy.json",
          reason: "Action allowed by policy.",
        },
      );
    });

    it("RULE-001 denies non-matching action policies", () => {
      assert.deepEqual(
        decideActionPolicy({
          action: "storage.set",
          sideEffect: "device",
          policy: {
            allow: ["storage.get"],
            actions: { "state.load": "allow", "storage.clear": true },
          },
          source: "/tmp/expo-ios-policy.json",
        }),
        {
          checked: true,
          action: "storage.set",
          sideEffect: "device",
          allowed: false,
          source: "/tmp/expo-ios-policy.json",
          reason: "Action policy did not allow this operation.",
        },
      );
    });

    it("RULE-004 denies runtime eval action wait.fn unless explicitly allowed", () => {
      assert.deepEqual(
        decideActionPolicy({ action: "wait.fn", sideEffect: "device" }),
        {
          checked: true,
          action: "wait.fn",
          sideEffect: "device",
          allowed: false,
          source: null,
          reason: "No action policy allowed this state-changing operation.",
        },
      );
    });

    it("RULE-004 allows runtime eval wait.fn through the global allow flag", () => {
      assert.deepEqual(
        decideActionPolicy({ action: "wait.fn", sideEffect: "device", allowRuntimeEval: true }),
        {
          checked: true,
          action: "wait.fn",
          sideEffect: "runtime-eval",
          allowed: true,
          source: "--allow-runtime-eval",
          reason: "Runtime eval allowed by global flag.",
        },
      );
    });

    it("RULE-001 exposes the policy-denied payload boundary", () => {
      const policy = decideActionPolicy({ action: "storage.set", sideEffect: "device" });

      assert.deepEqual(
        policyDeniedPayload({ domain: "storage", action: "set", policy }),
        {
          available: false,
          domain: "storage",
          action: "set",
          source: "policy",
          evidenceSource: "policy",
          code: "policy-denied",
          denied: true,
          reason: "Policy denied action.",
          policy,
        },
      );
    });

    it("preserves the default policy summary shown by policy show without a policy file", () => {
      assert.deepEqual(defaultPolicySummary(), {
        allow: [],
        defaults: {
          read: "allow",
          write: "deny",
          device: "deny",
          runtimeEval: "deny unless --allow-runtime-eval true or an action policy allows the command",
        },
      });
    });

    it("classifies policy check actions with the legacy side-effect regexes", () => {
      for (const action of [
        "doctor",
        "project-info",
        "routes",
        "devices",
        "target.list",
        "target.current",
        "snapshot",
        "refs",
        "get.source",
        "find.text",
        "wait.text",
        "wait.fn",
        "console",
        "errors",
        "logs",
        "metro.status",
        "policy",
        "redact",
        "review",
      ]) {
        assert.equal(actionSideEffect(action), "read", action);
      }

      for (const action of [
        "storage.set",
        "storage.clear",
        "state.load",
        "state.clear",
        "install-app",
        "uninstall-app",
        "set.appearance",
        "unknown.action",
      ]) {
        assert.equal(actionSideEffect(action), "device", action);
      }
    });
  });

  describe("policyCommand command boundary", () => {
    it("shows the default legacy policy summary when no policy file is provided", async () => {
      assert.deepEqual(parseToolJson(await policyCommand({})), {
        available: true,
        action: "show",
        source: null,
        policy: defaultPolicySummary(),
        limitations: [
          "No policy file means read-only commands are allowed and state-changing commands are denied by default.",
        ],
      });
    });

    it("shows a loaded action policy with its resolved source path", async () => {
      await withTempDir(async (dir) => {
        const policyPath = join(dir, "policy.json");
        await writeFile(policyPath, JSON.stringify({ allow: ["storage.set"] }), "utf8");

        assert.deepEqual(parseToolJson(await policyCommand({ action: "show", actionPolicy: policyPath })), {
          available: true,
          action: "show",
          source: resolve(policyPath),
          policy: { allow: ["storage.set"] },
          limitations: [
            "No policy file means read-only commands are allowed and state-changing commands are denied by default.",
          ],
        });
      });
    });

    it("checks read actions without policy approval and preserves the policy source", async () => {
      await withTempDir(async (dir) => {
        const policyPath = join(dir, "policy.json");
        await writeFile(policyPath, JSON.stringify({ allow: [] }), "utf8");

        assert.deepEqual(
          parseToolJson(await policyCommand({
            action: "check",
            subject: "target",
            name: "list",
            actionPolicy: policyPath,
          })),
          {
            available: true,
            action: "check",
            subject: "target",
            name: "list",
            policyAction: "target.list",
            decision: {
              checked: true,
              action: "target.list",
              sideEffect: "read",
              allowed: true,
              source: resolve(policyPath),
              reason: "Read action does not require policy approval.",
            },
          },
        );
      });
    });

    it("checks action subjects directly and applies action-policy allow lists", async () => {
      await withTempDir(async (dir) => {
        const policyPath = join(dir, "policy.json");
        await writeFile(policyPath, JSON.stringify({ allow: ["storage.set"] }), "utf8");

        assert.deepEqual(
          parseToolJson(await policyCommand({
            action: "check",
            subject: "action",
            name: "storage.set",
            actionPolicy: policyPath,
          })),
          {
            available: true,
            action: "check",
            subject: "action",
            name: "storage.set",
            policyAction: "storage.set",
            decision: {
              checked: true,
              action: "storage.set",
              sideEffect: "device",
              allowed: true,
              source: resolve(policyPath),
              reason: "Action allowed by policy.",
            },
          },
        );
      });
    });

    it("rejects unknown policy actions and missing check arguments", async () => {
      await assert.rejects(() => policyCommand({ action: "audit" }), /Unknown policy action: audit/);
      await assert.rejects(() => policyCommand({ action: "check", name: "list" }), /subject must be a non-empty string\./);
      await assert.rejects(() => policyCommand({ action: "check", subject: "target" }), /name must be a non-empty string\./);
    });
  });

  describe("bridge confirmation tokens", () => {
    it("RULE-005 refuses bridge install without bridge-install confirmation", () => {
      assert.deepEqual(
        requireBridgeConfirmation({
          action: "install",
          confirmActions: "bridge-remove",
          status: "absent",
          projectRoot: "/work/app",
          plan: ["create .expo-ios/bridge.json", "create src/expo-ios-devtools-bridge.ts"],
        }),
        {
          available: false,
          action: "install",
          status: "absent",
          projectRoot: "/work/app",
          reason: "Refusing to mutate app files without explicit --confirm-actions bridge-install.",
          requiredConfirmation: "bridge-install",
          plan: ["create .expo-ios/bridge.json", "create src/expo-ios-devtools-bridge.ts"],
        },
      );
    });

    it("RULE-005 accepts comma-separated bridge-remove confirmation", () => {
      assert.deepEqual(
        requireBridgeConfirmation({
          action: "remove",
          confirmActions: " bridge-install, bridge-remove ",
          status: "present",
          projectRoot: "/work/app",
          plan: ["remove .expo-ios/bridge.json", "remove src/expo-ios-devtools-bridge.ts"],
        }),
        null,
      );
    });

    it("RULE-005 refuses bridge remove without bridge-remove confirmation", () => {
      assert.deepEqual(
        requireBridgeConfirmation({
          action: "remove",
          confirmActions: "",
          status: "present",
          projectRoot: "/work/app",
          plan: ["remove .expo-ios/bridge.json", "remove src/expo-ios-devtools-bridge.ts"],
        }),
        {
          available: false,
          action: "remove",
          status: "present",
          projectRoot: "/work/app",
          reason: "Refusing to mutate app files without explicit --confirm-actions bridge-remove.",
          requiredConfirmation: "bridge-remove",
          plan: ["remove .expo-ios/bridge.json", "remove src/expo-ios-devtools-bridge.ts"],
        },
      );
    });
  });

  describe("redaction", () => {
    it("RULE-002 recursively redacts secret object keys and arrays", () => {
      const input: JsonValue = {
        token: "top-secret",
        nested: {
          password: "hunter2",
          safe: "visible",
          list: [
            { authorization: "Bearer abc" },
            { apiKey: "camel", apikey: "flat", api_key: "legacy-preserved" },
          ],
        },
      };

      assert.deepEqual(redactJson(input), {
        token: "[redacted]",
        nested: {
          password: "[redacted]",
          safe: "visible",
          list: [
            { authorization: "[redacted]" },
            { apiKey: "[redacted]", apikey: "[redacted]", api_key: "legacy-preserved" },
          ],
        },
      });
    });

    it("RULE-002 redacts URL query values for cookie token authorization password and secret", () => {
      assert.equal(
        redactText(
          "https://example.test/path?cookie=a&token=b&authorization=c&password=d&secret=e&safe=f",
        ),
        "https://example.test/path?cookie=[redacted]&token=[redacted]&authorization=[redacted]&password=[redacted]&secret=[redacted]&safe=f",
      );
    });

    it("RULE-002 preserves legacy behavior where URL api_key is not redacted", () => {
      assert.equal(
        redactText("https://example.test/path?api_key=visible&token=hidden"),
        "https://example.test/path?api_key=visible&token=[redacted]",
      );
    });

    it("RULE-002 sanitizes error messages through the same redactor", () => {
      assert.equal(
        sanitizeErrorMessage(
          "request failed for https://example.test/callback?token=abc&api_key=visible with password=plain",
        ),
        "request failed for https://example.test/callback?token=[redacted]&api_key=visible with password=plain",
      );
    });

    it("redactCommand redacts JSON files and writes pretty JSON output", async () => {
      await withTempDir(async (dir) => {
        const inputPath = join(dir, "payload.json");
        const outputPath = join(dir, "nested", "redacted.json");
        await writeFile(
          inputPath,
          JSON.stringify({
            token: "secret",
            url: "https://example.test?token=hidden&api_key=visible",
            safe: "kept",
          }),
          "utf8",
        );

        assert.deepEqual(parseToolJson(await redactCommand({ file: inputPath, outputPath })), {
          available: true,
          action: "redact",
          inputPath: resolve(inputPath),
          outputPath: resolve(outputPath),
          redacted: {
            token: "[redacted]",
            url: "https://example.test?token=[redacted]&api_key=visible",
            safe: "kept",
          },
        });

        assert.equal(
          await readFile(outputPath, "utf8"),
          `${JSON.stringify({
            token: "[redacted]",
            url: "https://example.test?token=[redacted]&api_key=visible",
            safe: "kept",
          }, null, 2)}\n`,
        );
      });
    });

    it("redactCommand redacts non-JSON text files and omits outputPath when absent", async () => {
      await withTempDir(async (dir) => {
        const inputPath = join(dir, "raw.txt");
        await writeFile(
          inputPath,
          "open https://example.test/callback?token=secret&safe=yes",
          "utf8",
        );

        assert.deepEqual(parseToolJson(await redactCommand({ file: inputPath })), {
          available: true,
          action: "redact",
          inputPath: resolve(inputPath),
          outputPath: null,
          redacted: "open https://example.test/callback?token=[redacted]&safe=yes",
        });
      });
    });
  });

  describe("run payload summaries and boundaries", () => {
    it("RULE-002 summarizes run payload keys availability routes and event count", () => {
      const payload = {
        available: false,
        routeCount: 3,
        events: [{ id: 1 }, { id: 2 }],
        zed: true,
        alpha: true,
      };

      assert.deepEqual(summarizeRunPayload(payload), {
        keys: ["available", "routeCount", "events", "zed", "alpha"],
        available: false,
        routeCount: 3,
        eventCount: 2,
      });
    });

    it("RULE-002 summarizes non-object run payloads as null", () => {
      assert.equal(summarizeRunPayload("plain text"), null);
      assert.equal(summarizeRunPayload(null), null);
    });

    it("RULE-021 truncates command output with the legacy max-output marker", () => {
      assert.equal(
        boundOutput("0123456789", { maxOutput: 8 }),
        "\n[expo-ios output truncated by --max-output]\n",
      );

      assert.equal(
        boundOutput("0123456789", { maxOutput: 60 }),
        "0123456789",
      );
    });

    it("RULE-021 truncates subprocess output with exact legacy character count", () => {
      assert.equal(
        truncateSubprocessOutput("abcdef", 3),
        "abc\n[truncated 3 characters]",
      );

      assert.equal(truncateSubprocessOutput(null, 3), "");
      assert.equal(truncateSubprocessOutput("abc", 3), "abc");
    });
  });
});
