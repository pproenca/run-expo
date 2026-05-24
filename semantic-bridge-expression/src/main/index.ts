export const EXPO_IOS_BRIDGE_VERSION = "1.0.0";

export interface SemanticBridgeExpressionArgs {
  filters: unknown;
}

export function semanticBridgeExpression({ filters }: SemanticBridgeExpressionArgs): string {
  return `(() => {
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const filters = ${JSON.stringify(filters)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const metadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const bridgeVersion = metadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const semantic = pluginBridge?.snapshot ||
      pluginBridge?.semantics ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? (pluginBridge.domains.snapshot || pluginBridge.domains.semantics) : null) ||
      (pluginBridge?.domainRegistry ? (pluginBridge.domainRegistry.snapshot || pluginBridge.domainRegistry.semantics) : null);
    const callTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const hasSemantic = Boolean(semantic || callTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'snapshot' || domain?.name === 'semantics')));
    if (!hasSemantic) {
      return { available: false, source: 'plugin-bridge-semantic', code: pluginBridge ? 'missing-domain' : 'unavailable-bridge', reason: pluginBridge ? 'Semantic snapshot bridge domain is not registered.' : 'Semantic bridge is not installed.', refs: [] };
    }
    if (bridgeVersion && bridgeVersion !== expectedBridgeVersion) {
      return { available: false, source: 'plugin-bridge-semantic', code: 'version-mismatch', bridgeVersion, expectedBridgeVersion, reason: 'Semantic bridge version is not compatible with this CLI.', refs: [] };
    }
    const captured = semantic && typeof semantic.capture === 'function'
      ? semantic.capture({ filters })
      : semantic?.refs
      ? { refs: semantic.refs }
      : callTool
      ? callTool('snapshot.capture', { filters })
      : { refs: [] };
    return {
      available: true,
      source: 'plugin-bridge-semantic',
      bridgeVersion,
      routeHint: captured?.routeHint || null,
      refs: Array.isArray(captured?.refs) ? captured.refs : Array.isArray(captured) ? captured : [],
      limitations: captured?.limitations || []
    };
  })()`;
}
