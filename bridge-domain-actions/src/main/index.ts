export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface BridgeTarget {
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

export interface TargetSummary {
  id: string | null;
  title: string | null;
  description: string | null;
  appId: string | null;
  deviceName: string | null;
  devtoolsFrontendUrl: string | null;
  webSocketDebuggerUrl: string | null;
  reactNative: Record<string, unknown> | null;
  capabilities: Record<string, unknown>;
}

export interface PolicyDecision {
  checked?: boolean;
  action?: string;
  sideEffect?: string;
  allowed?: boolean | null;
  source?: string | null;
  reason?: string;
  [key: string]: unknown;
}

export interface HermesEvaluationResult {
  result?: { result?: { value?: unknown } };
  error?: string;
  diagnostics?: unknown;
  cdp?: unknown;
}

export interface BridgeDomainDependencies {
  metroTargets?: (metroPort: number) => Promise<BridgeTarget[]> | BridgeTarget[];
  evaluateHermesExpression?: (
    webSocketDebuggerUrl: string,
    expression: string,
    options: { timeoutMs: number },
  ) => Promise<HermesEvaluationResult | null | undefined> | HermesEvaluationResult | null | undefined;
  readJsonFile?: (file: string) => Promise<unknown> | unknown;
  resolvePath?: (file: string) => string;
  redactValue?: (value: unknown) => unknown;
}

export interface BridgeRuntimeTransport {
  name: "metro-inspector-hermes-cdp";
  metroPort: number;
  protocol: "Runtime.evaluate";
  target: TargetSummary | null;
  cdp: unknown;
}

export interface DomainUnavailable {
  available: false;
  domain: string;
  action: string;
  source: "app-instrumentation";
  evidenceSource: "unavailable";
  code: string;
  reason: string;
  metroPort: number;
  target: TargetSummary | null;
  transport: BridgeRuntimeTransport;
  policy: PolicyDecision | null;
  limitations: string[];
}

export interface BridgeDomainCommandInput {
  args: Record<string, unknown>;
  domain: string;
  action: string;
  expression: string;
  policy: PolicyDecision | null;
}

const EXPO_IOS_BRIDGE_VERSION = "1.0.0";
const MAX_OUTPUT = 40_000;
const MAX_ARRAY_ITEMS = 1000;

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: stringifyBoundedJson(value) }] };
}

export async function storageCommand(
  args: Record<string, unknown> = {},
  deps: BridgeDomainDependencies = {},
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const store = requireString(args.store ?? positionals[0], "store");
  const action = requireString(args.action ?? positionals[1] ?? "list", "action");
  if (!["list", "get", "set", "clear"].includes(action)) throw new Error(`Unknown storage action: ${action}`);
  const key = args.key ?? positionals[2];
  const sideEffect = action === "list" || action === "get" ? "read" : "write";
  const policy = await policyDecision(args, `storage.${action}`, sideEffect, deps);
  if (!policy.allowed) return toolJson(policyDeniedPayload({ domain: "storage", action, policy }));
  const value = action === "set" ? parseStorageValue(args.value ?? positionals[3]) : null;
  return toolJson(await bridgeDomainCommand({
    args,
    domain: "storage",
    action,
    expression: storageExpression({
      store,
      action,
      key,
      value,
      limit: clampNumber(args.limit ?? 100, 1, 1000),
    }),
    policy,
  }, deps));
}

export async function stateCommand(
  args: Record<string, unknown> = {},
  deps: BridgeDomainDependencies = {},
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "list", "action");
  if (!["list", "save", "load", "clear"].includes(action)) throw new Error(`Unknown state action: ${action}`);
  const sideEffect = action === "list" || action === "save" ? "read" : "write";
  const policy = await policyDecision(args, `state.${action}`, sideEffect, deps);
  if (!policy.allowed) return toolJson(policyDeniedPayload({ domain: "state", action, policy }));
  return toolJson(await bridgeDomainCommand({
    args,
    domain: "state",
    action,
    expression: stateExpression({ action, name: args.name ?? positionals[1] }),
    policy,
  }, deps));
}

export async function controlsCommand(
  args: Record<string, unknown> = {},
  deps: BridgeDomainDependencies = {},
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "list", "action");
  if (!["list", "get", "press"].includes(action)) throw new Error(`Unknown controls action: ${action}`);
  const sideEffect = action === "press" ? "device" : "read";
  const policy = await policyDecision(args, `controls.${action}`, sideEffect, deps);
  if (!policy.allowed) return toolJson(policyDeniedPayload({ domain: "controls", action, policy }));
  return toolJson(await bridgeDomainCommand({
    args,
    domain: "controls",
    action,
    expression: controlsExpression({ action, name: args.name ?? positionals[1] }),
    policy,
  }, deps));
}

async function bridgeDomainCommand(
  input: BridgeDomainCommandInput,
  deps: BridgeDomainDependencies = {},
): Promise<Record<string, any> | DomainUnavailable> {
  const metroPort = clampNumber(input.args.metroPort ?? 8081, 1, 65535);
  const sideEffect = bridgeActionSideEffect(input.domain, input.action);
  if (sideEffect !== "read" && input.policy?.allowed !== true) {
    return policyDeniedPayload({ domain: input.domain, action: input.action, policy: input.policy ?? {
      checked: true,
      action: `${input.domain}.${input.action}`,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation.",
    } });
  }
  const targets = deps.metroTargets ? await deps.metroTargets(metroPort) : [];
  const target = targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      policy: input.policy,
    });
  }
  if (!deps.evaluateHermesExpression) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: `${input.domain} bridge did not return a value.`,
      target: targetSummary(target),
      policy: input.policy,
    });
  }
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, input.expression, { timeoutMs: 5000 });
  const value = result?.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: result?.error ?? `${input.domain} bridge did not return a value.`,
      target: targetSummary(target),
      transport: bridgeRuntimeTransport(metroPort, target, result?.diagnostics ?? result?.cdp ?? null),
      policy: input.policy,
    });
  }
  const redacted = sanitizePayload(deps.redactValue ? deps.redactValue(value) : value) as Record<string, any>;
  return sanitizePayload({
    ...redacted,
    domain: input.domain,
    action: input.action,
    metroPort,
    target: targetSummary(target),
    transport: bridgeRuntimeTransport(metroPort, target, result?.diagnostics ?? result?.cdp ?? null),
    evidenceSource: typeof redacted.source === "string" ? redacted.source : "unknown",
    policy: input.policy,
  }) as Record<string, any>;
}

export function domainUnavailable(args: {
  domain: string;
  action: string;
  metroPort: number;
  reason: string;
  target?: TargetSummary | BridgeTarget | null;
  policy?: PolicyDecision | null;
  code?: string;
  transport?: BridgeRuntimeTransport | null;
}): DomainUnavailable {
  return sanitizePayload({
    available: false,
    domain: args.domain,
    action: args.action,
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    code: args.code ?? "unavailable",
    reason: args.reason,
    metroPort: args.metroPort,
    target: targetSummary(args.target),
    transport: args.transport ?? bridgeRuntimeTransport(args.metroPort, args.target ?? null, null),
    policy: args.policy ?? null,
    limitations: [`${args.domain} evidence requires the dev-only app instrumentation bridge.`],
  }) as DomainUnavailable;
}

export function bridgeRuntimeTransport(
  metroPort: number,
  target: BridgeTarget | TargetSummary | null | undefined,
  cdp: unknown = null,
): BridgeRuntimeTransport {
  return sanitizePayload({
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary(target),
    cdp,
  }) as BridgeRuntimeTransport;
}

export function policyDeniedPayload(args: {
  domain: string;
  action: string;
  policy: PolicyDecision;
}): Record<string, unknown> {
  return sanitizePayload({
    available: false,
    domain: args.domain,
    action: args.action,
    source: "policy",
    evidenceSource: "policy",
    code: "policy-denied",
    denied: true,
    reason: "Policy denied action.",
    policy: args.policy,
  }) as Record<string, unknown>;
}

export async function policyDecision(
  args: Record<string, unknown>,
  action: string,
  sideEffect: string,
  deps: Pick<BridgeDomainDependencies, "readJsonFile" | "resolvePath"> = {},
): Promise<PolicyDecision> {
  if (sideEffect === "read") {
    return { checked: true, action, sideEffect, allowed: true, source: null, reason: "Read action does not require policy approval." };
  }
  const policyPath = optionalString(args.actionPolicy);
  if (!policyPath) {
    return { checked: true, action, sideEffect, allowed: false, source: null, reason: "No action policy allowed this state-changing operation." };
  }
  const resolved = deps.resolvePath ? deps.resolvePath(policyPath) : policyPath;
  if (!deps.readJsonFile) throw new Error("policyDecision requires readJsonFile when actionPolicy is supplied.");
  const policy = await deps.readJsonFile(resolved);
  const allowed = policyAllowsAction(policy, action);
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: resolved,
    reason: allowed ? "Action allowed by policy." : "Action policy did not allow this operation.",
  };
}

export function policyAllowsAction(policy: unknown, action: string): boolean {
  const record = asRecord(policy);
  if (Array.isArray(record?.allow) && record.allow.includes(action)) return true;
  const actions = asRecord(record?.actions);
  return actions?.[action] === "allow" || actions?.[action] === true;
}

export function parseStorageValue(value: unknown): unknown {
  if (value === undefined) throw new Error("storage set requires a JSON value.");
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON for --value: ${formatError(error)}`);
  }
}

function storageExpression(args: {
  store: unknown;
  action: unknown;
  key?: unknown;
  value?: unknown;
  limit: number;
}): string {
  return `(() => {
    const store = ${JSON.stringify(args.store)};
    const action = ${JSON.stringify(args.action)};
    const key = ${JSON.stringify(args.key ?? null)};
    const value = ${JSON.stringify(args.value)};
    const limit = ${Number(args.limit)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginStorage = pluginBridge?.storage ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.storage : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.storage : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callStorage = (name, payload = {}) => {
      if (pluginStorage && typeof pluginStorage[name] === 'function') return pluginStorage[name](payload);
      if (pluginStorage && pluginStorage.actions && typeof pluginStorage.actions[name] === 'function') return pluginStorage.actions[name](payload);
      if (pluginCallTool) return pluginCallTool('storage.' + name, payload);
      return null;
    };
    const hasPluginStorage = Boolean(pluginStorage || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'storage')));
    if (hasPluginStorage) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Storage plugin bridge version is not compatible with this CLI.', store, action };
      }
      const adapters = pluginStorage?.adapters || pluginStorage?.stores || pluginStorage || {};
      const adapter = adapters[store] || (pluginStorage?.store && pluginStorage.store(store)) || null;
      const read = (targetKey) => adapter && typeof adapter.get === 'function' ? adapter.get(targetKey) : adapter?.values?.[targetKey];
      if (!adapter && !pluginCallTool) return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'missing-domain', reason: 'Storage bridge store is not registered.', store, action };
      if (action === 'list') {
        const keys = adapter ? (adapter.list ? adapter.list() : adapter.keys || []) : callStorage('list', { store, limit });
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, keys: (Array.isArray(keys) ? keys : []).slice(0, limit) };
      }
      if (action === 'get') return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, key, value: adapter ? read(key) : callStorage('get', { store, key }) };
      if (action === 'set') {
        const before = adapter ? read(key) : null;
        const result = adapter && typeof adapter.set === 'function' ? adapter.set(key, value) : callStorage('set', { store, key, value });
        const after = adapter ? read(key) : null;
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, key, before, after, result: result || { ok: true } };
      }
      if (action === 'clear') {
        const beforeKeys = adapter ? (adapter.list ? adapter.list() : adapter.keys || []) : [];
        const result = adapter && typeof adapter.clear === 'function' ? adapter.clear() : callStorage('clear', { store });
        const afterKeys = adapter ? (adapter.list ? adapter.list() : adapter.keys || []) : [];
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, before: { keys: beforeKeys }, after: { keys: afterKeys }, result: result || { ok: true } };
      }
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'missing-domain', reason: 'Storage bridge domain is not registered.', store, action };
    }
    const bridge = globalThis.__EXPO_IOS_STORAGE_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.storage);
    if (!bridge) return { available: false, source: 'app-instrumentation', code: 'unavailable-bridge', reason: 'Storage bridge is not installed.', store, action };
    const adapter = bridge[store];
    if (!adapter) return { available: false, source: 'app-instrumentation', reason: 'Unsupported storage store.', store, action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', store, action, keys: (adapter.list ? adapter.list() : adapter.keys || []).slice(0, limit) };
    if (action === 'get') return { available: true, source: 'app-instrumentation', store, action, key, value: adapter.get ? adapter.get(key) : (adapter.values || {})[key] };
    if (action === 'set') return { available: true, source: 'app-instrumentation', store, action, key, result: adapter.set ? adapter.set(key, value) : { ok: true } };
    if (action === 'clear') return { available: true, source: 'app-instrumentation', store, action, result: adapter.clear ? adapter.clear() : { ok: true } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported storage action.', store, action };
  })()`;
}

function stateExpression(args: { action: unknown; name?: unknown }): string {
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const name = ${JSON.stringify(args.name ?? null)};
    const bridge = globalThis.__EXPO_IOS_STATE_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.state);
    if (!bridge) return { available: false, source: 'app-instrumentation', reason: 'State bridge is not installed.', action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', action, states: bridge.list ? bridge.list() : bridge.states || [] };
    if (action === 'save') return { available: true, source: 'app-instrumentation', action, name, result: bridge.save ? bridge.save(name) : { ok: true, name } };
    if (action === 'load') return { available: true, source: 'app-instrumentation', action, name, result: bridge.load ? bridge.load(name) : { ok: true, name } };
    if (action === 'clear') return { available: true, source: 'app-instrumentation', action, name, result: bridge.clear ? bridge.clear(name) : { ok: true, name } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported state action.', action };
  })()`;
}

function controlsExpression(args: { action: unknown; name?: unknown }): string {
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const name = ${JSON.stringify(args.name ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginControls = pluginBridge?.controls ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.controls : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.controls : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callControls = (command, payload = {}) => {
      if (pluginControls && typeof pluginControls[command] === 'function') return pluginControls[command](payload);
      if (pluginControls && pluginControls.actions && typeof pluginControls.actions[command] === 'function') return pluginControls.actions[command](payload);
      if (pluginCallTool) return pluginCallTool('controls.' + command, payload);
      return null;
    };
    const hasPluginControls = Boolean(pluginControls || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'controls')));
    if (hasPluginControls) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge', domain: 'controls', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Controls plugin bridge version is not compatible with this CLI.', action };
      }
      const listControls = () => {
        const raw = pluginControls && typeof pluginControls.list === 'function'
          ? pluginControls.list()
          : pluginControls?.controls || callControls('list') || [];
        return Array.isArray(raw) ? raw : [];
      };
      if (action === 'list') return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, controls: listControls() };
      if (action === 'get') return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, name, control: pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null };
      if (action === 'press') {
        const before = pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null;
        const result = pluginControls && typeof pluginControls.press === 'function' ? pluginControls.press(name) : callControls('press', { name });
        const after = pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null;
        return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, name, before, after, result: result || { ok: true, name } };
      }
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge', domain: 'controls', code: 'missing-domain', reason: 'Controls bridge domain is not registered.', action };
    }
    const bridge = globalThis.__EXPO_IOS_CONTROLS_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.controls);
    if (!bridge) return { available: false, source: 'app-instrumentation', code: 'unavailable-bridge', reason: 'Controls bridge is not installed.', action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', action, controls: bridge.list ? bridge.list() : bridge.controls || [] };
    if (action === 'get') return { available: true, source: 'app-instrumentation', action, name, control: bridge.get ? bridge.get(name) : (bridge.controls || []).find((control) => control.name === name) || null };
    if (action === 'press') return { available: true, source: 'app-instrumentation', action, name, result: bridge.press ? bridge.press(name) : { ok: true, name } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported controls action.', action };
  })()`;
}

export function targetSummary(target: BridgeTarget | TargetSummary | null | undefined): TargetSummary | null {
  if (!target) return null;
  return sanitizePayload({
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
  }) as TargetSummary;
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sanitizePayload(value: unknown): unknown {
  return boundValue(redactValue(value));
}

function stringifyBoundedJson(value: unknown): string {
  const sanitized = sanitizePayload(value);
  const text = JSON.stringify(sanitized, null, 2);
  if (text.length <= MAX_OUTPUT) return text;
  const record = asRecord(sanitized);
  const envelope: Record<string, unknown> = {
    available: false,
    source: "output-boundary",
    evidenceSource: "output-boundary",
    code: "output-truncated",
    outputTruncated: true,
    originalLength: text.length,
    domain: record?.domain,
    action: record?.action,
    preview: "",
  };
  let budget = MAX_OUTPUT - JSON.stringify(envelope, null, 2).length - 128;
  envelope.preview = text.slice(0, Math.max(0, budget));
  let output = JSON.stringify(envelope, null, 2);
  while (output.length > MAX_OUTPUT && typeof envelope.preview === "string") {
    budget -= output.length - MAX_OUTPUT + 128;
    envelope.preview = envelope.preview.slice(0, Math.max(0, budget));
    output = JSON.stringify(envelope, null, 2);
  }
  return output;
}

function bridgeActionSideEffect(domain: string, action: string): "read" | "write" | "device" | "unknown" {
  if (domain === "storage") return action === "list" || action === "get" ? "read" : "write";
  if (domain === "state") return action === "list" || action === "save" ? "read" : "write";
  if (domain === "controls") return action === "press" ? "device" : "read";
  return "unknown";
}

function boundValue(value: unknown): unknown {
  if (typeof value === "string") return truncate(value);
  if (Array.isArray(value)) return value.slice(-MAX_ARRAY_ITEMS).map(boundValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, boundValue(nested)]));
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [
    key,
    isSensitiveKey(key) ? "[redacted]" : redactValue(nested),
  ]));
}

function redactString(value: string): string {
  try {
    const parsed = new URL(value);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveKey(key)) {
        parsed.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    return changed ? parsed.toString() : value;
  } catch {
    return value.replace(/([?&](?:cookie|token|authorization|password|secret|api[-_]?key|apikey)=)[^&\s]+/gi, "$1[redacted]");
  }
}

function isSensitiveKey(key: string): boolean {
  return /token|authorization|cookie|password|secret|apikey|apiKey/i.test(key);
}

function truncate(value: unknown, max = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function formatError(error: unknown): string {
  const record = asRecord(error);
  return record?.message == null ? String(error) : String(record.message);
}
