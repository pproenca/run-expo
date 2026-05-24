import {
  EXPO_IOS_BRIDGE_VERSION,
  bridgeMetadata,
  metadataPath,
  sourcePath
} from "./domain.js";

export type PackageJsonLike = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type BridgeMetadataLike = {
  schemaVersion?: number;
  bridgeVersion?: string;
  developmentOnly?: boolean;
};

export type BridgeIssue = {
  code: string;
  message: string;
};

export type BridgeInstallStatus = {
  projectRoot: string;
  state: "absent" | "present" | "stale" | "incompatible";
  bridgeVersion: string | null;
  expectedBridgeVersion: string;
  developmentOnly: boolean;
  metadataPath: string;
  sourcePath: string;
  files: { metadata: boolean; source: boolean };
  dependencies: { expo: string | null; rozenite: Array<{ name: string; version: string }> };
  issues: BridgeIssue[];
};

/**
 * RULE-016 and RULE-006: classifies bridge files without performing IO.
 */
export function computeBridgeInstallStatus({
  projectRoot,
  packageJson = null,
  metadata = null,
  sourceExists = false
}: {
  projectRoot: string;
  packageJson?: PackageJsonLike | null;
  metadata?: BridgeMetadataLike | null;
  sourceExists?: boolean;
}): BridgeInstallStatus {
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  };
  const hasExpo = typeof dependencies.expo === "string";
  const metadataExists = Boolean(metadata);
  const files = { metadata: metadataExists, source: Boolean(sourceExists) };
  let state: BridgeInstallStatus["state"] = "absent";
  const issues = [];

  if (!hasExpo) {
    state = "incompatible";
    issues.push({
      code: "missing-expo",
      message: "The project does not declare expo, so an Expo DevTools bridge cannot be installed safely."
    });
  } else if (metadataExists || sourceExists) {
    if (!metadataExists || !sourceExists) {
      state = "stale";
      issues.push({
        code: "partial-install",
        message: "Bridge metadata and source file are not both present."
      });
    } else {
      const presentMetadata = metadata as BridgeMetadataLike;
      if (presentMetadata.bridgeVersion !== EXPO_IOS_BRIDGE_VERSION || presentMetadata.schemaVersion !== 1) {
        state = "stale";
        issues.push({
          code: "version-mismatch",
          message: `Bridge version ${presentMetadata.bridgeVersion ?? "unknown"} does not match ${EXPO_IOS_BRIDGE_VERSION}.`
        });
      } else if (presentMetadata.developmentOnly !== true) {
        state = "incompatible";
        issues.push({
          code: "not-development-only",
          message: "Bridge metadata must declare developmentOnly: true."
        });
      } else {
        state = "present";
      }
    }
  }

  return {
    projectRoot,
    state,
    bridgeVersion: metadata?.bridgeVersion ?? null,
    expectedBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    developmentOnly: metadata?.developmentOnly === true,
    metadataPath: metadataPath(projectRoot),
    sourcePath: sourcePath(projectRoot),
    files,
    dependencies: {
      expo: dependencies.expo ?? null,
      rozenite: Object.keys(dependencies)
        .filter((name) => name === "rozenite" || name.startsWith("@rozenite/"))
        .sort()
        .flatMap((name) => {
          const version = dependencies[name];
          return version === undefined ? [] : [{ name, version }];
        })
    },
    issues
  };
}

export function bridgeInstallPlan(projectRoot: string, status: BridgeInstallStatus) {
  return {
    permissionRequired: true,
    requiredConfirmations: ["bridge-install", "bridge-remove"],
    developmentOnly: true,
    productionExclusion: [
      "Bridge code must be imported only from development-only app entrypoints or guarded by __DEV__.",
      "Production/release builds must not import src/expo-ios-devtools-bridge.ts."
    ],
    filesToAddOrChange: [
      {
        path: status.metadataPath,
        action: status.files.metadata ? "update" : "add",
        purpose: "Versioned bridge metadata for stale/incompatible detection and removal."
      },
      {
        path: status.sourcePath,
        action: status.files.source ? "update" : "add",
        purpose: "Development-only Expo/Rozenite bridge registration shim."
      }
    ],
    removalPlan: [
      { path: status.metadataPath, action: "delete" },
      { path: status.sourcePath, action: "delete" }
    ],
    runtimeHealthCheckExpectations: [
      "Metro target is available.",
      "Hermes inspector is available.",
      "Bridge metadata version matches CLI expected version.",
      "App registers readable and writable domains separately.",
      "Mutation domains remain action-policy gated."
    ],
    status: status.state,
    issues: status.issues
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

export function hasExplicitConfirmation(value: string | null | undefined, required: string): boolean {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .includes(required);
}

export function bridgeMutationRefusal({
  action,
  confirmActions,
  status,
  plan
}: {
  action: "install" | "remove";
  confirmActions?: string | null;
  status: BridgeInstallStatus;
  plan: unknown;
}) {
  const requiredConfirmation = action === "install" ? "bridge-install" : "bridge-remove";
  if (hasExplicitConfirmation(confirmActions, requiredConfirmation)) {
    return null;
  }
  return {
    available: false,
    action,
    status: status.state,
    projectRoot: status.projectRoot,
    reason: `Refusing to mutate app files without explicit --confirm-actions ${requiredConfirmation}.`,
    requiredConfirmation,
    plan
  };
}

export function defaultBridgeMetadata() {
  return bridgeMetadata();
}
