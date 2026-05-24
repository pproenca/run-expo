export interface DependencyInfo {
  name: string;
  present: boolean;
  declaredVersion: unknown;
  resolvedVersion: string | null;
  unresolved: boolean;
}

export interface CompatibilityRecord {
  state: string;
  expected: string;
  expo?: unknown;
  reactNative?: unknown;
}

export interface UpstreamDependencyRecord {
  id: string;
  ecosystem: string;
  packageName: string;
  integrationPoint: string;
  classification: string;
  usage: string;
  directDependency: boolean;
  declaredVersion: unknown;
  resolvedVersion: unknown;
  status: string;
  compatibility: CompatibilityRecord;
  notes: string[];
}

const EXPO_REACT_NATIVE_COMPATIBILITY = [
  { expoMajor: 54, reactNativeMajorMinor: "0.81" },
  { expoMajor: 53, reactNativeMajorMinor: "0.79" },
  { expoMajor: 52, reactNativeMajorMinor: "0.76" },
  { expoMajor: 51, reactNativeMajorMinor: "0.74" },
  { expoMajor: 50, reactNativeMajorMinor: "0.73" },
];

export function dependencyInfo(allDeps: Record<string, unknown>, name: string): DependencyInfo {
  const declaredVersion = allDeps[name] ?? null;
  return {
    name,
    present: typeof declaredVersion === "string" && declaredVersion.length > 0,
    declaredVersion,
    resolvedVersion: parseVersionLike(declaredVersion),
    unresolved: typeof declaredVersion === "string" && /^(catalog|workspace|file|link|portal):/.test(declaredVersion),
  };
}

export function dependencyStatus(info: DependencyInfo): string {
  if (!info.present) return "missing";
  if (info.unresolved) return "declared-unresolved";
  return "present";
}

export function parseVersionLike(version: unknown): string | null {
  if (typeof version !== "string") return null;
  const match = version.match(/\d+\.\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

export function majorFromVersion(version: unknown): number | null {
  const parsed = parseVersionLike(version);
  if (!parsed) return null;
  return Number(parsed.split(".")[0]);
}

export function majorMinorFromVersion(version: unknown): string | null {
  const parsed = parseVersionLike(version);
  if (!parsed) return null;
  const [major, minor] = parsed.split(".");
  return `${major}.${minor ?? "0"}`;
}

export function classifyExpoReactNativeCompatibility(
  expoVersion: DependencyInfo,
  reactNativeVersion: DependencyInfo,
): { forExpo: CompatibilityRecord; forReactNative: CompatibilityRecord } {
  const missing = {
    state: "missing",
    expected: "Declare both expo and react-native to classify SDK compatibility.",
  };
  if (!expoVersion.present || !reactNativeVersion.present) {
    return { forExpo: missing, forReactNative: missing };
  }
  if (expoVersion.unresolved || reactNativeVersion.unresolved) {
    const unresolved = {
      state: "declared-unresolved",
      expected: "Resolve catalog/workspace dependency versions before treating compatibility as proven.",
      expo: expoVersion.declaredVersion,
      reactNative: reactNativeVersion.declaredVersion,
    };
    return { forExpo: unresolved, forReactNative: unresolved };
  }
  const expoMajor = majorFromVersion(expoVersion.declaredVersion);
  const reactNativeMajorMinor = majorMinorFromVersion(reactNativeVersion.declaredVersion);
  const expected = EXPO_REACT_NATIVE_COMPATIBILITY.find((entry) => entry.expoMajor === expoMajor);
  if (!expected) {
    const unknown = {
      state: "unknown",
      expected: "This Expo SDK is not in expo-ios' compatibility table; verify with the project dependency source.",
      expo: expoVersion.declaredVersion,
      reactNative: reactNativeVersion.declaredVersion,
    };
    return { forExpo: unknown, forReactNative: unknown };
  }
  const result = {
    state: reactNativeMajorMinor === expected.reactNativeMajorMinor ? "compatible" : "mismatched",
    expected: `Expo SDK ${expected.expoMajor} expects React Native ${expected.reactNativeMajorMinor}.x.`,
    expo: expoVersion.declaredVersion,
    reactNative: reactNativeVersion.declaredVersion,
  };
  return { forExpo: result, forReactNative: result };
}

export function buildUpstreamDependencyReport(
  projectRoot: string,
  allDeps: Record<string, unknown> = {},
): Record<string, unknown> {
  const expoVersion = dependencyInfo(allDeps, "expo");
  const reactNativeVersion = dependencyInfo(allDeps, "react-native");
  const metroVersion = dependencyInfo(allDeps, "metro");
  const expoCliVersion = dependencyInfo(allDeps, "@expo/cli");
  const devMiddlewareVersion = dependencyInfo(allDeps, "@react-native/dev-middleware");
  const rozenitePackages = Object.keys(allDeps)
    .filter((name) => name === "rozenite" || name.startsWith("@rozenite/"))
    .sort()
    .map((name) => dependencyInfo(allDeps, name));
  const expoRnCompatibility = classifyExpoReactNativeCompatibility(expoVersion, reactNativeVersion);

  const dependencies: UpstreamDependencyRecord[] = [
    {
      id: "expo-public-api",
      ecosystem: "expo",
      packageName: "expo",
      integrationPoint: "Expo config, dev-client, expo/devtools plugin APIs, and public package exports.",
      classification: "public-api",
      usage: "direct-dependency",
      directDependency: expoVersion.present,
      declaredVersion: expoVersion.declaredVersion,
      resolvedVersion: expoVersion.resolvedVersion,
      status: dependencyStatus(expoVersion),
      compatibility: expoRnCompatibility.forExpo,
      notes: expoVersion.present
        ? ["Expo is declared by the project and can be used for public API compatibility checks."]
        : ["Expo is not declared; Expo-specific upstream clients remain unavailable."],
    },
    {
      id: "metro-inspector-http",
      ecosystem: "metro",
      packageName: "metro",
      integrationPoint: "Metro /status, /json/list, /json/version, /symbolicate, and /message HTTP/WebSocket surfaces.",
      classification: "documented-unstable-api",
      usage: "optional-compatibility-shim",
      directDependency: metroVersion.present,
      declaredVersion: metroVersion.declaredVersion,
      resolvedVersion: metroVersion.resolvedVersion,
      status: metroVersion.present ? dependencyStatus(metroVersion) : expoVersion.present ? "inferred-transitive" : "missing",
      compatibility: {
        state: metroVersion.present || expoVersion.present ? "discoverable-at-runtime" : "missing",
        expected: "Metro inspector endpoints are discovered over local HTTP at runtime; direct internal imports are not required.",
      },
      notes: ["The CLI may probe Metro's local HTTP endpoints, but Metro server internals are reference-only unless isolated by a shim."],
    },
    {
      id: "hermes-react-native-cdp",
      ecosystem: "hermes-react-native",
      packageName: "react-native",
      integrationPoint: "Hermes inspector Chrome DevTools Protocol websocket exposed by React Native/Metro.",
      classification: "optional-compatibility-shim",
      usage: "optional-compatibility-shim",
      directDependency: reactNativeVersion.present,
      declaredVersion: reactNativeVersion.declaredVersion,
      resolvedVersion: reactNativeVersion.resolvedVersion,
      status: dependencyStatus(reactNativeVersion),
      compatibility: expoRnCompatibility.forReactNative,
      notes: ["CDP method calls must stay behind the expo-ios CDP client because Hermes/RN can expose implementation-specific methods."],
    },
    {
      id: "react-native-devtools",
      ecosystem: "react-native-devtools",
      packageName: "@react-native/dev-middleware",
      integrationPoint: "React Native DevTools launch metadata, panel discovery, and machine-readable domains where available.",
      classification: "documented-unstable-api",
      usage: "internal-reference-only",
      directDependency: devMiddlewareVersion.present,
      declaredVersion: devMiddlewareVersion.declaredVersion,
      resolvedVersion: devMiddlewareVersion.resolvedVersion,
      status: devMiddlewareVersion.present ? dependencyStatus(devMiddlewareVersion) : reactNativeVersion.present ? "reference-only" : "missing",
      compatibility: {
        state: reactNativeVersion.present ? "runtime-target-required" : "missing",
        expected: "React Native DevTools capabilities are confirmed from Metro target metadata before use.",
      },
      notes: ["React Native DevTools internals can inform local wrappers, but command code must not depend on private build paths."],
    },
    {
      id: "expo-devtools-plugin",
      ecosystem: "expo-devtools-plugin",
      packageName: "expo",
      integrationPoint: "expo/devtools and useDevToolsPluginClient two-way development plugin APIs.",
      classification: "public-api",
      usage: "direct-dependency",
      directDependency: expoVersion.present,
      declaredVersion: expoVersion.declaredVersion,
      resolvedVersion: expoVersion.resolvedVersion,
      status: dependencyStatus(expoVersion),
      compatibility: {
        state: expoVersion.present ? "available-when-app-registers" : "missing",
        expected: "Plugin domains still require a live development build to register the app-side bridge.",
      },
      notes: ["Plugin bridge installation and mutation remain explicit-user-permission operations."],
    },
    {
      id: "rozenite-devtools-bridge",
      ecosystem: "rozenite",
      packageName: rozenitePackages.length > 0 ? rozenitePackages.map((item) => item.name).join(", ") : "rozenite/@rozenite/*",
      integrationPoint: "Rozenite bridge, agent, React Navigation, network, storage, controls, and performance integrations.",
      classification: "optional-compatibility-shim",
      usage: "optional-compatibility-shim",
      directDependency: rozenitePackages.length > 0,
      declaredVersion: rozenitePackages.length > 0 ? rozenitePackages.map((item) => `${item.name}@${item.declaredVersion}`).join(", ") : null,
      resolvedVersion: rozenitePackages.length > 0 ? rozenitePackages.map((item) => `${item.name}@${item.resolvedVersion ?? item.declaredVersion}`).join(", ") : null,
      status: rozenitePackages.length > 0 ? (rozenitePackages.some((item) => item.unresolved) ? "declared-unresolved" : "present") : "missing",
      compatibility: {
        state: rozenitePackages.length > 0 ? "optional-present" : "optional-missing",
        expected: "Rozenite-backed domains are preferred only when installed and registered by the app.",
      },
      notes: ["Rozenite is optional; absence must produce structured unavailable data, not a CLI failure."],
    },
    {
      id: "expo-cli-internals",
      ecosystem: "expo",
      packageName: "@expo/cli",
      integrationPoint: "Expo CLI private implementation details used only as reference material.",
      classification: "internal-reference-only",
      usage: "internal-reference-only",
      directDependency: expoCliVersion.present,
      declaredVersion: expoCliVersion.declaredVersion,
      resolvedVersion: expoCliVersion.resolvedVersion,
      status: expoCliVersion.present ? dependencyStatus(expoCliVersion) : "not-depended-on",
      compatibility: {
        state: "reference-only",
        expected: "Private Expo CLI build paths must not be imported by command handlers.",
      },
      notes: ["If an internal path is ever needed, it must be wrapped by an optional compatibility shim with fallback behavior."],
    },
  ];

  return {
    schemaVersion: 1,
    projectRoot,
    policy: {
      categories: [
        { id: "public-api", mayImportDirectly: true, requiresShim: false },
        { id: "documented-unstable-api", mayImportDirectly: false, requiresShim: true },
        { id: "internal-reference-only", mayImportDirectly: false, requiresShim: true },
        { id: "optional-compatibility-shim", mayImportDirectly: false, requiresShim: true },
      ],
      rules: [
        "Command handlers depend on expo-ios adapters, not raw upstream package objects.",
        "Metro and Hermes runtime availability is confirmed at runtime before a command reports live evidence.",
        "Internal Expo, Metro, React Native, or DevTools source paths are reference material unless isolated behind optional shims.",
        "Missing optional upstream packages produce structured unavailable reports instead of thrown errors.",
      ],
    },
    summary: summarizeUpstreamDependencies(dependencies),
    dependencies,
  };
}

export function summarizeUpstreamDependencies(dependencies: UpstreamDependencyRecord[]): Record<string, unknown> {
  const statuses: Record<string, number> = {};
  for (const dependency of dependencies) {
    statuses[dependency.status] = (statuses[dependency.status] ?? 0) + 1;
  }
  return {
    total: dependencies.length,
    directDependencies: dependencies.filter((dependency) => dependency.usage === "direct-dependency").length,
    internalReferenceOnly: dependencies.filter((dependency) => dependency.classification === "internal-reference-only").length,
    optionalCompatibilityShims: dependencies.filter((dependency) => dependency.classification === "optional-compatibility-shim").length,
    statuses,
    mismatched: dependencies.filter((dependency) => dependency.compatibility?.state === "mismatched").map((dependency) => dependency.id),
    missing: dependencies.filter((dependency) => dependency.status === "missing").map((dependency) => dependency.id),
  };
}
