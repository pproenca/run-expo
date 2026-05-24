import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function readFlagValue(args, name) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      return args[index + 1];
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return undefined;
}

const defaultArgs =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [
        "-p",
        "tsconfig.core.json",
        "--incremental",
        "--tsBuildInfoFile",
        ".artifacts/tsgo-cache/core.tsbuildinfo",
      ];
const finalArgs = [...defaultArgs];

if (!finalArgs.includes("-d") && !finalArgs.includes("--declaration")) {
  finalArgs.push("--declaration", "false");
}

const tsBuildInfoFile = readFlagValue(finalArgs, "--tsBuildInfoFile");
if (tsBuildInfoFile) {
  fs.mkdirSync(path.dirname(path.resolve(tsBuildInfoFile)), { recursive: true });
}

const tsgoPath = path.resolve("node_modules", ".bin", "tsgo");
const result = spawnSync(tsgoPath, finalArgs, { stdio: "inherit" });

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
