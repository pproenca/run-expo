import { execFile as nodeExecFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface PluginSelfManagementDependencies {
  pluginRoot?: string;
  homeDir?: string;
  tmpDir?: string;
  execFile?: (
    file: string,
    argv: string[],
    options: { cwd: string; timeout: number; rejectOnError: false },
  ) => Promise<ExecResult> | ExecResult;
}

export interface BundledSkill {
  name: string;
  description: string;
  path: string;
  content: string;
}

const CLI_NAME = "expo-ios";
const CLI_VERSION = "0.1.0";

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

export async function skillsCommand(
  args: Record<string, unknown> = {},
  deps: PluginSelfManagementDependencies = {},
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "list", "action");
  if (!["list", "get"].includes(action)) throw new Error(`Unknown skills action: ${action}`);
  const skills = await listBundledSkills(deps);
  if (action === "list") {
    return toolJson({
      available: true,
      action,
      pluginVersion: CLI_VERSION,
      skills: skills.map(({ content: _content, ...skill }) => skill),
    });
  }
  const name = requireString(args.name ?? positionals[1], "name");
  const skill = skills.find((item) => item.name === name);
  if (!skill) return toolJson({ available: false, action, name, reason: "Skill not found.", pluginVersion: CLI_VERSION });
  return toolJson({ available: true, action, pluginVersion: CLI_VERSION, ...skill });
}

export async function listBundledSkills(deps: Pick<PluginSelfManagementDependencies, "pluginRoot"> = {}): Promise<BundledSkill[]> {
  const skillsRoot = join(pluginRoot(deps), "skills");
  const entries = await readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(skillsRoot, entry.name, "SKILL.md");
    const content = await readFile(file, "utf8").catch(() => null);
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

export function parseSkillFrontmatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const metadata: Record<string, string> = {};
  for (const line of match[1]?.split("\n") ?? []) {
    const item = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (item?.[1]) metadata[item[1]] = String(item[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return metadata;
}

export async function installCommand(
  args: Record<string, unknown> = {},
  deps: PluginSelfManagementDependencies = {},
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown install action: ${action}`);
  const prefix = resolve(optionalString(args.prefix) ?? join(deps.homeDir ?? homedir(), ".local"));
  const binPath = join(prefix, "bin", CLI_NAME);
  return toolJson({
    available: true,
    action,
    prefix,
    binPath,
    installed: await pathExists(binPath),
    installCommand: `make -C ${pluginRoot(deps)} install-local PREFIX=${prefix}`,
    cliPath: cliWrapperPath(deps),
    version: CLI_VERSION,
  });
}

export async function upgradeCommand(
  args: Record<string, unknown> = {},
  deps: PluginSelfManagementDependencies = {},
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown upgrade action: ${action}`);
  const prefix = resolve(optionalString(args.prefix) ?? join(deps.homeDir ?? homedir(), ".local"));
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

export async function releaseCommand(
  args: Record<string, unknown> = {},
  deps: PluginSelfManagementDependencies = defaultPluginSelfManagementDependencies,
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown release action: ${action}`);
  const outsideCwd = resolve(String(args.cwd ?? await mkdtemp(join(deps.tmpDir ?? tmpdir(), "expo-ios-release-"))));
  await mkdir(outsideCwd, { recursive: true });
  const fixture = join(outsideCwd, "routes-fixture");
  await mkdir(join(fixture, "app"), { recursive: true });
  await writeJsonFile(join(fixture, "package.json"), { dependencies: { expo: "^54.0.0", "expo-router": "^6.0.0" } });
  await writeFile(join(fixture, "app", "index.tsx"), "export default function Index() { return null; }\n", "utf8");
  const checks = [
    await releaseCheck("version", ["--version"], outsideCwd, (result) => result.stdout.trim() === CLI_VERSION, deps),
    await releaseCheck("help", ["--help"], outsideCwd, (result) => result.stdout.includes("perf") && result.stdout.includes("dashboard"), deps),
    await releaseCheck("doctor-json", ["--json", "doctor"], outsideCwd, (result) => JSON.parse(result.stdout).ok === true, deps),
    await releaseCheck("routes-fixture-json", ["--json", "routes", "--cwd", fixture], outsideCwd, (result) => JSON.parse(result.stdout).data.routeCount >= 1, deps),
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

const defaultPluginSelfManagementDependencies: PluginSelfManagementDependencies = {
  execFile,
};

export async function releaseCheck(
  name: string,
  argv: string[],
  cwd: string,
  predicate: (result: ExecResult) => boolean,
  deps: PluginSelfManagementDependencies = defaultPluginSelfManagementDependencies,
): Promise<Record<string, unknown>> {
  try {
    if (!deps.execFile) return { name, ok: false, exitCode: 1, error: "No subprocess adapter is configured." };
    const result = await deps.execFile(process.execPath, [cliWrapperPath(deps), ...argv], {
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

export function cliWrapperPath(deps: Pick<PluginSelfManagementDependencies, "pluginRoot"> = {}): string {
  return join(pluginRoot(deps), "cli", "expo-ios.mjs");
}

export function pluginRoot(deps: Pick<PluginSelfManagementDependencies, "pluginRoot"> = {}): string {
  return resolve(deps.pluginRoot ?? join(dirname(new URL(import.meta.url).pathname), "..", ".."));
}

export async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function truncate(value: unknown, max = 40_000): string {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...[truncated ${text.length - max} chars]`;
}

function formatError(error: unknown): string {
  const record = error && typeof error === "object" ? error as { message?: unknown } : null;
  return record?.message == null ? String(error) : String(record.message);
}

function execFile(
  file: string,
  argv: string[],
  options: { cwd: string; timeout: number; rejectOnError: false },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    nodeExecFile(file, argv, { cwd: options.cwd, timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout, stderr) => {
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}
