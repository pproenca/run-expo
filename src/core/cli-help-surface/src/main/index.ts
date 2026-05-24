import {
  DISCOVERY_COMMANDS,
  EVIDENCE_AND_RUNTIME_COMMANDS,
  EXAMPLES,
  GLOBAL_FLAGS,
  SIMULATOR_AND_APP_COMMANDS,
} from "../../../command-surface/src/main/index.ts";

export const CLI_VERSION = "0.1.0";






export function globalFlagLines(): string[] {
  return [...GLOBAL_FLAGS];
}

export function commandLines(): {
  discovery: string[];
  simulatorAndAppActions: string[];
  evidenceAndRuntime: string[];
} {
  return {
    discovery: [...DISCOVERY_COMMANDS],
    simulatorAndAppActions: [...SIMULATOR_AND_APP_COMMANDS],
    evidenceAndRuntime: [...EVIDENCE_AND_RUNTIME_COMMANDS],
  };
}

export function exampleLines(): string[] {
  return [...EXAMPLES];
}

export function cliHelpText(version = CLI_VERSION): string {
  return [
    `expo98 ${version}`,
    "",
    "Usage:",
    "  expo98 [global flags] <command> [options]",
    "",
    "Global flags:",
    ...indent(GLOBAL_FLAGS),
    "",
    "Discovery:",
    ...indent(DISCOVERY_COMMANDS),
    "",
    "Simulator and app actions:",
    ...indent(SIMULATOR_AND_APP_COMMANDS),
    "",
    "Evidence and runtime:",
    ...indent(EVIDENCE_AND_RUNTIME_COMMANDS),
    "",
    "Examples:",
    ...indent(EXAMPLES),
  ].join("\n") + "\n";
}

export function printHelp(write: (text: string) => void, version = CLI_VERSION): void {
  write(cliHelpText(version));
}

function indent(lines: readonly string[]): string[] {
  return lines.map((line) => `  ${line}`);
}
