import {
  BRIDGE_DOMAIN_CATALOG,
  EXPO_IOS_BRIDGE_VERSION,
  type BridgeDomain,
  type NormalizedBridgeDomain,
  uniqueStrings
} from "./domain.js";

type UnknownRecord = Record<string, unknown>;

export function normalizeBridgeHealthValue(value: UnknownRecord | null | undefined) {
  const appRegistration = isRecord(value?.appRegistration) ? value.appRegistration : {};
  const metadata = value?.metadata && typeof value.metadata === "object" ? value.metadata : {};
  return {
    available: value?.available === true,
    code: optionalString(value?.code),
    reason: optionalString(value?.reason),
    registered: value?.registered === true || appRegistration.registered === true,
    bridgeVersion: optionalString(value?.bridgeVersion ?? value?.version ?? (metadata as UnknownRecord).bridgeVersion),
    appId: optionalString(value?.appId ?? appRegistration.appId),
    runtimeName: optionalString(value?.runtimeName ?? appRegistration.runtimeName),
    domains: Array.isArray(value?.domains) ? value.domains : []
  };
}

export function normalizeBridgeDomains(runtimeDomains: unknown[] = []): NormalizedBridgeDomain[] {
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

export function bridgeHealthUnavailable(payload: UnknownRecord & { domains?: NormalizedBridgeDomain[] }) {
  return {
    available: false,
    health: "unavailable",
    appRegistration: payload.appRegistration ?? { registered: false, appId: null, runtimeName: null },
    bridgeVersion: payload.bridgeVersion ?? null,
    compatibleCliVersion: false,
    expectedBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    cliBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    domainCount: payload.domains?.length ?? 0,
    writableDomainCount: (payload.domains ?? []).filter((domain) => domain.writeCommands?.length > 0).length,
    limitations: [
      "Bridge health requires Metro inspector access, a Hermes CDP target, and a development-only app bridge registration."
    ],
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

export function bridgeDomainPolicyPreview(args: { domain?: string | null; command?: string | null; actionPolicy?: string | null } = {}, domains: NormalizedBridgeDomain[]) {
  const requestedDomain = optionalString(args.domain);
  const requestedCommand = optionalString(args.command);
  if (!requestedDomain && !requestedCommand) {
    return null;
  }

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
  if (!optionalString(args.actionPolicy)) {
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
    source: args.actionPolicy,
    domain: domain.name,
    command: requestedCommand,
    actionPolicyRequired: true
  };
}

export function bridgeRedactionBoundaries(domains: NormalizedBridgeDomain[]) {
  return domains.map((domain) => ({
    domain: domain.name,
    boundaries: domain.redactionBoundaries
  }));
}

function normalizeBridgeDomain(base: BridgeDomain, runtime: UnknownRecord | null = null): NormalizedBridgeDomain {
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

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object";
}

function isRuntimeDomain(value: unknown): value is UnknownRecord & { name: string } {
  return isRecord(value) && typeof value.name === "string";
}
