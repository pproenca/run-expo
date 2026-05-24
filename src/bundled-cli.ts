import { parseCliArgs } from "./modules/cli-argv-parser/src/main/index.ts";
import { commandArgs } from "./modules/command-arg-projection/src/main/index.ts";
import {
  dispatchCommand,
  exitCodeForError,
  formatCliError,
  toolJson,
  unwrapToolJson,
} from "./modules/command-dispatch-envelope/src/main/index.ts";
import { createCliFacade } from "./modules/cli-facade-entrypoint/src/main/index.ts";
import { cliHelpText } from "./modules/cli-help-surface/src/main/index.ts";
import { createCliRuntime } from "./modules/cli-runtime-composition/src/main/index.ts";
import { createCliExecutable } from "./modules/cli-executable-wrapper/src/main/index.ts";
import { bindHandlers } from "./modules/tool-handler-registry/src/main/index.ts";
import { doctor as legacyDoctor, projectInfo } from "./modules/project-info-doctor/src/main/index.ts";
import { expoRouterSitemap } from "./modules/router-sitemap/src/main/index.ts";
import { listDevices } from "./modules/device-listing/src/main/index.ts";
import { sessionCommand, startRunRecord } from "./modules/session-run-records/src/main/index.ts";
import { targetCommand } from "./modules/target-management/src/main/index.ts";
import { snapshotCommand, refsCommand, getRefCommand } from "./modules/snapshot-evidence/src/main/index.ts";
import { findCommand, waitCommand } from "./modules/ref-actions-wait/src/main/index.ts";
import { batchCommand } from "./modules/batch-orchestration/src/main/index.ts";
import {
  bootSimulator,
  collectAppLogs,
  installApp,
  launchApp,
  reloadApp,
  terminateApp,
  uninstallApp,
} from "./modules/app-lifecycle-actions/src/main/index.ts";
import { openExpoRoute, openUrl } from "./modules/route-url-actions/src/main/index.ts";
import {
  automationGesture,
  automationTap,
  clipboardCommand,
  keyboardCommand,
  refActionCommand,
  setEnvironmentCommand,
} from "./modules/interaction-actions/src/main/index.ts";
import { automationTakeScreenshot } from "./modules/screenshot-capture/src/main/index.ts";
import { captureUxContext } from "./modules/ux-context-capture/src/main/index.ts";
import { annotateScreen } from "./modules/annotate-screen-artifacts/src/main/index.ts";
import { runtimeInspector } from "./modules/runtime-inspector-actions/src/main/index.ts";
import { reviewOverlay } from "./modules/review-overlay-workflow/src/main/index.ts";
import { reviewNextStep } from "./modules/review-next-guidance/src/main/index.ts";
import { annotationServer } from "./modules/annotation-server-http/src/main/index.ts";
import { consoleCommand, devtoolsCommand, errorsCommand } from "./modules/devtools-diagnostics/src/main/index.ts";
import { metroCommand } from "./modules/metro-probes/src/main/index.ts";
import { navigationCommand } from "./modules/navigation-deeplinks/src/main/index.ts";
import { networkCommand } from "./modules/network-evidence/src/main/index.ts";
import { controlsCommand, stateCommand, storageCommand } from "./modules/bridge-domain-actions/src/main/index.ts";
import { bridgeCommand } from "./modules/bridge-command-adapter/src/main/index.ts";
import { accessibilityCommand } from "./modules/accessibility-actions/src/main/index.ts";
import { dialogCommand, sheetCommand } from "./modules/modal-blocker-actions/src/main/index.ts";
import { recordCommand } from "./modules/record-artifacts/src/main/index.ts";
import { diffCommand, reviewCommand } from "./modules/review-evidence-reports/src/main/index.ts";
import { debugInspectCommand, highlightCommand } from "./modules/debug-inspect-highlight/src/main/index.ts";
import { expoCommand } from "./modules/expo-introspection-actions/src/main/index.ts";
import { rnCommand } from "./modules/rn-introspection/src/main/index.ts";
import { perfCommand } from "./modules/perf-evidence/src/main/index.ts";
import { dashboardCommand } from "./modules/dashboard-observability/src/main/index.ts";
import { policyCommand, redactCommand } from "./modules/policy-redaction/src/main/command-boundary.ts";
import {
  installCommand,
  releaseCommand,
  skillsCommand,
  upgradeCommand,
} from "./modules/plugin-self-management/src/main/index.ts";
import { liveBacklogCommand } from "./modules/live-backlog/src/main/index.ts";
import { traceInteraction } from "./modules/interaction-trace-expression/src/main/index.ts";

const CLI_VERSION = "0.1.0";

const handlerImplementations = {
  doctor: expo98Doctor,
  projectInfo,
  expoRouterSitemap,
  listDevices,
  sessionCommand,
  targetCommand,
  snapshotCommand,
  refsCommand,
  getRefCommand,
  findCommand,
  waitCommand,
  batchCommand,
  bootSimulator,
  openUrl,
  launchApp,
  terminateApp,
  reloadApp,
  installApp,
  uninstallApp,
  refActionCommand,
  clipboardCommand,
  keyboardCommand,
  setEnvironmentCommand,
  collectAppLogs,
  automationTakeScreenshot,
  automationTap,
  automationGesture,
  openExpoRoute,
  captureUxContext,
  annotateScreen,
  runtimeInspector,
  reviewOverlay,
  reviewNextStep,
  annotationServer,
  devtoolsCommand,
  consoleCommand,
  errorsCommand,
  metroCommand,
  navigationCommand,
  networkCommand,
  storageCommand,
  stateCommand,
  controlsCommand,
  bridgeCommand,
  accessibilityCommand,
  dialogCommand,
  sheetCommand,
  recordCommand,
  diffCommand,
  debugInspectCommand,
  highlightCommand,
  expoCommand,
  rnCommand,
  perfCommand,
  dashboardCommand,
  reviewCommand,
  policyCommand,
  redactCommand,
  skillsCommand,
  installCommand,
  upgradeCommand,
  releaseCommand,
  liveBacklogCommand,
  traceInteraction,
};

const runtime = createCliRuntime({
  parseCliArgs,
  commandArgs,
  dispatchCommand,
  bindHandlers,
  createCliFacade,
  writeCliError: (error, options) => {
    const text = formatCliError(error, options);
    if (text !== null) {
      process.stderr.write(text);
    }
  },
  exitCodeForError,
  handlerImplementations,
  startRunRecord,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  printHelp: () => cliHelpText(CLI_VERSION).replaceAll("expo-ios", "expo98"),
  cliVersion: CLI_VERSION,
});

const executable = createCliExecutable({
  argv: () => process.argv,
  main: (argv) => runtime.run(argv),
  setExitCode: (exitCode) => {
    process.exitCode = exitCode;
  },
  writeCliError: (error) => {
    process.stderr.write(formatCliError(error, runtime.getLastCliOptions()) ?? "");
  },
  exitCodeForError,
});

void executable.run();

async function expo98Doctor(args: Record<string, unknown> = {}) {
  const result = await legacyDoctor(args);
  const payload = unwrapToolJson(result) as Record<string, unknown>;
  const cli = typeof payload.cli === "object" && payload.cli !== null
    ? { ...(payload.cli as Record<string, unknown>), name: "expo98", bin: "expo98" }
    : { name: "expo98", version: CLI_VERSION, bin: "expo98" };
  return toolJson({
    ...payload,
    cli,
    runtime: {
      node: process.version,
      supported: Number(process.versions.node.split(".")[0] ?? 0) >= 20,
      required: ">=20",
    },
    package: {
      name: "expo98",
      entrypoint: "cli/expo98.mjs",
      bundledExecutable: true,
      compatibilityBin: "expo-ios",
    },
  });
}
