export const CONTRACT_BULLETS = [
  'Success: `{ "ok": true, "data": ... }`',
  "Invalid usage exits `2`; runtime failures exit `1`",
  "Errors are machine-readable and redact secrets",
  "Prefer `--json`; use `--record` or `--state-dir` for resumable evidence",
  "The CLI never prompts",
] as const;

export const START_COMMANDS = [
  "command -v expo-ios || (cd /path/to/expo98 && make install-local)",
  "expo-ios --json doctor",
  "expo-ios --json project-info --cwd /path/to/expo-app",
  "expo-ios --json routes --cwd /path/to/expo-app",
] as const;

export const EVIDENCE_COMMANDS = [
  "expo-ios --json devices --platform ios",
  "expo-ios --json ux-context --cwd /path/to/expo-app --bundle-id com.example.app --metro-port 8081",
  "expo-ios --json screenshot --cwd /path/to/expo-app",
  'expo-ios --json review-next --surface calendar --stage pre-patch --issue "drag regression"',
] as const;

export const UNCLEAR_NEXT_STEP_GUIDANCE = "Use `review-next` when the next evidence step is unclear.";

export const TOOL_GUIDANCE = [
  "`gesture`: tap, long-press, drag, swipe; dry-run risky coordinates.",
  "`trace start/read/stop`: concrete reproductions.",
  "`inspector probe/toggle/install-comment-menu/read-comments`: simulator hit boxes or human notes.",
  "`annotate-screen --serve true`: screenshot-level fallback comments.",
  "`review-overlay scaffold/prepare --serve true`: in-app element targeting, boxes, owner hierarchy, source hints, clipboard feedback.",
] as const;

export const MUTATING_GUIDANCE =
  "Read commands are safe for evidence. Simulator launch/tap/gesture, inspector toggles, overlay scaffold/prepare/clear, annotation serve, and trace start/stop change state.";

export type SkillFrontmatter = {
  name?: string;
  description?: string;
};

export type CompanionSkill = {
  frontmatter: Required<SkillFrontmatter>;
  title: string;
  summary: string;
  contractBullets: readonly string[];
  startCommands: readonly string[];
  evidenceCommands: readonly string[];
  unclearNextStepGuidance: string;
  toolGuidance: readonly string[];
  mutatingGuidance: string;
};

export const COMPANION_SKILL: CompanionSkill = {
  frontmatter: {
    name: "expo-ios-cli",
    description: "Use when running expo-ios.",
  },
  title: "Expo iOS CLI",
  summary: "Use `expo-ios --json ...` for local evidence. Read `../../SPEC.md` only when changing the CLI.",
  contractBullets: CONTRACT_BULLETS,
  startCommands: START_COMMANDS,
  evidenceCommands: EVIDENCE_COMMANDS,
  unclearNextStepGuidance: UNCLEAR_NEXT_STEP_GUIDANCE,
  toolGuidance: TOOL_GUIDANCE,
  mutatingGuidance: MUTATING_GUIDANCE,
};

export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  if (!markdown.startsWith("---\n")) {
    return {};
  }

  const end = markdown.indexOf("\n---", 4);
  if (end === -1) {
    return {};
  }

  const frontmatter: SkillFrontmatter = {};
  const body = markdown.slice(4, end).split("\n");
  for (const line of body) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "name" || key === "description") {
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

export function renderCompanionSkillMarkdown(skill: CompanionSkill = COMPANION_SKILL): string {
  return [
    "---",
    `name: ${skill.frontmatter.name}`,
    `description: ${skill.frontmatter.description}`,
    "---",
    "",
    `# ${skill.title}`,
    "",
    skill.summary,
    "",
    "## Contract",
    "",
    ...skill.contractBullets.map((item) => `- ${item}`),
    "",
    "## Start",
    "",
    "```bash",
    ...skill.startCommands,
    "```",
    "",
    "Use:",
    "",
    "```bash",
    ...skill.evidenceCommands,
    "```",
    "",
    skill.unclearNextStepGuidance,
    "",
    ...skill.toolGuidance.map((item) => `- ${item}`),
    "",
    skill.mutatingGuidance,
    "",
  ].join("\n");
}
