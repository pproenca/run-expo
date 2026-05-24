import { parseCliArgs } from "../cli-argv-parser/src/main/index.ts";
import { commandArgs } from "../command-arg-projection/src/main/index.ts";
import {
  dispatchCommand,
  exitCodeForError,
  formatCliError,
  toolJson,
  unwrapToolJson,
} from "../command-dispatch-envelope/src/main/index.ts";
import { createCliFacade } from "../cli-facade-entrypoint/src/main/index.ts";
import { cliHelpText } from "../cli-help-surface/src/main/index.ts";
import { createCliRuntime } from "../cli-runtime-composition/src/main/index.ts";
import { createCliExecutable } from "../cli-executable-wrapper/src/main/index.ts";
import { bindHandlers } from "../tool-handler-registry/src/main/index.ts";
import { doctor as legacyDoctor, projectInfo } from "../project-info-doctor/src/main/index.ts";
import { expoRouterSitemap } from "../router-sitemap/src/main/index.ts";
import { listDevices } from "../device-listing/src/main/index.ts";
import { sessionCommand, startRunRecord } from "../session-run-records/src/main/index.ts";
import { targetCommand } from "../target-management/src/main/index.ts";
import { snapshotCommand, refsCommand, getRefCommand } from "../snapshot-evidence/src/main/index.ts";
import { findCommand, waitCommand } from "../ref-actions-wait/src/main/index.ts";
import { batchCommand } from "../batch-orchestration/src/main/index.ts";
import {
  bootSimulator,
  collectAppLogs,
  installApp,
  launchApp,
  reloadApp,
  terminateApp,
  uninstallApp,
} from "../app-lifecycle-actions/src/main/index.ts";
import { openExpoRoute, openUrl } from "../route-url-actions/src/main/index.ts";
import {
  automationGesture,
  automationTap,
  clipboardCommand,
  keyboardCommand,
  refActionCommand,
  setEnvironmentCommand,
} from "../interaction-actions/src/main/index.ts";
import { automationTakeScreenshot } from "../screenshot-capture/src/main/index.ts";
import { captureUxContext } from "../ux-context-capture/src/main/index.ts";
import { annotateScreen } from "../annotate-screen-artifacts/src/main/index.ts";
import { runtimeInspector } from "../runtime-inspector-actions/src/main/index.ts";
import { reviewOverlay } from "../review-overlay-workflow/src/main/index.ts";
import { reviewNextStep } from "../review-next-guidance/src/main/index.ts";
import { annotationServer } from "../annotation-server-http/src/main/index.ts";
import { consoleCommand, devtoolsCommand, errorsCommand } from "../devtools-diagnostics/src/main/index.ts";
import { metroCommand } from "../metro-probes/src/main/index.ts";
import { navigationCommand } from "../navigation-deeplinks/src/main/index.ts";
import { networkCommand } from "../network-evidence/src/main/index.ts";
import { controlsCommand, stateCommand, storageCommand } from "../bridge-domain-actions/src/main/index.ts";
import { bridgeCommand } from "../bridge-command-adapter/src/main/index.ts";
import { accessibilityCommand } from "../accessibility-actions/src/main/index.ts";
import { dialogCommand, sheetCommand } from "../modal-blocker-actions/src/main/index.ts";
import { recordCommand } from "../record-artifacts/src/main/index.ts";
import { diffCommand, reviewCommand } from "../review-evidence-reports/src/main/index.ts";
import { debugInspectCommand, highlightCommand } from "../debug-inspect-highlight/src/main/index.ts";
import { expoCommand } from "../expo-introspection-actions/src/main/index.ts";
import { rnCommand } from "../rn-introspection/src/main/index.ts";
import { perfCommand } from "../perf-evidence/src/main/index.ts";
import { dashboardCommand } from "../dashboard-observability/src/main/index.ts";
import { policyCommand, redactCommand } from "../policy-redaction/src/main/command-boundary.ts";
import {
  installCommand,
  releaseCommand,
  skillsCommand,
  upgradeCommand,
} from "../plugin-self-management/src/main/index.ts";
import { liveBacklogCommand } from "../live-backlog/src/main/index.ts";
import { traceInteraction } from "../interaction-trace-expression/src/main/index.ts";

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
