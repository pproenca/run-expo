export const EXPO_IOS_BRIDGE_VERSION = "1.0.0";

export interface BridgeDomainCatalogEntry {
  name: string;
  readCommands: string[];
  writeCommands: string[];
  redactionBoundaries: string[];
}

export const BRIDGE_DOMAIN_CATALOG: BridgeDomainCatalogEntry[] = [
  {
    name: "navigation",
    readCommands: ["state"],
    writeCommands: ["back", "pop-to-root", "tab", "deep-link"],
    redactionBoundaries: ["route params", "query values"],
  },
  {
    name: "network",
    readCommands: ["list", "request", "har.start", "har.stop"],
    writeCommands: ["clear"],
    redactionBoundaries: ["headers.authorization", "headers.cookie", "requestBody", "responseBody"],
  },
  {
    name: "storage",
    readCommands: ["list", "get"],
    writeCommands: ["set", "clear"],
    redactionBoundaries: ["keys", "values", "secure-store values"],
  },
  {
    name: "state",
    readCommands: ["list", "save"],
    writeCommands: ["load", "clear"],
    redactionBoundaries: ["snapshot values"],
  },
  {
    name: "controls",
    readCommands: ["list", "get"],
    writeCommands: ["press"],
    redactionBoundaries: ["control labels", "control props"],
  },
  {
    name: "performance",
    readCommands: ["mark.list", "measure.list", "memory.sample"],
    writeCommands: ["mark.add", "measure.start", "measure.stop"],
    redactionBoundaries: ["mark names", "measure names"],
  },
  {
    name: "snapshot",
    readCommands: ["capture", "refs"],
    writeCommands: [],
    redactionBoundaries: ["text content", "accessibility labels", "props"],
  },
  {
    name: "rn",
    readCommands: ["tree", "inspect", "fiber"],
    writeCommands: [],
    redactionBoundaries: ["props", "component names", "text content"],
  },
];

export function bridgeMetadata(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    bridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    developmentOnly: true,
    generatedBy: "expo-ios",
    domains: ["navigation", "network", "storage", "controls", "performance", "snapshot"],
  };
}

export function bridgeDomainsFromCatalog(): BridgeDomainCatalogEntry[] {
  return BRIDGE_DOMAIN_CATALOG.map((domain) => ({
    name: domain.name,
    readCommands: [...domain.readCommands],
    writeCommands: [...domain.writeCommands],
    redactionBoundaries: [...domain.redactionBoundaries],
  }));
}

export function bridgeHealthExpression(): string {
  return `(() => {
    const __EXPO_IOS_BRIDGE_HEALTH__ = true;
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const catalog = ${JSON.stringify(BRIDGE_DOMAIN_CATALOG)};
    const candidateGlobals = [
      globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__,
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__,
      globalThis.__ROZENITE_AGENT_BRIDGE__,
      globalThis.__EXPO_IOS_INSTRUMENTATION__,
    ].filter(Boolean);
    const bridge = candidateGlobals.find((candidate) => candidate && typeof candidate === 'object') || null;
    if (!bridge) {
      return { available: false, code: 'missing-bridge', reason: 'No bridge global is registered.' };
    }
    const metadata = bridge.metadata || bridge.expoIosDevtoolsBridgeMetadata || bridge.bridgeMetadata || {};
    const instrumentationDomains = catalog
      .filter((domain) => bridge[domain.name] && typeof bridge[domain.name] === 'object')
      .map((domain) => ({ name: domain.name }));
    const looksLikeAppInstrumentation = bridge === globalThis.__EXPO_IOS_INSTRUMENTATION__ ||
      Boolean(bridge.app?.ready && instrumentationDomains.length > 0);
    const bridgeVersion = metadata.bridgeVersion || bridge.bridgeVersion || bridge.version ||
      (looksLikeAppInstrumentation ? expectedBridgeVersion : null);
    const registered = bridge.registered === true ||
      bridge.appRegistered === true ||
      bridge.appRegistration?.registered === true ||
      Boolean(bridge.domains || bridge.domainRegistry || bridge.registerDomain) ||
      instrumentationDomains.length > 0;
    if (!registered) {
      return {
        available: false,
        code: 'missing-app-registration',
        reason: 'Bridge global exists but the app did not register domains.',
        registered: false,
        bridgeVersion,
      };
    }
    const runtimeDomains = Array.isArray(bridge.domains)
      ? bridge.domains
      : Array.isArray(metadata.domains)
      ? metadata.domains.map((name) => ({ name }))
      : bridge.domainRegistry && typeof bridge.domainRegistry === 'object'
      ? Object.keys(bridge.domainRegistry).map((name) => ({ name, ...bridge.domainRegistry[name] }))
      : instrumentationDomains.length > 0
      ? instrumentationDomains
      : catalog.map((domain) => ({ name: domain.name }));
    const domains = runtimeDomains.map((domain) => {
      const name = typeof domain === 'string' ? domain : domain.name;
      const base = catalog.find((item) => item.name === name) || { readCommands: [], writeCommands: [], redactionBoundaries: ['domain-defined values'] };
      const runtime = typeof domain === 'object' ? domain : {};
      return {
        name,
        available: runtime.available !== false,
        readCommands: Array.isArray(runtime.readCommands) ? runtime.readCommands : base.readCommands,
        writeCommands: Array.isArray(runtime.writeCommands) ? runtime.writeCommands : base.writeCommands,
        redactionBoundaries: Array.isArray(runtime.redactionBoundaries) ? runtime.redactionBoundaries : base.redactionBoundaries,
      };
    }).filter((domain) => typeof domain.name === 'string' && domain.name.length > 0);
    return {
      available: true,
      registered: true,
      appRegistration: {
        registered: true,
        appId: bridge.appId || bridge.appRegistration?.appId || bridge.app?.appId || null,
        runtimeName: bridge.runtimeName || bridge.appRegistration?.runtimeName || bridge.app?.runtimeName || null,
      },
      bridgeVersion,
      compatibleCliVersion: bridgeVersion === expectedBridgeVersion,
      domains,
    };
  })()`;
}

export function bridgeSource(): string {
  return `// Generated by expo-ios. Import this file only from development-only app code guarded by __DEV__.
export const expoIosDevtoolsBridgeMetadata = ${JSON.stringify(bridgeMetadata(), null, 2)} as const;

export function registerExpoIosDevtoolsBridge() {
  if (typeof __DEV__ !== "undefined" && !__DEV__) return { registered: false, reason: "production-build" };
  const bridge = {
    registered: true,
    metadata: expoIosDevtoolsBridgeMetadata,
    bridgeVersion: expoIosDevtoolsBridgeMetadata.bridgeVersion,
    domains: expoIosDevtoolsBridgeMetadata.domains.map((name) => ({ name })),
  };
  globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ = bridge;
  return { registered: true, metadata: expoIosDevtoolsBridgeMetadata };
}
`;
}
