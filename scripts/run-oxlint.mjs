import { spawnSync } from "node:child_process";
import path from "node:path";

const oxlintPath = path.resolve("node_modules", ".bin", "oxlint");
const passthroughArgs = process.argv.slice(2);
const baseArgs = [
  "--type-aware",
  "--tsconfig",
  "config/tsconfig/oxlint.json",
  "--report-unused-disable-directives-severity",
  "error",
];
const defaultPaths = ["src", "tests", "scripts"];

const result = spawnSync(oxlintPath, [...baseArgs, ...defaultPaths, ...passthroughArgs], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
