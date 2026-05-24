import { pickDefined } from "./cli.js";

const ALIASES: Record<string, string> = {
  "session": "session",
  "target": "target",
  "snapshot": "snapshot",
  "refs": "refs",
  "get": "get_ref",
  "find": "find",
  "wait": "wait",
  "batch": "batch",
  "tap": "automation_tap",
  "fill": "ref_action",
  "scroll-into-view": "ref_action",
};

export function commandAliases(): Record<string, string> {
  return { ...ALIASES };
}

export function commandArgs(
  command: string,
  args: Record<string, unknown> & { _: unknown[] },
  globals: Record<string, unknown> = {},
): Record<string, unknown> {
  const cwd = args.cwd ?? globals.root;
  switch (command) {
    case "session":
      return pickDefined({
        action: args.action ?? args._[0],
        name: args.name ?? args._[1],
        olderThan: args.olderThan,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "target":
      return pickDefined({
        action: args.action ?? args._[0],
        targetId: args.targetId ?? args._[1],
        platform: args.platform,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "snapshot":
      return pickDefined({
        interactive: args.interactive,
        compact: args.compact,
        depth: args.depth,
        source: args.source,
        bounds: args.bounds,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "refs":
      return pickDefined({ cwd, root: globals.root, stateDir: globals.stateDir });
    case "get":
      return pickDefined({
        field: args.field ?? args._[0],
        ref: args.ref ?? args._[1],
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "find":
      return pickDefined({
        kind: args.kind ?? args._[0],
        value: args.value ?? args._[1],
        action: args.action ?? args._[2],
        name: args.name ?? (args._[0] === "nth" ? args._[2] : undefined),
        text: args.text ?? args._[3],
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "wait": {
      const first = args._[0];
      return pickDefined({
        ref: args.ref ?? (/^@e\d+$/.test(String(first ?? "")) ? first : undefined),
        ms: args.ms ?? (/^\d+$/.test(String(first ?? "")) ? Number(first) : undefined),
        state: args.state,
        text: args.text,
        route: args.route,
        metroReady: args.metroReady,
        appReady: args.appReady,
        noSpinner: args.noSpinner,
        fn: args.fn,
        allowRuntimeEval: globals.allowRuntimeEval,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        metroPort: args.metroPort,
        timeoutMs: args.timeoutMs,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    }
    case "batch":
      return pickDefined({
        steps: args.steps ?? args._,
        bail: args.bail,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "tap":
      return pickDefined({
        platform: args.platform,
        device: args.device,
        x: args.x,
        y: args.y,
        ref: args.ref ?? args._[0],
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "fill":
    case "scroll-into-view": {
      const first = args._[0];
      return pickDefined({
        command,
        ref: args.ref ?? first,
        text: args.text ?? (command === "fill" ? args._[1] : undefined),
        durationMs: args.durationMs,
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    }
    default:
      return {};
  }
}
