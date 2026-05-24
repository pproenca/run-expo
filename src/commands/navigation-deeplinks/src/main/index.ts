import { evaluateHermesExpression as sharedEvaluateHermesExpression } from "../../../../platform/hermes-cdp-client/src/main/index.ts";
import { metroTargets } from "../../../metro-probes/src/main/index.ts";
import {
  openExpoRoute,
  routeActionPolicyDecision,
} from "../../../route-url-actions/src/main/index.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, unknown>;

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface NavigationCommandArgs {
  action?: unknown;
  metroPort?: unknown;
  tab?: unknown;
  route?: unknown;
  stateDir?: string;
  root?: string;
  cwd?: string;
  _?: string[];
  [key: string]: unknown;
}

export interface NavigationTarget {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  appId?: string | null;
  deviceName?: string | null;
  devtoolsFrontendUrl?: string | null;
  webSocketDebuggerUrl?: string | null;
  reactNative?: Record<string, unknown> | null;
  capabilities?: Record<string, unknown>;
}

export interface NavigationTargetSummary {
  id: string | null;
  title: string | null;
  description: string | null;
  appId: string | null;
  deviceName: string | null;
  devtoolsFrontendUrl: string | null;
  webSocketDebuggerUrl: string | null;
  reactNative: Record<string, unknown> | null;
  capabilities: {
    hermesRuntime: boolean;
    devtoolsFrontend: boolean;
    reactNative: boolean;
  } | Record<string, unknown>;
}

export interface NavigationPolicyDecision {
  checked: boolean;
  action: string;
  sideEffect: "read" | "device" | string;
  allowed: boolean;
  source?: string | null;
  reason: string;
  [key: string]: unknown;
}

export interface NavigationTransport {
  name: "metro-inspector-hermes-cdp";
  metroPort: number;
  protocol: "Runtime.evaluate";
  target: NavigationTargetSummary | null;
  cdp: unknown;
}

export interface HermesEvaluationResult {
  result?: { result?: { value?: unknown } };
  error?: string;
  diagnostics?: unknown;
}

export interface NavigationCommandDependencies {
  metroTargets?: (metroPort: number) => Promise<NavigationTarget[]>;
  evaluateHermesExpression?: (
    webSocketDebuggerUrl: string,
    expression: string,
    options: { timeoutMs: number },
  ) => Promise<HermesEvaluationResult | null | undefined>;
  policyDecision?: (
    args: NavigationCommandArgs,
    action: string,
    sideEffect: "device",
  ) => Promise<NavigationPolicyDecision>;
  openExpoRoute?: (args: NavigationCommandArgs) => Promise<ToolTextResult | OpenRouteResult>;
  selectedTargetId?: (args: NavigationCommandArgs) => Promise<string | null>;
  latestSessionId?: (args: NavigationCommandArgs) => Promise<string | null>;
}

export interface OpenRouteResult {
  platform?: unknown;
  device?: unknown;
  url?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  error?: unknown;
  route?: unknown;
  [key: string]: unknown;
}

const EXPO_IOS_BRIDGE_VERSION = "1.0.0";
const NAVIGATION_LIMITATIONS = [
  "Navigation state and imperative navigation actions require the dev-only app instrumentation bridge.",
  "Use open-route or navigation deep-link when only URL navigation is available.",
];

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}

export function targetSummary(target: NavigationTarget | null | undefined): NavigationTargetSummary | null {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative),
    },
  };
}

export function navigationTransport(
  metroPort: number,
  target: NavigationTarget | NavigationTargetSummary | null,
  cdp: unknown = null,
): NavigationTransport {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary(target),
    cdp,
  };
}

export function navigationUnavailable(args: {
  action: string;
  metroPort: number;
  reason: string;
  target?: NavigationTargetSummary | null;
  policy?: NavigationPolicyDecision | null;
}): JsonObject {
  return {
    available: false,
    action: args.action,
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    reason: args.reason,
    metroPort: args.metroPort,
    target: args.target ?? null,
    transport: navigationTransport(args.metroPort, args.target ?? null),
    policy: args.policy ?? null,
    limitations: NAVIGATION_LIMITATIONS,
  } as JsonObject;
}

export async function navigationPolicyDecision(
  args: NavigationCommandArgs,
  action: string,
  deps: Pick<NavigationCommandDependencies, "policyDecision"> = {},
): Promise<NavigationPolicyDecision> {
  const sideEffect = action === "state" ? "read" : "device";
  if (action === "state") {
    return {
      checked: true,
      action: `navigation.${action}`,
      sideEffect,
      allowed: true,
      reason: "Read action does not require policy approval.",
    };
  }
  if (action === "deep-link") {
    if (!deps.policyDecision) {
      return {
        checked: true,
        action: "open-route",
        sideEffect,
        allowed: false,
        source: null,
        reason: "No action policy allowed this state-changing operation.",
      };
    }
    return deps.policyDecision(args, "open-route", "device");
  }
  if (!deps.policyDecision) {
    return {
      checked: true,
      action: `navigation.${action}`,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation.",
    };
  }
  return deps.policyDecision(args, `navigation.${action}`, "device");
}

export async function navigationCommand(
  args: NavigationCommandArgs = {},
  deps: NavigationCommandDependencies = defaultNavigationDependencies,
): Promise<ToolTextResult> {
  const action = requireString(args.action ?? "state", "action");
  if (!["state", "back", "pop-to-root", "tab", "deep-link"].includes(action)) {
    throw new Error(`Unknown navigation action: ${action}`);
  }
  if (action === "deep-link") return toolJson(await navigationDeepLink(args, deps));

  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const policy = await navigationPolicyDecision(args, action, deps);
  if (!policy.allowed) {
    return toolJson({
      available: false,
      action,
      metroPort,
      source: "policy",
      evidenceSource: "policy",
      reason: policy.reason,
      policy,
      transport: navigationTransport(metroPort, null, null),
    });
  }

  const targets = deps.metroTargets ? await deps.metroTargets(metroPort) : [];
  const target = targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return toolJson(navigationUnavailable({ action, metroPort, reason: "No Metro inspector target.", policy }));
  }
  if (!deps.evaluateHermesExpression) {
    return toolJson(navigationUnavailable({
      action,
      metroPort,
      reason: "No Hermes evaluator is configured.",
      target: targetSummary(target),
      policy,
    }));
  }

  const result = await deps.evaluateHermesExpression(
    webSocketDebuggerUrl,
    navigationExpression({ action, tab: args.tab ?? args._?.[1] }),
    { timeoutMs: 5000 },
  );
  const value = result?.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return toolJson(navigationUnavailable({
      action,
      metroPort,
      reason: result?.error ?? "Navigation bridge did not return a value.",
      target: targetSummary(target),
      policy,
    }));
  }

  return toolJson({
    ...value,
    action,
    metroPort,
    target: targetSummary(target),
    transport: navigationTransport(metroPort, target, result?.diagnostics),
    evidenceSource: "source" in value && typeof value.source === "string" ? value.source : "unknown",
    policy,
  });
}

export async function navigationDeepLink(
  args: NavigationCommandArgs = {},
  deps: Pick<NavigationCommandDependencies, "policyDecision" | "openExpoRoute" | "selectedTargetId" | "latestSessionId"> = defaultNavigationDependencies,
): Promise<JsonObject> {
  const policy = await navigationPolicyDecision(args, "deep-link", deps);
  if (!policy.allowed) return { available: false, action: "deep-link", reason: policy.reason, policy } as JsonObject;
  if (!deps.openExpoRoute) {
    return { available: false, action: "deep-link", reason: "No open-route adapter is configured.", policy } as JsonObject;
  }

  const route = args.route ?? args._?.[1] ?? args._?.[0];
  const openedRaw = unwrapToolJson(await deps.openExpoRoute({ ...args, route }));
  if (!openedRaw || typeof openedRaw !== "object" || Array.isArray(openedRaw)) {
    return {
      available: false,
      action: "deep-link",
      source: "open-route",
      evidenceSource: "deep-link",
      reason: "Open-route result was malformed.",
      policy,
    } as JsonObject;
  }
  const opened = sanitizeOpenRouteResult(openedRaw as OpenRouteResult);
  return {
    available: true,
    action: "deep-link",
    source: "open-route",
    evidenceSource: "deep-link",
    transport: {
      name: "simulator-open-url",
      command: "open-route",
      target: opened.device ?? null,
    },
    policy,
    deepLink: opened,
    evidence: {
      targetId: await selectedTargetId(args, deps),
      sessionId: await latestSessionId(args, deps),
      route: route ?? opened.route ?? null,
      url: opened.url ?? null,
    },
  } as JsonObject;
}

const defaultNavigationDependencies: NavigationCommandDependencies = {
  metroTargets: (metroPort) => metroTargets(metroPort) as Promise<NavigationTarget[]>,
  evaluateHermesExpression: sharedEvaluateHermesExpression,
  openExpoRoute,
  policyDecision: (args, action) => routeActionPolicyDecision(args, action) as Promise<NavigationPolicyDecision>,
};

export function navigationExpression(args: { action: string; tab?: unknown }): string {
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const tab = ${JSON.stringify(args.tab ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    if (pluginBridge && typeof pluginBridge === 'object') {
      const metadata = pluginBridge.metadata || pluginBridge.expoIosDevtoolsBridgeMetadata || pluginBridge.bridgeMetadata || {};
      const bridgeVersion = metadata.bridgeVersion || pluginBridge.bridgeVersion || pluginBridge.version || null;
      if (bridgeVersion && bridgeVersion !== expectedBridgeVersion) {
        return {
          available: false,
          action,
          source: 'plugin-bridge',
          domain: 'navigation',
          code: 'version-mismatch',
          bridgeVersion,
          expectedBridgeVersion,
          reason: 'Navigation plugin bridge version is not compatible with this CLI.',
          state: null
        };
      }
      const domains = pluginBridge.domainRegistry || pluginBridge.domains || {};
      const navigation = pluginBridge.navigation ||
        (pluginBridge.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.navigation : null) ||
        (pluginBridge.domainRegistry ? pluginBridge.domainRegistry.navigation : null);
      const callTool = typeof pluginBridge.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
      const callNavigation = (name, payload = {}) => {
        if (navigation && typeof navigation[name] === 'function') return navigation[name](payload);
        if (navigation && navigation.actions && typeof navigation.actions[name] === 'function') return navigation.actions[name](payload);
        if (callTool) return callTool('navigation.' + name, payload);
        return null;
      };
      const hasNavigation = Boolean(navigation || callTool || (Array.isArray(domains) && domains.some((domain) => domain?.name === 'navigation')));
      if (hasNavigation) {
        if (action === 'state') {
          return {
            available: true,
            action,
            source: 'plugin-bridge',
            domain: 'navigation',
            bridgeVersion,
            state: navigation && typeof navigation.state !== 'function' ? navigation.state || null : callNavigation('state')
          };
        }
        if (action === 'back') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, result: callNavigation('back') };
        }
        if (action === 'pop-to-root') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, result: callNavigation('pop-to-root') || callNavigation('popToRoot') };
        }
        if (action === 'tab') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, tab, result: callNavigation('tab', { tab }) };
        }
      }
    }
    const bridge = globalThis.__EXPO_IOS_NAVIGATION_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.navigation);
    if (!bridge) {
      return {
        available: false,
        action,
        source: 'app-instrumentation',
        reason: 'Navigation bridge is not installed.',
        state: null
      };
    }
    if (action === 'state') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        state: typeof bridge.state === 'function' ? bridge.state() : bridge.state || null
      };
    }
    if (action === 'back') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        result: typeof bridge.back === 'function' ? bridge.back() : null
      };
    }
    if (action === 'pop-to-root') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        result: typeof bridge.popToRoot === 'function' ? bridge.popToRoot() : null
      };
    }
    if (action === 'tab') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        tab,
        result: typeof bridge.tab === 'function' ? bridge.tab(tab) : null
      };
    }
    return { available: false, action, source: 'app-instrumentation', reason: 'Unsupported navigation action.' };
  })()`;
}

export async function selectedTargetId(
  args: NavigationCommandArgs = {},
  deps: Pick<NavigationCommandDependencies, "selectedTargetId"> = {},
): Promise<string | null> {
  return deps.selectedTargetId ? deps.selectedTargetId(args) : null;
}

export async function latestSessionId(
  args: NavigationCommandArgs = {},
  deps: Pick<NavigationCommandDependencies, "latestSessionId"> = {},
): Promise<string | null> {
  return deps.latestSessionId ? deps.latestSessionId(args) : null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

function unwrapToolJson(result: ToolTextResult | JsonObject): unknown {
  if (isToolTextResult(result)) {
    const text = result.content[0]?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }
  return result;
}

function isToolTextResult(value: ToolTextResult | JsonObject): value is ToolTextResult {
  return Array.isArray((value as { content?: unknown }).content);
}

function sanitizeOpenRouteResult(result: OpenRouteResult): OpenRouteResult {
  return sanitizeSensitiveUrlStrings(result) as OpenRouteResult;
}

function sanitizeSensitiveUrlStrings(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveUrlQuery(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeSensitiveUrlStrings(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeSensitiveUrlStrings(item)]),
    );
  }
  return value;
}

function redactSensitiveUrlQuery(value: string): string {
  return value.replace(
    /([?&][^=\s&]*(?:cookie|token|authorization|password|secret)[^=\s&]*=)[^&\s]+/gi,
    "$1[redacted]",
  );
}
