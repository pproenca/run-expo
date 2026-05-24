export const LEGACY_PACKAGE_FILES = [
  "cli/",
  "dist/",
  "skills/",
  "src/",
  "SPEC.md",
  "README.md",
  "LICENSE",
] as const;

export const MODERN_PACKAGE_FILES = [
  "cli/",
  "README.md",
] as const;

export const LEGACY_PACKAGE_MANIFEST = {
  name: "expo98",
  version: "0.1.0",
  private: true,
  description: "Standalone expo-ios local evidence CLI for Expo React Native iOS work.",
  type: "module",
  bin: {
    "expo-ios": "./cli/expo-ios.mjs",
  },
  scripts: {
    doctor: "node cli/expo-ios.mjs --json doctor",
    test: "node --test tests/*.mjs",
  },
  engines: {
    node: ">=20",
  },
  files: LEGACY_PACKAGE_FILES,
} as const;

export const MODERN_PACKAGE_MANIFEST = {
  name: "expo98",
  version: "0.1.0",
  description: "Modernized expo98 local evidence CLI for Expo React Native work.",
  type: "module",
  bin: {
    "expo98": "./cli/expo98.mjs",
    "expo-ios": "./cli/expo-ios.mjs",
  },
  scripts: {
    build: "node scripts/build-bundled-cli.mjs",
    doctor: "node cli/expo98.mjs --json doctor",
    prepack: "npm run build",
    test: "node --test tests/*.mjs",
  },
  engines: {
    node: ">=20",
  },
  files: MODERN_PACKAGE_FILES,
  dependencies: {
    esbuild: "^0.25.12",
  },
} as const;

export const MAKEFILE_TARGETS = ["install-local", "test", "doctor"] as const;

export const CLI_WRAPPER_CONTRACT = {
  shebang: "#!/usr/bin/env node",
  importPath: "../dist/expo-ios.mjs",
} as const;

export const MODERN_CLI_WRAPPER_CONTRACT = {
  shebang: "#!/usr/bin/env node",
  importPath: "./expo98.mjs",
} as const;

export type PackageScriptName = keyof typeof LEGACY_PACKAGE_MANIFEST.scripts;
export type ModernPackageScriptName = keyof typeof MODERN_PACKAGE_MANIFEST.scripts;

export type LocalInstallPlanInput = {
  makefileDir: string;
  prefix?: string;
};

export type LocalInstallPlan = {
  binDir: string;
  cliPath: string;
  linkPath: string;
  commands: string[][];
  message: string;
};

export function packageScriptCommand(name: string): string | null {
  return Object.hasOwn(LEGACY_PACKAGE_MANIFEST.scripts, name)
    ? LEGACY_PACKAGE_MANIFEST.scripts[name as PackageScriptName]
    : null;
}

export function modernPackageScriptCommand(name: string): string | null {
  return Object.hasOwn(MODERN_PACKAGE_MANIFEST.scripts, name)
    ? MODERN_PACKAGE_MANIFEST.scripts[name as ModernPackageScriptName]
    : null;
}

export function createLocalInstallPlan(input: LocalInstallPlanInput): LocalInstallPlan {
  const makefileDir = withTrailingSlash(input.makefileDir);
  const prefix = input.prefix ?? "~/.local";
  const binDir = `${trimTrailingSlash(prefix)}/bin`;
  const cliPath = `${makefileDir}cli/expo-ios.mjs`;
  const linkPath = `${binDir}/expo-ios`;

  return {
    binDir,
    cliPath,
    linkPath,
    commands: [
      ["mkdir", "-p", binDir],
      ["ln", "-sf", cliPath, linkPath],
      ["chmod", "+x", cliPath],
    ],
    message: `Installed expo-ios to ${linkPath}`,
  };
}

export function buildCliWrapperSource(): string {
  return `${CLI_WRAPPER_CONTRACT.shebang}\n\nimport ${JSON.stringify(CLI_WRAPPER_CONTRACT.importPath)};\n`;
}

export function buildModernCompatibilityWrapperSource(): string {
  return `${MODERN_CLI_WRAPPER_CONTRACT.shebang}\n\nimport ${JSON.stringify(MODERN_CLI_WRAPPER_CONTRACT.importPath)};\n`;
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
