import path from "node:path";

export const EXPO_IOS_BRIDGE_VERSION = "1.0.0";

export type UnknownRecord = Record<string, unknown>;
export type BridgeAction = "health" | "domains";
export type BridgeState = "absent" | "present" | "stale" | "incompatible";

export type BridgeInstallStatus = {
  projectRoot: string;
  state: BridgeState;
  bridgeVersion: unknown;
  expectedBridgeVersion: string;
  developmentOnly: boolean;
  metadataPath: string;
  sourcePath: string;
  files: { metadata: boolean; source: boolean };
  dependencies: { expo: unknown; rozenite: Array<{ name: string; version: unknown }> };
  issues: Array<{ code: string; message: string }>;
};

export type BridgeHealthPayloadArgs = {
  metroPort?: unknown;
  domain?: unknown;
  command?: unknown;
  actionPolicy?: unknown;
};

export type MetroTarget = UnknownRecord & {
  webSocketDebuggerUrl?: string;
};

export type MetroTargetsResult = {
  available: boolean;
  endpoint: string;
  targets: MetroTarget[];
  malformedTargets?: unknown[];
  reason?: string | null;
};

export type HermesEvaluationResult = {
  result?: { result?: { value?: unknown } };
  diagnostics?: unknown;
  cdp?: unknown;
  error?: string | null;
};

export type BridgeHealthPayloadDependencies = {
  metroTargets?: (metroPort: number) => Promise<MetroTargetsResult> | MetroTargetsResult;
  evaluateHermesExpression?: (webSocketDebuggerUrl: string, expression: string, options: { timeoutMs: 5000 }) => Promise<HermesEvaluationResult> | HermesEvaluationResult;
  resolvePath?: (...parts: string[]) => string;
};

export const BRIDGE_DOMAIN_CATALOG = Object.freeze([
  { name: "navigation", readCommands: ["state"], writeCommands: ["back", "pop-to-root", "tab", "deep-link"], redactionBoundaries: ["route params", "query values"] },
  { name: "network", readCommands: ["list", "request", "har.start", "har.stop"], writeCommands: ["clear"], redactionBoundaries: ["headers.authorization", "headers.cookie", "requestBody", "responseBody"] },
  { name: "storage", readCommands: ["list", "get"], writeCommands: ["set", "clear"], redactionBoundaries: ["keys", "values", "secure-store values"] },
  { name: "state", readCommands: ["list", "save"], writeCommands: ["load", "clear"], redactionBoundaries: ["snapshot values"] },
  { name: "controls", readCommands: ["list", "get"], writeCommands: ["press"], redactionBoundaries: ["control labels", "control props"] },
  { name: "performance", readCommands: ["mark.list", "measure.list", "memory.sample"], writeCommands: ["mark.add", "measure.start", "measure.stop"], redactionBoundaries: ["mark names", "measure names"] },
  { name: "snapshot", readCommands: ["capture", "refs"], writeCommands: [], redactionBoundaries: ["text content", "accessibility labels", "props"] },
  { name: "rn", readCommands: ["tree", "inspect", "fiber"], writeCommands: [], redactionBoundaries: ["props", "component names", "text content"] }
]);

export async function bridgeHealthPayload(
  args: BridgeHealthPayloadArgs,
  { action, status, plan }: { action: BridgeAction; status: BridgeInstallStatus; plan: unknown },
  dependencies: BridgeHealthPayloadDependencies = {}
): Promise<Record<string, any>> {
  const deps = bridgeHealthPayloadDependencies(dependencies);
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const transport: UnknownRecord = {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    inspectorEndpoint: `http://127.0.0.1:${metroPort}/json/list`,
    protocol: "Runtime.evaluate",
    target: null,
    cdp: null
  };
  const install = bridgeInstallSummary(status);
  const catalogDomains = bridgeDomainsFromCatalog();

  if (status.state === "stale" || status.state === "incompatible") {
    return bridgeHealthUnavailable({
      action,
      code: status.state === "stale" ? "stale-bridge" : "incompatible-project",
      reason: status.issues[0]?.message ?? `Bridge install status is ${status.state}.`,
      status,
      install,
      transport,
      domains: catalogDomains,
      policy: bridgeDomainPolicyPreview(args, catalogDomains, deps),
      plan
    });
  }

  const targetResult = await deps.metroTargets(metroPort);
  const target = targetResult.targets.find((item) => typeof item.webSocketDebuggerUrl === "string" && item.webSocketDebuggerUrl.length > 0)
    ?? targetResult.targets[0]
    ?? null;
  transport.target = targetSummary(target);

  if (!target?.webSocketDebuggerUrl) {
    return bridgeHealthUnavailable({
      action,
      code: "transport-failure",
      reason: targetResult.reason ?? "No Metro Hermes inspector target is available for bridge discovery.",
      status,
      install,
      transport,
      domains: catalogDomains,
      policy: bridgeDomainPolicyPreview(args, catalogDomains, deps),
      plan,
      metro: {
        available: targetResult.available,
        endpoint: targetResult.endpoint,
        targetCount: targetResult.targets.length,
        malformedTargets: targetResult.malformedTargets
      }
    });
  }

  const result = await deps.evaluateHermesExpression(target.webSocketDebuggerUrl, bridgeHealthExpression(), { timeoutMs: 5000 });
  transport.cdp = result.diagnostics ?? result.cdp ?? null;
  const value = result.result?.result?.value;
  if (!value) {
    return bridgeHealthUnavailable({
      action,
      code: "transport-failure",
      reason: result.error ?? "Bridge health Runtime.evaluate did not return a value.",
      status,
      install,
      transport,
      domains: catalogDomains,
      policy: bridgeDomainPolicyPreview(args, catalogDomains, deps),
      plan
    });
  }

  const normalized = normalizeBridgeHealthValue(value);
  const domains = normalizeBridgeDomains(normalized.domains);
  const policy = bridgeDomainPolicyPreview(args, domains, deps);
  const base = {
    action,
    source: "app-instrumentation",
    install,
    projectRoot: status.projectRoot,
    status: status.state,
    expectedBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    cliBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    bridgeVersion: normalized.bridgeVersion,
    compatibleCliVersion: normalized.bridgeVersion === EXPO_IOS_BRIDGE_VERSION,
    appRegistration: {
      registered: normalized.registered === true,
      appId: normalized.appId,
      runtimeName: normalized.runtimeName
    },
    transport,
    domains,
    policy,
    redactionBoundaries: bridgeRedactionBoundaries(domains)
  };

  if (normalized.available !== true) {
    const code = normalized.code ?? (normalized.registered === false ? "missing-app-registration" : "missing-bridge");
    return bridgeHealthUnavailable({
      ...base,
      action,
      code,
      reason: normalized.reason ?? bridgeHealthReason(code),
      status,
      install,
      transport,
      domains,
      policy
    });
  }
  if (normalized.registered !== true) {
    return bridgeHealthUnavailable({
      ...base,
      action,
      code: "missing-app-registration",
      reason: normalized.reason ?? "The bridge object exists but the app has not registered with it.",
      status,
      install,
      transport,
      domains,
      policy
    });
  }
  if (normalized.bridgeVersion !== EXPO_IOS_BRIDGE_VERSION) {
    return bridgeHealthUnavailable({
      ...base,
      action,
      code: "version-mismatch",
      reason: `Bridge version ${normalized.bridgeVersion ?? "unknown"} does not match CLI bridge version ${EXPO_IOS_BRIDGE_VERSION}.`,
      status,
      install,
      transport,
      domains,
      policy
    });
  }

  return {
    ...base,
    available: true,
    health: "healthy",
    code: "healthy",
    domainCount: domains.length,
    writableDomainCount: domains.filter((domain) => domain.writeCommands.length > 0).length
  };
}

export function bridgeInstallSummary(status: BridgeInstallStatus) {
  return {
    state: status.state,
    bridgeVersion: status.bridgeVersion,
    expectedBridgeVersion: status.expectedBridgeVersion,
    developmentOnly: status.developmentOnly,
    files: status.files,
    dependencies: status.dependencies,
    issues: status.issues
  };
}

export function bridgeHealthUnavailable(payload: UnknownRecord & { domains?: Array<{ writeCommands?: unknown[] }> }): Record<string, any> {
  return {
    available: false,
    health: "unavailable",
    appRegistration: payload.appRegistration ?? { registered: false, appId: null, runtimeName: null },
    bridgeVersion: payload.bridgeVersion ?? null,
    compatibleCliVersion: false,
    expectedBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    cliBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    domainCount: payload.domains?.length ?? 0,
    writableDomainCount: (payload.domains ?? []).filter((domain) => (domain.writeCommands ?? []).length > 0).length,
    limitations: ["Bridge health requires Metro inspector access, a Hermes CDP target, and a development-only app bridge registration."],
    ...payload
  };
}

export function bridgeHealthReason(code: string): string {
  if (code === "missing-bridge") return "No Expo iOS devtools bridge object was found in the running app.";
  if (code === "missing-app-registration") return "The bridge object exists but the app has not registered with it.";
  if (code === "version-mismatch") return "The running bridge version is not compatible with this CLI.";
  if (code === "transport-failure") return "Metro/Hermes transport is unavailable.";
  return "Bridge health is unavailable.";
}

export function normalizeBridgeHealthValue(value: unknown) {
  const record = isRecord(value) ? value : {};
  const appRegistration = isRecord(record.appRegistration) ? record.appRegistration : {};
  const metadata = isRecord(record.metadata) ? record.metadata : {};
  return {
    available: record.available === true,
    code: optionalString(record.code),
    reason: optionalString(record.reason),
    registered: record.registered === true || appRegistration.registered === true,
    bridgeVersion: optionalString(record.bridgeVersion ?? record.version ?? metadata.bridgeVersion),
    appId: optionalString(record.appId ?? appRegistration.appId),
    runtimeName: optionalString(record.runtimeName ?? appRegistration.runtimeName),
    domains: Array.isArray(record.domains) ? record.domains : []
  };
}

export function normalizeBridgeDomains(runtimeDomains: unknown[] = []) {
  const runtimeByName = new Map(runtimeDomains
    .filter(isRuntimeDomain)
    .map((domain) => [domain.name, domain]));
  const domains = BRIDGE_DOMAIN_CATALOG.map((base) => normalizeBridgeDomain(base, runtimeByName.get(base.name)));
  for (const runtime of runtimeByName.values()) {
    if (!BRIDGE_DOMAIN_CATALOG.some((base) => base.name === runtime.name)) {
      domains.push(normalizeBridgeDomain({
        name: runtime.name,
        readCommands: [],
        writeCommands: [],
        redactionBoundaries: ["domain-defined values"]
      }, runtime));
    }
  }
  return domains;
}

export function bridgeDomainsFromCatalog() {
  return normalizeBridgeDomains([]);
}

export function bridgeRedactionBoundaries(domains: Array<{ name: string; redactionBoundaries: string[] }>) {
  return domains.map((domain) => ({
    domain: domain.name,
    boundaries: domain.redactionBoundaries
  }));
}

export function bridgeDomainPolicyPreview(
  args: BridgeHealthPayloadArgs,
  domains: Array<{ name: string; readCommands: string[]; writeCommands: string[] }>,
  dependencies: Pick<Required<BridgeHealthPayloadDependencies>, "resolvePath"> = bridgeHealthPayloadDependencies({})
) {
  const requestedDomain = optionalString(args.domain);
  const requestedCommand = optionalString(args.command);
  if (!requestedDomain && !requestedCommand) return null;
  const domain = domains.find((item) => item.name === requestedDomain) ?? null;
  const isWrite = Boolean(domain && requestedCommand && domain.writeCommands.includes(requestedCommand));
  const isRead = Boolean(domain && requestedCommand && domain.readCommands.includes(requestedCommand));
  if (!domain) {
    return {
      checked: true,
      allowed: false,
      denied: true,
      reason: `Unknown bridge domain ${requestedDomain ?? "(none)"}.`,
      domain: requestedDomain,
      command: requestedCommand
    };
  }
  if (requestedCommand && !isRead && !isWrite) {
    return {
      checked: true,
      allowed: false,
      denied: true,
      reason: `Unknown bridge command ${requestedCommand} for domain ${domain.name}.`,
      domain: domain.name,
      command: requestedCommand
    };
  }
  if (!isWrite) {
    return {
      checked: true,
      allowed: true,
      denied: false,
      sideEffect: "read",
      reason: "Read command does not require action policy approval.",
      domain: domain.name,
      command: requestedCommand
    };
  }
  const policyAction = `${domain.name}.${requestedCommand}`;
  const policyPath = optionalString(args.actionPolicy);
  if (!policyPath) {
    return {
      checked: true,
      allowed: false,
      denied: true,
      sideEffect: "write",
      action: policyAction,
      reason: "No action policy allowed this bridge write command.",
      domain: domain.name,
      command: requestedCommand,
      actionPolicyRequired: true
    };
  }
  return {
    checked: true,
    allowed: null,
    denied: null,
    sideEffect: "write",
    action: policyAction,
    reason: "Policy file will be evaluated before executing bridge write commands.",
    source: dependencies.resolvePath(policyPath),
    domain: domain.name,
    command: requestedCommand,
    actionPolicyRequired: true
  };
}

export function targetSummary(target: MetroTarget | null | undefined) {
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
      reactNative: Boolean(target.reactNative)
    }
  };
}

export function bridgeHealthExpression(): string {
  return `(() => {
    const __EXPO_IOS_BRIDGE_HEALTH__ = true;
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    return globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ || globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ || globalThis.__ROZENITE_AGENT_BRIDGE__ || globalThis.__EXPO_IOS_INSTRUMENTATION__ || { available: false, code: "missing-bridge", reason: "No bridge global is registered.", expectedBridgeVersion };
  })()`;
}

function bridgeHealthPayloadDependencies(dependencies: BridgeHealthPayloadDependencies): Required<BridgeHealthPayloadDependencies> {
  return {
    metroTargets: dependencies.metroTargets ?? defaultMetroTargets,
    evaluateHermesExpression: dependencies.evaluateHermesExpression ?? defaultEvaluateHermesExpression,
    resolvePath: dependencies.resolvePath ?? path.resolve
  };
}

function defaultMetroTargets(metroPort: number): MetroTargetsResult {
  return {
    available: false,
    endpoint: `http://127.0.0.1:${metroPort}/json/list`,
    targets: [],
    malformedTargets: [],
    reason: "Metro target dependency was not provided."
  };
}

function defaultEvaluateHermesExpression(): HermesEvaluationResult {
  return { error: "Hermes evaluation dependency was not provided." };
}

function normalizeBridgeDomain(base: { name: string; readCommands: string[]; writeCommands: string[]; redactionBoundaries: string[] }, runtime: UnknownRecord | null = null) {
  const readCommands = uniqueStrings(runtime?.readCommands ?? runtime?.reads ?? base.readCommands);
  const writeCommands = uniqueStrings(runtime?.writeCommands ?? runtime?.writes ?? base.writeCommands);
  return {
    name: base.name,
    available: runtime?.available !== false,
    readCommands,
    writeCommands,
    writable: writeCommands.length > 0,
    actionPolicyRequiredForWrites: writeCommands.length > 0,
    redactionBoundaries: uniqueStrings(runtime?.redactionBoundaries ?? base.redactionBoundaries),
    transport: "hermes-cdp Runtime.evaluate",
    source: runtime ? "runtime-registration" : "cli-catalog"
  };
}

function uniqueStrings(value: unknown): string[] {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim())));
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRuntimeDomain(value: unknown): value is UnknownRecord & { name: string } {
  return isRecord(value) && typeof value.name === "string";
}

function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}
