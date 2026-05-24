export const CLI_VERSION = "0.1.0";

const GLOBAL_FLAGS = [
  "--json                 Write { ok, data } JSON to stdout",
  "--plain                Write stable line-oriented output to stdout",
  "--quiet                Suppress non-essential human output",
  "--version              Print CLI version",
  "--root <dir>           Default project root for commands that accept --cwd",
  "--state-dir <dir>      Persist a run record JSON file in this directory",
  "--action-policy <path> Permit gated write/device actions from a JSON policy",
  "--max-output <chars>   Truncate stdout payloads after this many characters",
  "--content-boundaries   Wrap stdout data in an explicit untrusted-output boundary",
  "--allow-runtime-eval <true|false>",
  "                       Permit gated Hermes Runtime.evaluate predicates",
  "--confirm-actions <list>",
  "                       Reserved for interactive confirmations; noninteractive runs deny",
  "--record               Persist a run record under <root>/.scratch/expo-ios/runs",
  "--debug                Include debug fields in machine-readable errors",
  "--no-color             Disable color; output is uncolored by default",
  "--no-input             Reserved for noninteractive safety; this CLI never prompts",
] as const;

const DISCOVERY_COMMANDS = [
  "doctor                 Check local tool availability and project context",
  "project-info           Inspect Expo dependencies and app config",
  "routes                 List Expo Router routes",
  "devices                List iOS simulators and Android devices",
  "session new [name]     Create an evidence session and artifact namespace",
  "target list            List stable simulator/app/Metro target handles",
  "target select <id>     Store the active target on the latest session",
  "target current         Show the selected target for the latest session",
  "snapshot               Capture semantic UI refs for the selected target",
  "refs                   List cached refs from the latest snapshot",
  "get <field> <ref>      Inspect one cached ref field",
  "find <kind> <value>     Locate cached semantic refs and optionally plan an action",
  "wait                   Wait for cached text or ref state evidence",
  "batch                  Run multiple expo-ios command steps in one process",
] as const;

const SIMULATOR_AND_APP_COMMANDS = [
  "boot-simulator         Boot an iOS simulator",
  "open-url <url>         Open a URL/deep link",
  "launch-app             Launch an installed app",
  "terminate-app          Terminate an installed app",
  "reload-app             Relaunch an app as a practical JS reload fallback",
  "open-dev-menu          Open the React Native dev menu on the simulator",
  "install-app            Install an .app/.ipa with an action policy",
  "uninstall-app          Uninstall an app with an action policy",
  "open-route [route]     Open an Expo Router route",
  "screenshot             Capture a simulator/device screenshot",
  "tap                    Tap device coordinates",
  "fill/press/type        Act on focused input or cached semantic refs",
  "long-press/dbltap      Run semantic ref gestures from cached bounds",
  "scroll/drag            Run semantic ref or coordinate gestures",
  "clipboard              Read, write, or paste simulator clipboard text",
  "keyboard               Type text or press a key through local tooling",
  "set                    Mutate explicit simulator environment settings",
  "gesture                Run tap, long-press, drag, or swipe gesture evidence",
] as const;

const EVIDENCE_AND_RUNTIME_COMMANDS = [
  "logs                   Collect recent app/device logs",
  "ux-context             Capture screenshot, route, runtime, hierarchy, and log context",
  "annotate-screen        Prepare/read an in-app annotation overlay",
  "inspector              Toggle RN inspector and install/read simulator comments",
  "review-overlay         Scaffold/run an in-app Codex review overlay",
  "review-next            Suggest the next constraint-focused UI review step",
  "devtools capabilities  Report structured DevTools capability records",
  "console                Read bounded JS console diagnostics",
  "errors                 Read bounded JS error diagnostics",
  "metro status           Report Metro status, targets, and symbolication",
  "navigation             Read or drive app navigation bridge state",
  "network                Read app network evidence and write redacted HAR",
  "storage                Read or mutate app storage through policy gates",
  "state                  List/save/load/clear app state snapshots",
  "controls               List, inspect, or press app-defined controls",
  "bridge                 Plan/check dev-only app bridge install, health, and domains",
  "accessibility          Capture native accessibility tree/audit evidence",
  "dialog                 Report or act on visible dialog blockers",
  "sheet                  Report or dismiss visible sheet/modal blockers",
  "record                 Create recording evidence artifacts",
  "diff                   Write snapshot or screenshot diff artifacts",
  "expo                   Inspect Expo modules, config, doctor, upstream policy, and prebuild risk",
  "rn                     Inspect React Native tree, refs, renders, and fiber evidence",
  "perf                   Measure summary, startup, action, and bundle evidence",
  "dashboard              Start, stop, or report local session observability",
  "skills                 List or print bundled companion skill guidance",
  "install                Check local install target paths",
  "upgrade                Check local upgrade status",
  "release                Run local release packaging checks",
  "live-backlog           Generate or run the source-derived live backlog",
  "trace                  Start/read/stop/clear a Hermes interaction trace",
  "profiler start|stop    Native profiler evidence boundary alias for perf ettrace",
  "inspect <ref>          Inspect cached source/props/bounds plus Metro target status",
  "highlight <ref>        Write a bounded highlight evidence overlay",
  "review report|matrix   Assemble captured evidence into review artifacts",
  "policy show|check      Explain or evaluate action-policy decisions",
  "redact <file>          Redact secrets from a JSON/text file",
] as const;

const EXAMPLES = [
  "expo-ios --json doctor",
  "expo-ios --json session new review",
  "expo-ios --json target list",
  "expo-ios --json snapshot --interactive --source --bounds",
  "expo-ios --json get source @e1",
  "expo-ios --json find role button --name Add tap",
  "expo-ios --json wait --text Customers",
  "expo-ios --json wait @e1 --state visible",
  "expo-ios --json batch '[\"wait\",\"--text\",\"Customers\"]' '[\"get\",\"source\",\"@e1\"]' --bail true",
  "expo-ios --json screenshot --annotate",
  "expo-ios --json open-route /customers --cwd apps/mobile --scheme myapp",
  "expo-ios --json annotate-screen prepare --cwd apps/mobile --serve true",
  "expo-ios --json inspector probe --metro-port 8081",
  "expo-ios --json inspector install-comment-menu --metro-port 8081",
  "expo-ios --json inspector open-dev-menu",
  "expo-ios --json terminate-app --bundle-id com.example.app",
  "expo-ios --json reload-app --bundle-id com.example.app",
  "expo-ios --json fill @e1 \"hello\"",
  "expo-ios --json clipboard read",
  "expo-ios --json set appearance dark --action-policy expo-ios.policy.json",
  "expo-ios --json review-overlay scaffold --cwd apps/mobile",
  "expo-ios --json review-overlay prepare --cwd apps/mobile --serve true",
  "expo-ios --json review-next --surface calendar --stage pre-patch --issue \"drag creates scroll conflict\"",
  "expo-ios --json devtools capabilities --metro-port 8081",
  "expo-ios --json expo upstream-policy --cwd apps/mobile",
  "expo-ios --json console --limit 50 --metro-port 8081",
  "expo-ios --json errors --limit 50 --metro-port 8081",
  "expo-ios --json metro status --metro-port 8081",
  "expo-ios --json navigation state --metro-port 8081",
  "expo-ios --json navigation deep-link /customers --scheme myapp",
  "expo-ios --json network requests --metro-port 8081",
  "expo-ios --json network har stop network.har --metro-port 8081",
  "expo-ios --json storage async list --metro-port 8081",
  "expo-ios --json controls list --metro-port 8081",
  "expo-ios --json bridge plan --cwd apps/mobile",
  "expo-ios --json bridge health --cwd apps/mobile --metro-port 8081",
  "expo-ios --json bridge domains storage set --cwd apps/mobile --metro-port 8081",
  "expo-ios --json accessibility tree",
  "expo-ios --json dialog status --metro-port 8081",
  "expo-ios --json diff snapshot --baseline before.json",
  "expo-ios --json expo modules --cwd apps/mobile",
  "expo-ios --json rn tree --metro-port 8081",
  "expo-ios --json rn inspect @e1",
  "expo-ios --json perf summary --metro-port 8081",
  "expo-ios --json perf action \"open customer\" --metro-port 8081",
  "expo-ios --json perf bundle dist/index.ios.bundle",
  "expo-ios --json perf compare --baseline before.json --candidate after.json",
  "expo-ios --json perf budget check --file expo-ios.perf.json --candidate after.json",
  "expo-ios --json perf memgraph capture heap.memgraph",
  "expo-ios --json profiler start",
  "expo-ios --json inspect @e1",
  "expo-ios --json policy check action uninstall-app --action-policy expo-ios.policy.json",
  "expo-ios --json redact run-record.json --output-path run-record.redacted.json",
  "expo-ios --json dashboard start",
  "expo-ios --json skills get expo-ios-cli",
  "expo-ios --json release check",
  "expo-ios --json gesture long-press --x 160 --y 720 --duration-ms 900 --dry-run true",
  "expo-ios --json live-backlog matrix --cwd apps/mobile",
  "expo-ios --json trace --action read --metro-port 8081",
] as const;

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
    `expo-ios ${version}`,
    "",
    "Usage:",
    "  expo-ios [global flags] <command> [options]",
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
