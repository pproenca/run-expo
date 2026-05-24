export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export const COMMAND_NAMES = [
  "install",
  "upgrade",
  "doctor",
  "project-info",
  "routes",
  "devices",
  "boot-simulator",
  "open-url",
  "open-route",
  "launch-app",
  "terminate-app",
  "reload-app",
  "open-dev-menu",
  "install-app",
  "uninstall-app",
  "screenshot",
  "tap",
  "long-press",
  "dbltap",
  "fill",
  "type",
  "focus",
  "blur",
  "press",
  "keyboard",
  "select",
  "check",
  "uncheck",
  "scroll",
  "scroll-into-view",
  "drag",
  "gesture",
  "logs",
  "ux-context",
  "inspector",
  "trace",
  "annotate-screen",
  "review-overlay",
  "review-next",
  "review",
  "session",
  "target",
  "snapshot",
  "refs",
  "get",
  "find",
  "wait",
  "batch",
  "devtools",
  "console",
  "errors",
  "metro",
  "perf",
  "skills",
  "clipboard",
  "set",
  "network",
  "navigation",
  "storage",
  "state",
  "controls",
  "bridge",
  "rn",
  "expo",
  "diff",
  "record",
  "accessibility",
  "dialog",
  "sheet",
  "profiler",
  "inspect",
  "highlight",
  "instrumentation",
  "dashboard",
  "policy",
  "redact",
] as const;

export const COMMAND_EFFECTS = ["read", "write", "device", "runtime", "sidecar"] as const;

export const RUNTIME_COMMAND_ALIASES = {
  doctor: "doctor",
  "project-info": "project_info",
  routes: "expo_router_sitemap",
  devices: "list_devices",
  session: "session",
  target: "target",
  snapshot: "snapshot",
  refs: "refs",
  get: "get_ref",
  find: "find",
  wait: "wait",
  batch: "batch",
  "boot-simulator": "boot_simulator",
  "open-url": "open_url",
  "launch-app": "launch_app",
  "terminate-app": "terminate_app",
  "reload-app": "reload_app",
  "open-dev-menu": "runtime_inspector",
  "install-app": "install_app",
  "uninstall-app": "uninstall_app",
  "long-press": "ref_action",
  dbltap: "ref_action",
  fill: "ref_action",
  type: "keyboard",
  press: "keyboard",
  focus: "ref_action",
  blur: "ref_action",
  select: "ref_action",
  check: "ref_action",
  uncheck: "ref_action",
  drag: "ref_action",
  scroll: "ref_action",
  "scroll-into-view": "ref_action",
  clipboard: "clipboard",
  keyboard: "keyboard",
  set: "set_environment",
  logs: "collect_app_logs",
  screenshot: "automation_take_screenshot",
  tap: "automation_tap",
  gesture: "automation_gesture",
  "open-route": "open_expo_route",
  "ux-context": "capture_ux_context",
  "annotate-screen": "annotate_screen",
  inspector: "runtime_inspector",
  "review-overlay": "review_overlay",
  "review-overlay-server": "review_overlay",
  "review-next": "review_next_step",
  "annotation-server": "annotation_server",
  devtools: "devtools",
  console: "console",
  errors: "errors",
  metro: "metro",
  profiler: "perf",
  navigation: "navigation",
  network: "network",
  storage: "storage",
  state: "state",
  controls: "controls",
  bridge: "bridge",
  accessibility: "accessibility",
  dialog: "dialog",
  sheet: "sheet",
  record: "record",
  diff: "diff",
  inspect: "debug_inspect",
  highlight: "highlight",
  expo: "expo",
  rn: "rn",
  perf: "perf",
  dashboard: "dashboard",
  review: "review",
  policy: "policy",
  redact: "redact",
  skills: "skills",
  install: "install",
  upgrade: "upgrade",
  release: "release",
  "live-backlog": "live_backlog",
  trace: "trace_interaction",
} as const;

export const CONTRACT_ACTIONS_BY_DOMAIN = {
  controls: ["list", "get", "press", "set"],
  storage: ["list", "get", "set", "clear", "trace"],
  record: ["start", "stop", "status"],
  navigation: ["state", "back", "pop-to-root", "tab", "deep-link"],
  instrumentation: ["status", "manifest", "install", "remove", "call"],
} as const;

export const RUNTIME_ACTIONS_BY_DOMAIN = {
  controls: ["list", "get", "press"],
  storage: ["list", "get", "set", "clear"],
  record: ["start", "stop"],
} as const;

export const RECORD_STATUS_VALUES = {
  run: ["running", "completed", "failed"],
  device: ["booted", "shutdown", "connected", "unknown"],
  metro: ["available", "unavailable", "unknown"],
} as const;

export const SIDECAR_STATUS_VALUES = ["running", "stale", "stopped", "unknown"] as const;

export const ADAPTER_REGISTRY_CONTRACTS = {
  commandRunner: ["plan", "run"],
  project: ["doctor", "projectInfo", "readAppConfig", "routes"],
  device: [
    "list",
    "bootSimulator",
    "launchApp",
    "terminateApp",
    "reloadApp",
    "installApp",
    "uninstallApp",
    "openDevMenu",
    "openUrl",
    "screenshot",
  ],
  gesture: ["plan", "run"],
  metro: ["status", "targets", "symbolicate"],
  hermes: ["evaluate", "inspectRuntime"],
  snapshot: ["capture", "refs", "get", "find"],
} as const;

export function runtimeCommandNames(): string[] {
  return Object.keys(RUNTIME_COMMAND_ALIASES);
}

export function commandSurfaceMismatches(): {
  contractOnly: string[];
  runtimeOnly: string[];
  actionMismatches: Array<{ domain: string; contractOnly: string[]; runtimeOnly: string[] }>;
} {
  const contract = new Set<string>(COMMAND_NAMES);
  const runtime = new Set(runtimeCommandNames());
  return {
    contractOnly: COMMAND_NAMES.filter((name) => !runtime.has(name)),
    runtimeOnly: runtimeCommandNames().filter((name) => !contract.has(name)),
    actionMismatches: Object.keys(RUNTIME_ACTIONS_BY_DOMAIN).map((domain) => {
      const contractActions = new Set((CONTRACT_ACTIONS_BY_DOMAIN as Record<string, readonly string[]>)[domain] ?? []);
      const runtimeActions = new Set((RUNTIME_ACTIONS_BY_DOMAIN as Record<string, readonly string[]>)[domain] ?? []);
      return {
        domain,
        contractOnly: [...contractActions].filter((action) => !runtimeActions.has(action)),
        runtimeOnly: [...runtimeActions].filter((action) => !contractActions.has(action)),
      };
    }).filter((entry) => entry.contractOnly.length > 0 || entry.runtimeOnly.length > 0),
  };
}

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}
