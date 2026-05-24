import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  COMPANION_SKILL,
  CONTRACT_BULLETS,
  EVIDENCE_COMMANDS,
  MUTATING_GUIDANCE,
  START_COMMANDS,
  parseSkillFrontmatter,
  renderCompanionSkillMarkdown,
} from "../main/index.js";

describe("companion-skill-surface legacy characterization", () => {
  it("preserves skill frontmatter and title", () => {
    assert.deepEqual(COMPANION_SKILL.frontmatter, {
      name: "expo-ios-cli",
      description: "Use when running expo-ios.",
    });
    assert.equal(COMPANION_SKILL.title, "Expo iOS CLI");
  });

  it("preserves contract bullets and command guidance", () => {
    assert.deepEqual(CONTRACT_BULLETS, [
      'Success: `{ "ok": true, "data": ... }`',
      "Invalid usage exits `2`; runtime failures exit `1`",
      "Errors are machine-readable and redact secrets",
      "Prefer `--json`; use `--record` or `--state-dir` for resumable evidence",
      "The CLI never prompts",
    ]);
    assert.deepEqual(START_COMMANDS, [
      "command -v expo-ios || (cd /path/to/expo98 && make install-local)",
      "expo-ios --json doctor",
      "expo-ios --json project-info --cwd /path/to/expo-app",
      "expo-ios --json routes --cwd /path/to/expo-app",
    ]);
    assert.deepEqual(EVIDENCE_COMMANDS, [
      "expo-ios --json devices --platform ios",
      "expo-ios --json ux-context --cwd /path/to/expo-app --bundle-id com.example.app --metro-port 8081",
      "expo-ios --json screenshot --cwd /path/to/expo-app",
      'expo-ios --json review-next --surface calendar --stage pre-patch --issue "drag regression"',
    ]);
  });

  it("preserves mutation warning guidance", () => {
    assert.equal(
      MUTATING_GUIDANCE,
      "Read commands are safe for evidence. Simulator launch/tap/gesture, inspector toggles, overlay scaffold/prepare/clear, annotation serve, and trace start/stop change state.",
    );
  });

  it("parses frontmatter compatible with the legacy skill metadata reader", () => {
    assert.deepEqual(parseSkillFrontmatter(renderCompanionSkillMarkdown()), {
      name: "expo-ios-cli",
      description: "Use when running expo-ios.",
    });
    assert.deepEqual(parseSkillFrontmatter("---\nname: x\n---\n# Title\n"), { name: "x" });
    assert.deepEqual(parseSkillFrontmatter("# Missing frontmatter\n"), {});
  });

  it("renders the skill markdown with the preserved contract and examples", () => {
    const markdown = renderCompanionSkillMarkdown();
    assert.match(markdown, /^---\nname: expo-ios-cli\n/m);
    assert.match(markdown, /# Expo iOS CLI/);
    assert.match(markdown, /Use `review-next` when the next evidence step is unclear\./);
    assert.match(markdown, /`review-overlay scaffold\/prepare --serve true`/);
  });
});

