export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;
export type ToolHandlerBinding = readonly [toolName: string, handlerSymbol: string];
export type HandlerImplementationSource = {
  handlerSymbol: string;
  packageName: `@expo98/${string}`;
  exportName: string;
};

export const TOOL_HANDLER_BINDINGS = [
  ["doctor", "doctor"],
  ["project_info", "projectInfo"],
  ["expo_router_sitemap", "expoRouterSitemap"],
  ["list_devices", "listDevices"],
  ["session", "sessionCommand"],
  ["target", "targetCommand"],
  ["snapshot", "snapshotCommand"],
  ["refs", "refsCommand"],
  ["get_ref", "getRefCommand"],
  ["find", "findCommand"],
  ["wait", "waitCommand"],
  ["batch", "batchCommand"],
  ["boot_simulator", "bootSimulator"],
  ["open_url", "openUrl"],
  ["launch_app", "launchApp"],
  ["terminate_app", "terminateApp"],
  ["reload_app", "reloadApp"],
  ["install_app", "installApp"],
  ["uninstall_app", "uninstallApp"],
  ["ref_action", "refActionCommand"],
  ["clipboard", "clipboardCommand"],
  ["keyboard", "keyboardCommand"],
  ["set_environment", "setEnvironmentCommand"],
  ["collect_app_logs", "collectAppLogs"],
  ["automation_take_screenshot", "automationTakeScreenshot"],
  ["automation_tap", "automationTap"],
  ["automation_gesture", "automationGesture"],
  ["open_expo_route", "openExpoRoute"],
  ["capture_ux_context", "captureUxContext"],
  ["annotate_screen", "annotateScreen"],
  ["runtime_inspector", "runtimeInspector"],
  ["review_overlay", "reviewOverlay"],
  ["review_next_step", "reviewNextStep"],
  ["annotation_server", "annotationServer"],
  ["devtools", "devtoolsCommand"],
  ["console", "consoleCommand"],
  ["errors", "errorsCommand"],
  ["metro", "metroCommand"],
  ["navigation", "navigationCommand"],
  ["network", "networkCommand"],
  ["storage", "storageCommand"],
  ["state", "stateCommand"],
  ["controls", "controlsCommand"],
  ["bridge", "bridgeCommand"],
  ["accessibility", "accessibilityCommand"],
  ["dialog", "dialogCommand"],
  ["sheet", "sheetCommand"],
  ["record", "recordCommand"],
  ["diff", "diffCommand"],
  ["debug_inspect", "debugInspectCommand"],
  ["highlight", "highlightCommand"],
  ["expo", "expoCommand"],
  ["rn", "rnCommand"],
  ["perf", "perfCommand"],
  ["dashboard", "dashboardCommand"],
  ["review", "reviewCommand"],
  ["policy", "policyCommand"],
  ["redact", "redactCommand"],
  ["skills", "skillsCommand"],
  ["install", "installCommand"],
  ["upgrade", "upgradeCommand"],
  ["release", "releaseCommand"],
  ["live_backlog", "liveBacklogCommand"],
  ["trace_interaction", "traceInteraction"],
] as const satisfies readonly ToolHandlerBinding[];

export const HANDLER_IMPLEMENTATION_SOURCES = [
  source("doctor", "@expo98/project-info-doctor"),
  source("projectInfo", "@expo98/project-info-doctor"),
  source("expoRouterSitemap", "@expo98/router-sitemap"),
  source("listDevices", "@expo98/device-listing"),
  source("sessionCommand", "@expo98/session-run-records"),
  source("targetCommand", "@expo98/target-management"),
  source("snapshotCommand", "@expo98/snapshot-evidence"),
  source("refsCommand", "@expo98/snapshot-evidence"),
  source("getRefCommand", "@expo98/snapshot-evidence"),
  source("findCommand", "@expo98/ref-actions-wait"),
  source("waitCommand", "@expo98/ref-actions-wait"),
  source("batchCommand", "@expo98/batch-orchestration"),
  source("bootSimulator", "@expo98/app-lifecycle-actions"),
  source("openUrl", "@expo98/route-url-actions"),
  source("launchApp", "@expo98/app-lifecycle-actions"),
  source("terminateApp", "@expo98/app-lifecycle-actions"),
  source("reloadApp", "@expo98/app-lifecycle-actions"),
  source("installApp", "@expo98/app-lifecycle-actions"),
  source("uninstallApp", "@expo98/app-lifecycle-actions"),
  source("refActionCommand", "@expo98/interaction-actions"),
  source("clipboardCommand", "@expo98/interaction-actions"),
  source("keyboardCommand", "@expo98/interaction-actions"),
  source("setEnvironmentCommand", "@expo98/interaction-actions"),
  source("collectAppLogs", "@expo98/app-lifecycle-actions"),
  source("automationTakeScreenshot", "@expo98/screenshot-capture"),
  source("automationTap", "@expo98/interaction-actions"),
  source("automationGesture", "@expo98/interaction-actions"),
  source("openExpoRoute", "@expo98/route-url-actions"),
  source("captureUxContext", "@expo98/ux-context-capture"),
  source("annotateScreen", "@expo98/annotate-screen-artifacts"),
  source("runtimeInspector", "@expo98/runtime-inspector-actions"),
  source("reviewOverlay", "@expo98/review-overlay-workflow"),
  source("reviewNextStep", "@expo98/review-next-guidance"),
  source("annotationServer", "@expo98/annotation-server-http"),
  source("devtoolsCommand", "@expo98/devtools-diagnostics"),
  source("consoleCommand", "@expo98/devtools-diagnostics"),
  source("errorsCommand", "@expo98/devtools-diagnostics"),
  source("metroCommand", "@expo98/metro-probes"),
  source("navigationCommand", "@expo98/navigation-deeplinks"),
  source("networkCommand", "@expo98/network-evidence"),
  source("storageCommand", "@expo98/bridge-domain-actions"),
  source("stateCommand", "@expo98/bridge-domain-actions"),
  source("controlsCommand", "@expo98/bridge-domain-actions"),
  source("bridgeCommand", "@expo98/bridge-command-adapter"),
  source("accessibilityCommand", "@expo98/accessibility-actions"),
  source("dialogCommand", "@expo98/modal-blocker-actions"),
  source("sheetCommand", "@expo98/modal-blocker-actions"),
  source("recordCommand", "@expo98/record-artifacts"),
  source("diffCommand", "@expo98/review-evidence-reports"),
  source("debugInspectCommand", "@expo98/debug-inspect-highlight"),
  source("highlightCommand", "@expo98/debug-inspect-highlight"),
  source("expoCommand", "@expo98/expo-introspection-actions"),
  source("rnCommand", "@expo98/rn-introspection"),
  source("perfCommand", "@expo98/perf-evidence"),
  source("dashboardCommand", "@expo98/dashboard-observability"),
  source("reviewCommand", "@expo98/review-evidence-reports"),
  source("policyCommand", "@expo98/policy-redaction"),
  source("redactCommand", "@expo98/policy-redaction"),
  source("skillsCommand", "@expo98/plugin-self-management"),
  source("installCommand", "@expo98/plugin-self-management"),
  source("upgradeCommand", "@expo98/plugin-self-management"),
  source("releaseCommand", "@expo98/plugin-self-management"),
  source("liveBacklogCommand", "@expo98/live-backlog"),
  source("traceInteraction", "@expo98/interaction-trace-expression"),
] as const satisfies readonly HandlerImplementationSource[];

export function toolNames(): string[] {
  return TOOL_HANDLER_BINDINGS.map(([toolName]) => toolName);
}

export function handlerSymbols(): string[] {
  return TOOL_HANDLER_BINDINGS.map(([, handlerSymbol]) => handlerSymbol);
}

export function handlerImplementationSources(): HandlerImplementationSource[] {
  return HANDLER_IMPLEMENTATION_SOURCES.map((item) => ({ ...item }));
}

export function handlerImplementationSourceBySymbol(handlerSymbol: string): HandlerImplementationSource | null {
  const source = HANDLER_IMPLEMENTATION_SOURCES.find((item) => item.handlerSymbol === handlerSymbol);
  return source ? { ...source } : null;
}

export function handlerSourcesByPackage(packageName: string): HandlerImplementationSource[] {
  return HANDLER_IMPLEMENTATION_SOURCES
    .filter((item) => item.packageName === packageName)
    .map((item) => ({ ...item }));
}

export function handlerSymbolByTool(toolName: string): string | null {
  return TOOL_HANDLER_BINDINGS.find(([candidate]) => candidate === toolName)?.[1] ?? null;
}

export function toolsForHandlerSymbol(handlerSymbol: string): string[] {
  return TOOL_HANDLER_BINDINGS
    .filter(([, candidate]) => candidate === handlerSymbol)
    .map(([toolName]) => toolName);
}

export function bindHandlers(implementations: Record<string, ToolHandler>): Record<string, ToolHandler> {
  const missing = handlerSymbols().filter((handlerSymbol) => implementations[handlerSymbol] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing handler implementations: ${missing.join(", ")}`);
  }
  return Object.fromEntries(TOOL_HANDLER_BINDINGS.map(([toolName, handlerSymbol]) => [
    toolName,
    implementations[handlerSymbol],
  ]));
}

function source(
  handlerSymbol: string,
  packageName: `@expo98/${string}`,
  exportName = handlerSymbol,
): HandlerImplementationSource {
  return { handlerSymbol, packageName, exportName };
}
