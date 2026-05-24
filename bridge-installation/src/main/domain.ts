export const EXPO_IOS_BRIDGE_VERSION = "1.0.0";
export const BRIDGE_SCHEMA_VERSION = 1;

export const BRIDGE_DOMAIN_CATALOG = Object.freeze([
  {
    name: "navigation",
    readCommands: ["state"],
    writeCommands: ["back", "pop-to-root", "tab", "deep-link"],
    redactionBoundaries: ["route params", "query values"]
  },
  {
    name: "network",
    readCommands: ["list", "request", "har.start", "har.stop"],
    writeCommands: ["clear"],
    redactionBoundaries: ["headers.authorization", "headers.cookie", "requestBody", "responseBody"]
  },
  {
    name: "storage",
    readCommands: ["list", "get"],
    writeCommands: ["set", "clear"],
    redactionBoundaries: ["keys", "values", "secure-store values"]
  },
  {
    name: "state",
    readCommands: ["list", "save"],
    writeCommands: ["load", "clear"],
    redactionBoundaries: ["snapshot values"]
  },
  {
    name: "controls",
    readCommands: ["list", "get"],
    writeCommands: ["press"],
    redactionBoundaries: ["control labels", "control props"]
  },
  {
    name: "performance",
    readCommands: ["mark.list", "measure.list", "memory.sample"],
    writeCommands: ["mark.add", "measure.start", "measure.stop"],
    redactionBoundaries: ["mark names", "measure names"]
  },
  {
    name: "snapshot",
    readCommands: ["capture", "refs"],
    writeCommands: [],
    redactionBoundaries: ["text content", "accessibility labels", "props"]
  },
  {
    name: "rn",
    readCommands: ["tree", "inspect", "fiber"],
    writeCommands: [],
    redactionBoundaries: ["props", "component names", "text content"]
  }
]);

export type BridgeDomain = {
  name: string;
  readCommands: string[];
  writeCommands: string[];
  redactionBoundaries: string[];
};

export type NormalizedBridgeDomain = BridgeDomain & {
  available: boolean;
  writable: boolean;
  actionPolicyRequiredForWrites: boolean;
  transport: "hermes-cdp Runtime.evaluate";
  source: "runtime-registration" | "cli-catalog";
};

export function bridgeMetadata() {
  return {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    bridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    developmentOnly: true,
    generatedBy: "expo-ios",
    domains: ["navigation", "network", "storage", "controls", "performance", "snapshot"]
  };
}

export function metadataPath(projectRoot: string): string {
  return `${projectRoot}/.expo-ios/bridge.json`;
}

export function sourcePath(projectRoot: string): string {
  return `${projectRoot}/src/expo-ios-devtools-bridge.ts`;
}

export function uniqueStrings(value: unknown): string[] {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim())));
}
