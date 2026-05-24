import { promises as fs } from "node:fs";
import path from "node:path";

declare const process: { cwd(): string };

export interface NormalizeProjectCwdOptions {
  allowMissingPackageJson?: boolean;
}

export async function normalizeProjectCwd(
  cwd?: string,
  options: NormalizeProjectCwdOptions = {},
): Promise<string> {
  const resolved = await normalizeCwd(cwd);
  if (options.allowMissingPackageJson) return resolved;

  const packageJson = await findUp(resolved, "package.json");
  if (!packageJson) {
    throw new Error(`No package.json found from ${resolved}. Pass cwd for an Expo project.`);
  }
  return path.dirname(packageJson);
}

export async function normalizeCwd(cwd?: string): Promise<string> {
  const resolved = path.resolve(cwd ?? process.cwd());
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Directory does not exist: ${resolved}`);
  }
  return resolved;
}

export async function findUp(startDir: string, filename: string): Promise<string | null> {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, filename);
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function detectPackageManager(projectRoot: string): Promise<string> {
  let current = path.resolve(projectRoot);
  while (true) {
    if (await pathExists(path.join(current, "pnpm-lock.yaml"))) return "pnpm";
    if (await pathExists(path.join(current, "yarn.lock"))) return "yarn";
    if (await pathExists(path.join(current, "bun.lockb"))) return "bun";
    if (await pathExists(path.join(current, "bun.lock"))) return "bun";
    if (await pathExists(path.join(current, "package-lock.json"))) return "npm";
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "unknown";
}

export async function firstExisting(root: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function pathExists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

export async function walkFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...await walkFiles(full));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}
