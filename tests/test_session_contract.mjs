import assert from "node:assert/strict";
import { test } from "node:test";

function analyzeSessionJsonl(jsonl) {
  const findings = {
    mentionsCli: false,
    localDevEvidenceTask: false,
    directCliCalls: 0,
    forbidden: [],
  };

  for (const [index, line] of jsonl.trim().split(/\n/).entries()) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const payload = row.payload ?? {};
    const lineNumber = index + 1;

    if (payload.type === "message") {
      const text = messageText(payload);
      if (/expo-ios|expo98/i.test(text)) findings.mentionsCli = true;
      if (/review the screen|screen.*audit|currently open|screenshot|ux-context|simulator|local-dev evidence/i.test(text)) {
        findings.localDevEvidenceTask = true;
      }
      if (/MCP servers from this plugin available|xcodebuildmcp/i.test(text)) {
        findings.forbidden.push({ line: lineNumber, reason: "MCP server capability was exposed" });
      }
      continue;
    }

    if (payload.type !== "function_call") continue;

    const namespace = payload.namespace ?? "";
    const name = payload.name ?? "";
    const args = parseArguments(payload.arguments);
    const command = typeof args.cmd === "string" ? args.cmd : "";

    if (name === "exec_command" && /\bexpo-ios\s+--json\b/.test(command)) {
      findings.directCliCalls += 1;
    }
    if (/mcp__xcodebuildmcp__/i.test(namespace) || /xcodebuildmcp/i.test(name)) {
      findings.forbidden.push({ line: lineNumber, reason: `used ${namespace || name}` });
    }
    if (/\b(tool-call|mcp-tools|xcodebuildmcp)\b/i.test(command)) {
      findings.forbidden.push({ line: lineNumber, reason: "used removed adapter command" });
    }
  }

  return findings;
}

function assertCliOnlySession(jsonl) {
  const findings = analyzeSessionJsonl(jsonl);
  assert.equal(findings.mentionsCli, true, "fixture must exercise the expo-ios CLI");
  assert.equal(findings.localDevEvidenceTask, true, "fixture must exercise local-dev evidence");
  assert.deepEqual(findings.forbidden, []);
  assert.ok(findings.directCliCalls > 0, "expected at least one direct expo-ios --json call");
}

function messageText(payload) {
  return (payload.content ?? [])
    .map((item) => item.text ?? item.input_text ?? item.output_text ?? "")
    .join("\n");
}

function parseArguments(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function line(payload) {
  return JSON.stringify({ type: "response_item", payload });
}

test("session contract rejects stale MCP-first usage", () => {
  const transcript = [
    line({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Use expo-ios to review the screen currently open and do a full UX audit" }],
    }),
    line({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "MCP servers available in this session: `xcodebuildmcp`." }],
    }),
    line({
      type: "function_call",
      name: "screenshot",
      namespace: "mcp__xcodebuildmcp__",
      arguments: "{\"returnFormat\":\"path\"}",
    }),
  ].join("\n");

  const findings = analyzeSessionJsonl(transcript);

  assert.equal(findings.directCliCalls, 0);
  assert.deepEqual(findings.forbidden.map((item) => item.reason), [
    "MCP server capability was exposed",
    "used mcp__xcodebuildmcp__",
  ]);
});

test("session contract accepts CLI-first screen audit evidence", () => {
  const transcript = [
    line({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Use expo-ios to review the screen currently open and do a full UX audit" }],
    }),
    line({
      type: "function_call",
      name: "exec_command",
      namespace: "functions",
      arguments: "{\"cmd\":\"expo-ios --json doctor && expo-ios --json ux-context --cwd apps/mobile --metro-port 8081\"}",
    }),
  ].join("\n");

  assertCliOnlySession(transcript);
});
