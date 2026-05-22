---
title: Expo iOS CLI Specification
description: "Product goals, command contract, state records, and architecture for the expo-ios local development CLI"
---

# expo-ios spec

`expo-ios` is a local evidence CLI for Expo React Native iOS work. It helps
agents and humans inspect an Expo app, drive a simulator, capture runtime
context, collect review evidence, and verify native-feeling UI changes without
depending on MCP servers or Rozenite.

The CLI is distributed from the standalone `expo98` project and is intended to
be useful from any Expo React Native repository.

## Goals

- Provide a stable, composable command surface for Expo/iOS local development.
- Gather concrete evidence before UI, runtime, or performance claims.
- Keep machine output strict and predictable under `--json`.
- Keep human output terse and stable under `--plain`.
- Work from any current directory through explicit `--root` or `--cwd`.
- Prefer read-only discovery commands and dry-run planning where possible.
- Persist redacted run records for resumable review sessions.
- Separate simulator control, Expo project discovery, runtime probing, review
  workflow guidance, and reportable artifacts.
- Fail gracefully when optional local tools are missing.
- Never require auth, network services, or hosted infrastructure for core
  local evidence collection.

## Non-goals for v0

- No Rozenite dependency.
- No MCP-first or hidden tool-server adapter.
- No general-purpose agent shell.
- No autonomous app rewrite command.
- No implicit git branch, commit, push, or PR behavior.
- No destructive simulator or filesystem cleanup without explicit command
  intent.
- No custom database. Use project-local JSON files and artifacts.
- No broad provider/model integration inside the CLI.
- No claim that visual quality is fixed without visual evidence.

## Package

- Repo path: `expo98`
- CLI bin: `expo-ios`
- Install target: `~/.local/bin/expo-ios` via `make install-local`
- Runtime: Node.js
- Module system: ESM
- Source entrypoint: `cli/expo-ios.mjs`
- Built implementation: `dist/expo-ios.mjs`
- Test runner: Node's built-in test runner

## Implementation Requirements

- Keep the CLI installable as a normal executable, not only through a package
  manager wrapper.
- Keep command handlers deterministic where the environment is deterministic.
- Validate all external JSON and runtime probe data before using it.
- Treat data from Metro, Hermes inspector, `xcrun`, `idb`, `adb`, `axe`, app
  config files, and local HTTP servers as untrusted input.
- Return structured unavailable states for optional capabilities instead of
  throwing when absence is expected.
- Use `unknown`-style parsing boundaries in TypeScript or equivalent explicit
  parsing in JavaScript.
- Keep injected runtime code small, named, versioned, and isolated. Durable
  runtime features should move toward dev-only app modules or generated
  components instead of ever-growing `Runtime.evaluate` strings.
- Do not print cookies, tokens, auth query parameters, or app secrets.
- CI must run CLI unit tests, session-contract tests, and basic help/doctor
  smoke checks.

Project scripts:

```json
{
  "scripts": {
    "test": "node --test tests/*.mjs",
    "doctor": "node cli/expo-ios.mjs --json doctor"
  }
}
```

## CLI Contract

Global usage:

```bash
expo-ios [global flags] <command> [command flags]
```

Global flags:

- `-h, --help`: show usage.
- `--version`: print CLI version to stdout.
- `--root <dir>`: default Expo project root for commands that accept `--cwd`.
- `--state-dir <dir>`: directory for persisted run records.
- `--record`: write a run record below `<root>/.scratch/expo-ios/runs`.
- `--json`: write `{ "ok": true, "data": ... }` on success.
- `--plain`: write stable line-oriented output.
- `--quiet`: suppress non-essential non-JSON output.
- `--debug`: include diagnostic fields and record path hints.
- `--no-color`: disable color output.
- `--no-input`: reserve noninteractive behavior; the CLI must not prompt.

Stdout:

- Primary command result only.
- JSON envelope when `--json` is set.
- Stable line output when `--plain` is set.
- No progress spinners.

Stderr:

- Diagnostics, warnings, runtime errors, and machine-readable error envelopes.
- No secrets.
- Debug paths only when `--debug` is set.

Exit codes:

- `0`: command completed.
- `1`: runtime/tool/environment failure.
- `2`: invalid command usage, invalid config, or malformed flags.

Future exit codes may be reserved for validation failure, stale lock conflict,
or simulator unavailability, but v0 must preserve the current `0/1/2` contract.

Interactivity:

- The CLI never prompts.
- Commands that need a running simulator, Metro target, or optional tool return
  an unavailable result or runtime failure with a concrete setup hint.

Error JSON under `--json`:

```json
{
  "ok": false,
  "error": {
    "type": "runtime-failure",
    "message": "idb is not installed",
    "command": "gesture",
    "hint": "Install idb or rerun with --dry-run true"
  }
}
```

## Command Families

The CLI should expose named evidence primitives. Avoid catch-all commands that
hide multiple phases behind `fix`, `debug`, or `auto`.

## Full Coverage Target

The long-term coverage model should mirror a browser automation CLI, but mapped
to Expo React Native realities: simulator/device state, app lifecycle, native
navigation, React Native semantic nodes, gestures, screenshots, logs, Metro,
Hermes, storage, network, performance, and review artifacts.

This section is the coverage checklist for future commands. Commands marked
`current` exist today. Commands marked `target` are desired v1/v2 surface area.

### Research Goal

Define `expo-ios` as the Expo React Native equivalent of an agent browser: a
local, CLI-first DevTools and automation layer that lets an agent launch,
navigate, inspect, act on, measure, and verify a running Expo app with stable
JSON contracts and reproducible evidence.

The final `SPEC.md` is done only when it answers five questions:

1. What can the agent see?
2. What can the agent do?
3. What can the agent wait for?
4. What can the agent measure?
5. What evidence proves a claim or regression?

Research must compare four sources of truth:

- browser-agent coverage: actions, refs, snapshots, waits, sessions, network,
  storage, DevTools, tracing, profiler, dashboard, policy;
- React Native DevTools coverage: console, errors, component tree, props,
  source, performance and profiling surfaces;
- Expo runtime coverage: Expo Router, Metro, Hermes, config, prebuild/native
  change detection, Expo Atlas, simulator/device state;
- Rozenite coverage, used as research input only: plug-in domains, DevTools
  panels, app-side hooks, agent tool contracts, network/storage/navigation,
  performance monitor, require profiler, Expo Atlas, overlay, controls, and
  production-safe development gating.

The spec should not require Rozenite. It should learn from Rozenite's coverage
model and then define the smallest independent `expo-ios` contracts needed to
achieve comparable agent capability.

### Research Deliverables

The research pass must produce these artifacts before implementation work:

- coverage matrix mapping browser-agent features to Expo/RN equivalents;
- DevTools capability matrix for Metro, Hermes inspector, React Native
  DevTools, app-side generated modules, simulator tooling, and native profilers;
- performance measurement matrix with metric name, source, command, artifact,
  reliability level, and known blind spots;
- command taxonomy with `current`, `target-v1`, `target-v2`, and `out-of-scope`
  labels;
- JSON contract sketches for each v1 command family;
- security and policy model for runtime eval, storage writes, app install,
  destructive simulator changes, and untrusted app text;
- verification plan with fixtures, unavailable-state tests, smoke tests, and at
  least one full review/debug/performance workflow.

### Research Sources

Authoritative inputs for this spec:

- agent-browser README:
  `https://raw.githubusercontent.com/vercel-labs/agent-browser/refs/heads/main/README.md`
- Rozenite introduction:
  `https://www.rozenite.dev/docs/introduction`
- Rozenite quick start:
  `https://www.rozenite.dev/docs/getting-started`
- Rozenite for Agents:
  `https://www.rozenite.dev/docs/agent/overview`
- Rozenite in-app tools:
  `https://www.rozenite.dev/docs/agent/adding-tools-to-your-application`
- Rozenite plugin agent tools:
  `https://www.rozenite.dev/docs/agent/making-your-plugin-agent-enabled`
- Rozenite official plugin docs for React Navigation, Network Activity,
  Performance Monitor, Require Profiler, Expo Atlas, Storage, MMKV, Controls,
  and Overlay.

Research conclusions:

- Agent-browser is strongest as a coverage model: stable sessions, semantic refs,
  finders, actions, waits, batch execution, DevTools, storage, network, trace,
  profiler, diff, dashboard, skills, and safety policy.
- Rozenite is strongest as a React Native DevTools model: plugin domains,
  app-side registration, agent-discoverable tool contracts, production-safe
  development gating, performance marks/measures, require profiling, bundle
  analysis, network capture, navigation state, storage adapters, controls, and
  overlays.
- `expo-ios` should not depend on Rozenite, but it should copy the architectural
  lessons: domains, typed contracts, runtime capability discovery, app-side
  dev-only instrumentation, and explicit measurement sources.

### Coverage Matrix

| Browser agent feature | Expo/RN equivalent | Source layer | `expo-ios` command family | Milestone |
| --- | --- | --- | --- | --- |
| Session | Evidence session plus active target | CLI artifacts | `session` | v1 |
| Tab/window | Simulator/app/Metro target | simulator, Metro | `target` | v1 |
| URL navigation | Deep link, route, navigation state | Expo Router, React Navigation | `open-route`, `navigation` | current/v1 |
| Accessibility snapshot | RN semantic tree plus native AX tree | Hermes, RN, AX | `snapshot`, `accessibility` | v1 |
| Element refs | Stable ref cache for nodes | snapshot cache | `refs`, `get`, ref actions | v1 |
| Semantic locators | role/text/label/testID/source finders | RN props, AX, source hints | `find` | v1 |
| Click/fill/press | tap, focus, type, fill, keyboard, gestures | simulator, refs | `tap`, `fill`, `press`, `gesture` | current/v1 |
| Waits | text, route, app-ready, Metro-ready, ref state | runtime, snapshot, Metro | `wait` | v1 |
| Screenshot annotate | screenshot with ref labels | simulator, snapshot | `screenshot --annotate` | v1 |
| Console/errors | JS console and exceptions | RN DevTools, Hermes, logs | `console`, `errors` | v1 |
| Network panel | fetch/XHR/Nitro-style request history | app instrumentation | `network` | v1/v2 |
| Storage | AsyncStorage/MMKV/SecureStore/SQLite adapters | app instrumentation | `storage` | v2 |
| React tree | RN component tree, props, source | React DevTools hook, Hermes | `rn tree`, `rn inspect` | v1 |
| React renders | commit/render profile | React DevTools hook, app instrumentation | `rn renders`, `perf render` | v1/v2 |
| Web vitals | Expo-specific startup and interaction metrics | app marks, simulator, native | `perf startup`, `perf action` | v1 |
| Chrome trace/profile | Hermes trace, RN profile, xctrace, memgraph | Hermes, native profiler | `trace`, `profiler`, `perf ettrace` | current/v2 |
| Diff | screenshot, snapshot, route evidence diff | artifacts | `diff` | v1 |
| Dialogs | native alerts, sheets, modals | simulator, app instrumentation | `dialog`, `sheet` | v2 |
| Init scripts | dev-only generated instrumentation | app module | `instrumentation` | v1 |
| Skills | version-matched plugin instructions | plugin files | `skills` | v1 |
| Dashboard | local session observability | CLI server | `dashboard` | v2 |
| Security policy | action gates, output bounds, redaction | CLI policy | global flags, `policy` | v1 |

### DevTools Capability Matrix

| Capability | Primary source | Fallback | Agent-readable command | Confidence | Blind spots |
| --- | --- | --- | --- | --- | --- |
| Metro status and targets | Metro HTTP endpoints | `npx expo` process hints | `devtools status`, `metro status` | high | wrong target when multiple apps are connected |
| Hermes runtime globals | Hermes inspector `Runtime.evaluate` | none | `devtools capabilities`, `ux-context` | medium | unavailable in production or disconnected targets |
| React component tree | React DevTools hook | Hermes fiber probe | `snapshot`, `rn tree` | medium | private fiber shape can change |
| Source hints | React debug source, Metro symbolication | source maps | `get source @e1`, `metro symbolicate` | medium | minified/release builds may omit source |
| Native accessibility tree | simulator accessibility tooling | screenshot OCR/manual review | `accessibility tree` | medium | tooling availability varies by machine |
| Console messages | RN DevTools/console hook | simulator logs | `console` | medium | native logs and JS console are different streams |
| JS exceptions | RN DevTools/Hermes | simulator logs | `errors` | medium | handled errors may be app-specific |
| Network requests | app-side fetch/XHR instrumentation | logs | `network requests` | medium | native networking stacks are invisible unless instrumented |
| Nitro/native networking | app-side adapter | none | `network requests --source nitro` | low/medium | requires explicit integration |
| Navigation state | app-side navigation ref | route inference | `navigation state` | high with instrumentation | Expo Router internals differ by app |
| Storage | app-side adapters | device filesystem only when known | `storage ...` | high with instrumentation | SecureStore keys require explicit key list |
| Controls/actions | app-side dev-only controls | deep links | `controls`, `app call` | high with instrumentation | side effects must be gated |
| Performance marks | `react-native-performance` style marks | Hermes timing probes | `perf mark list` | high with instrumentation | apps must emit meaningful marks |
| Require/module profiling | Metro require instrumentation | bundle analysis | `perf startup modules` | medium | startup-only; changes runtime behavior |
| Bundle analysis | Expo Atlas/Metro export artifacts | static bundle stats | `perf bundle` | high | dev bundle and release bundle differ |
| Native CPU/hangs | xctrace/ETTrace | runtime hints | `perf ettrace` | high | heavier setup, iOS-only |
| Memory/leaks | memgraph, process memory, Hermes heap | repeated heap samples | `perf memory`, `perf memgraph` | medium/high | one sample is not leak evidence |

DevTools connection policy:

- `expo-ios` should prefer non-invasive Metro and simulator reads.
- Runtime eval is allowed only when `--allow-runtime-eval` permits it or when the
  command is explicitly a runtime probe.
- App-side instrumentation must be dev-only, tree-shakeable, and disabled in
  production/release builds.
- If an agent connection owns the single React Native debugger slot, the command
  must say that React Native DevTools may disconnect.
- A human-visible DevTools panel is not enough. Agent-facing commands need
  structured data or artifacts.

### Performance Measurement Matrix

| Question | Metric | Source | Command | Artifact | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Is the bundle too large? | total bytes, module bytes, duplicate modules | Expo Atlas/Metro export | `perf bundle` | `bundle-report.json` | high | compare dev and production separately |
| What slows startup? | require duration, module count, dependency chains | Metro require instrumentation | `perf startup modules` | `require-profile.json` | medium | best in dev/pre-release diagnostics |
| When is app ready? | launch-to-ready, launch-to-route-visible | app marks, screenshot, wait | `perf startup` | `startup.json`, screenshots | medium/high | app must define ready marks for high confidence |
| Did an interaction regress? | action duration, commits, layout churn, network count | action wrapper, trace, network | `perf action` | `perf-action.json` | medium | must name representative action |
| Are renders excessive? | commit count, component render count | React DevTools hook/app instrumentation | `rn renders`, `perf render` | `renders.json` | medium | React hook needed for durable results |
| Is network the bottleneck? | request duration, failures, duplicates, waterfall | network instrumentation | `network requests`, `perf action` | `network.json`, HAR | medium/high | JS-thread only unless native adapter exists |
| Is storage slowing the flow? | storage read/write count and duration | storage instrumentation | `storage trace`, `perf action` | `storage-trace.json` | medium | requires app adapters |
| Is memory leaking? | repeated memory growth, retained objects, heap delta | memgraph, process memory, Hermes heap | `perf memory`, `perf memgraph` | `.memgraph`, `memory.json` | medium/high | repeated samples or memgraph required |
| Is the UI smooth? | frame drops, long tasks, visual/video evidence | simulator, trace, native profiler | `perf frames`, `record`, `perf ettrace` | video, trace | medium/high | source review alone is insufficient |
| Did native code regress? | CPU, hangs, allocation, symbolicated stacks | xctrace/ETTrace/Instruments | `perf ettrace` | trace package | high | iOS-only and heavier workflow |

### Milestone Scope

The final spec should sort work into milestones so implementation can proceed
without trying to build every target command at once.

#### Milestone 0: Current Contract Freeze

Purpose: lock the existing CLI behavior before refactoring.

Must include:

- current commands: `doctor`, `project-info`, `routes`, `devices`,
  `boot-simulator`, `open-url`, `open-route`, `launch-app`, `screenshot`,
  `tap`, `gesture`, `logs`, `ux-context`, `inspector`, `trace`,
  `annotate-screen`, `review-overlay`, `review-next`;
- JSON envelope tests;
- unavailable Metro tests;
- redaction tests;
- route fixture tests;
- gesture dry-run tests;
- session-contract tests rejecting MCP-first usage.

#### Milestone 1: Agent Browser Parity Core

Purpose: give agents stable targets, refs, actions, waits, DevTools status, and
basic performance evidence.

Command families:

- `session`: list/show/new/close/clean.
- `target`: list/select/current.
- `snapshot`: semantic RN snapshot with `@e` refs.
- `refs` and `get`: cached ref introspection.
- `find`: role/text/label/placeholder/testID/source locators.
- ref actions: `tap @e1`, `long-press @e1`, `fill @e1`, `focus @e1`,
  `press`, `keyboard`, `scroll`, `scroll-into-view`.
- `wait`: text, route, Metro ready, app ready, ref visible/hidden.
- `batch`: one process, shared target/ref cache, `--bail`.
- `screenshot --annotate`.
- `devtools status`, `devtools capabilities`.
- `console`, `errors`, `metro status`, `metro symbolicate`.
- `perf summary`, `perf startup`, `perf action`, `perf bundle`.
- global safety flags: `--max-output`, `--content-boundaries`,
  `--allow-runtime-eval`, `--action-policy`.
- `skills list/get`.

Required generated app module:

- development-only instrumentation root;
- stable snapshot/ref bridge;
- navigation state bridge;
- app ready marker;
- performance mark bridge;
- optional console/error/network hooks.

Generated app instrumentation approval:

- Approved scope: a generated, opt-in, development-only bridge may be created
  under `generated/app-instrumentation/` and imported by an Expo app only from
  development entrypoints or guarded root layout code.
- Production exclusion: generated bridge code must be gated by `__DEV__` or an
  equivalent build-time development flag, must default to disabled, and must not
  be required for release builds, production bundles, or app store artifacts.
- Stable bridge entrypoint: the app exposes one manifest and one tool-call
  entrypoint matching `AppInstrumentationBridge.manifest(...)` and
  `AppInstrumentationBridge.callTool(...)` from
  `src/generated/app-instrumentation/contracts.ts`.
- Initial tool domains: `snapshot.capture`, `snapshot.resolve`,
  `navigation.state`, `app.ready`, `app.waitUntilReady`,
  `performance.marks`, `performance.clearMarks`, `console.messages`,
  `console.clear`, `errors.errors`, `errors.clear`, and optional
  `network.requests`/`network.clear` when the app installs network hooks.
- Safety constraints: all bridge results pass through CLI redaction, output
  bounds, action policy, and run-record summaries; tools that mutate app state
  must declare side effects in the manifest and require policy approval before
  command handlers call them.
- Removal path: deleting the generated import plus the
  `generated/app-instrumentation/` directory must fully remove the bridge.
  Future `instrumentation remove` work should automate that deletion and verify
  no production entrypoint still imports the generated module.
- Supported dependents: `snapshot`, `wait --app-ready`, `navigation state`,
  `perf mark/list`, `perf startup/action`, `console`, `errors`, and `network`
  may use this bridge only after reporting the bridge source in their evidence
  payloads. Commands must keep an unavailable fallback when the bridge is absent.
- Navigation evidence: `navigation state` is read-only and prefers the
  plugin-bridge `navigation` domain when present. Imperative bridge navigation
  actions such as `back`, `pop-to-root`, and `tab` require action-policy
  approval before any runtime call is attempted. `navigation deep-link` remains
  the explicit open-route fallback and reports `evidenceSource: deep-link`.
- Network evidence: `network status`, `network requests`, `network request`,
  and `network har stop` prefer the plugin-bridge `network` domain, then
  React Native DevTools-style network globals, then legacy app instrumentation.
  Results must include `evidenceSource`, Metro/Hermes transport metadata,
  capture timing, limitations, and redaction metadata for HAR artifacts.
  Unavailable network results distinguish no runtime target, no DevTools network
  domain, no bridge network domain, no observed traffic, malformed payloads, and
  transport failures.
- Storage and controls evidence: `storage` reads and `controls list/get` prefer
  plugin-bridge domains and preserve bounded, redacted output. `storage set`,
  `storage clear`, and `controls press` require action-policy approval before
  Runtime.evaluate and include source, transport, and before/after evidence when
  the bridge provides it. Missing domain, unavailable bridge, and version
  mismatch states return stable JSON.
- Performance evidence: `perf startup`, `perf action`, `perf mark`,
  `perf measure`, `perf js-thread`, and `perf frames` prefer the plugin-bridge
  or Rozenite performance domain, then Expo/React Native DevTools-style
  performance globals, then legacy app instrumentation. `perf summary` reports
  upstream/plugin capabilities separately from native/static fallbacks. Runtime
  performance payloads include `evidenceSource`, transport, build/platform
  context, samples, confidence, artifacts, limitations, and malformed-metric
  unavailable states. Native profilers and static bundle reports remain explicit
  fallbacks.
- Semantic snapshot evidence: `snapshot`, `refs`, `find`, `get`, `inspect`,
  and `accessibility tree` prefer plugin-bridge semantic refs when a bridge
  semantic domain is reachable, and record `plugin-bridge-semantic` source
  metadata. Native accessibility hierarchy, screenshots, cached refs, stale-ref
  errors, disabled-ref behavior, and action-policy gates remain independent
  fallbacks. Accessibility tree output may include both bridge semantics and
  native AX hierarchy when both are available.
- Bridge discovery commands: `bridge status`/`plan` report project install
  state without mutation; `bridge health` probes Metro plus Hermes CDP for live
  app registration, bridge version compatibility, domain metadata, and transport
  details; `bridge domains` advertises read commands and write commands
  separately, marks write commands as action-policy gated, and reports
  per-domain redaction boundaries. Missing bridge, missing app registration,
  stale metadata, version mismatch, and transport failure return stable
  unavailable JSON instead of throwing.

Milestone 1 done means a future agent can run:

```bash
expo-ios --json session new review
expo-ios --json target list
expo-ios --json open-route /customers --cwd apps/mobile
expo-ios --json wait --text "Customers"
expo-ios --json snapshot --interactive --source --bounds
expo-ios --json screenshot --annotate
expo-ios --json find role button --name "Add" tap
expo-ios --json perf action "add customer open" --capture screenshot,trace
```

and receive stable JSON plus artifacts without hand-written runtime scripts.

Milestone 1 command contracts:

| Command family | Purpose | Required inputs | Output | Side effects | Failure shape | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `session` | Scope artifacts, refs, and active target | session name optional | session ID, paths, target | creates/updates `.scratch/expo-ios/sessions` | usage for invalid name; runtime for file errors | create/list/show/close/clean fixtures |
| `target` | Resolve simulator/app/Metro tuple | platform optional | target ID, device, app, Metro target, status | `select` writes session target | unavailable when no devices or Metro target | multiple-target fixture; stale target fixture |
| `snapshot` | Capture semantic RN/AX tree with refs | target, filters | snapshot ID, refs, nodes, source, bounds | writes snapshot artifact and ref cache | unavailable when no runtime/AX source exists | stable refs; compact/depth/filter tests |
| `refs` | Read cached refs | session/snapshot optional | ref list with staleness | none | unavailable when no snapshot exists | stale-on-route-change test |
| `get` | Inspect one ref | ref and field | text/props/box/style/source | none | usage for stale/missing ref | each field fixture |
| `find` | Locate refs semantically | locator kind/value | matched refs and optional action result | optional action side effect | not-found result is not usage error | role/text/testID/source fixtures |
| ref actions | Act on semantic refs | ref plus action args | action result, before/after artifacts optional | simulator/app mutation | stale ref; disabled action; missing tool | dry-run and live-plan tests |
| `wait` | Replace sleeps with readiness predicates | predicate and timeout | matched predicate, elapsed time | none | timeout is runtime failure with last evidence | text/route/app-ready timeout tests |
| `batch` | Run multi-step flow in one process | command array | per-step results | step-specific | step error with index and prior results | stdin/argv, bail/non-bail tests |
| `screenshot --annotate` | Visual evidence with ref labels | target, optional snapshot | image path, label map | writes image | unavailable bounds or screenshot tool | label/ref consistency test |
| `devtools` | Discover machine-readable DevTools signals | target | capabilities and transport info | event start/stop writes artifacts | unavailable target or unsupported signal | capability matrix fixture |
| `console`/`errors` | Read JS diagnostics | target, since/limit | messages/errors with source | clear mutates local buffer | unavailable source | clear/read fixture |
| `perf summary` | Summarize current measurable signals | target | available metrics and confidence | none | unavailable source list | confidence classification test |
| `perf startup` | Measure launch/ready route | target, route, samples | startup metrics, artifacts | may launch/reload app | missing app-ready marker degrades confidence | cold/warm sample fixture |
| `perf action` | Measure one user flow | action plan | action metrics, artifacts | acts on app | failure includes partial evidence | representative action fixture |
| `perf bundle` | Report bundle/module size | cwd, build kind | bundle metrics, artifact path | may run export/analyzer only with explicit flag | missing bundle artifact | static fixture |
| `skills` | Print version-matched guidance | skill name optional | skill metadata/content | none | missing skill usage error | list/get fixture |

Each Milestone 1 command must support:

- `--json` success and error envelopes;
- bounded output and artifact path for large payloads;
- redaction before stdout, stderr, and run-record persistence;
- unavailable results when a source is optional;
- command-level help with examples;
- session/run-record integration;
- tests for success, usage error, unavailable source, and redaction when
  relevant.

#### Milestone 2: DevTools Domains

Purpose: match the useful Rozenite domain model without depending on Rozenite.

Command families:

- `network`: status, requests, request, clear, HAR start/stop.
- `navigation`: state, back, pop-to-root, tab, deep-link.
- `storage`: AsyncStorage, MMKV, SecureStore, SQLite adapters.
- `controls`: list, get, set, press for app-defined controls.
- `rn`: tree, inspect, renders start/stop, fiber debug.
- `diff`: snapshot, screenshot, route.
- `record`: video start/stop.
- `accessibility`: tree, inspect, audit.
- `dialog` and `sheet`.

Required generated app module:

- typed domain registration;
- storage adapters with blacklist support;
- network hooks with response size limits and redaction;
- render/profiler hooks;
- controls schema.

#### Milestone 3: Deep Performance and Native Evidence

Purpose: make performance claims defensible across JS, bundle, and native
layers.

Command families:

- `perf mark`, `perf measure`, `perf compare`, `perf budget`.
- `perf startup modules` for require profiling.
- `perf js-thread`, `perf frames`, `perf memory`.
- `perf ettrace start/stop`.
- `perf memgraph capture`.
- `dashboard` for live evidence monitoring.

Required artifacts:

- startup report;
- require profile;
- render profile;
- network HAR;
- memory sample series;
- memgraph or ETTrace artifact when native evidence is claimed;
- before/after comparison report.

#### Out of Scope Until Explicitly Requested

- Rozenite dependency or wrapper commands.
- Hosted/cloud device providers.
- Autonomous repair/fix commands.
- Production traffic interception or mutation.
- Generic AI chat inside the CLI.
- Credentials vault.
- App store/release automation.

### Definition of Done for Final SPEC.md

The final spec must be specific enough that a different agent can implement the
first milestone without redoing the research.

Required properties:

- Every v1 command has purpose, inputs, output shape, failure shape, artifacts,
  side effects, redaction rules, and tests.
- Every performance claim has a named measurement source and confidence level.
- Every DevTools feature says whether it is static project data, simulator
  data, Metro data, Hermes runtime data, React Native DevTools data, app-side
  instrumentation, or native profiler data.
- Every action that mutates app/device state has a dry-run or explicit policy
  gate unless impossible.
- Every runtime feature degrades cleanly when Metro, Hermes, React DevTools
  hooks, or optional local tools are absent.
- The spec distinguishes dev-build, Expo Go, production-like preview build, and
  release/archive contexts.
- The spec says which commands are safe for routine agents and which require a
  human or explicit approval.

### Setup and Maintenance

```bash
expo-ios install                 # target: install/check optional local helpers
expo-ios upgrade                 # target: upgrade installed CLI when packaged
expo-ios doctor                  # current: diagnose local tooling and project
expo-ios doctor --fix            # target: repair stale sidecars only with explicit flag
expo-ios skills                  # target: list matching plugin skills for this CLI version
expo-ios skills get expo-ios-cli # target: print bundled skill instructions
```

Coverage intent:

- Make first-run setup explicit.
- Detect missing optional tools before a review session.
- Keep CLI docs and companion skills version-aligned.
- Avoid hidden repairs unless `--fix` is present.

### Sessions

```bash
expo-ios session list               # target: list active evidence sessions
expo-ios session show [name]         # target: show current session metadata
expo-ios session new [name]          # target: create isolated artifact namespace
expo-ios session close [name]        # target: stop sidecars for a session
expo-ios session clean --older-than 7d
```

Coverage intent:

- Separate multiple concurrent agents or app targets.
- Keep artifacts, refs, screenshots, logs, and traces scoped.
- Prevent stale local servers from confusing later runs.

Unlike browser sessions, an Expo session does not own the simulator process by
default. It owns CLI artifacts, runtime refs, local servers, and selected target
metadata.

### Targets and App Lifecycle

```bash
expo-ios devices                       # current
expo-ios boot-simulator                # current
expo-ios target list                   # target: list known simulator/app/Metro pairs
expo-ios target select <target-id>      # target: set active target in session
expo-ios launch-app --bundle-id ...     # current
expo-ios terminate-app --bundle-id ...  # target
expo-ios reload-app                     # target: reload JS through dev menu/Metro
expo-ios open-dev-menu                 # target alias for inspector open-dev-menu
expo-ios install-app <path.app|ipa>     # target
expo-ios uninstall-app --bundle-id ...  # target
```

Coverage intent:

- Give agents stable target handles instead of repeatedly guessing booted
  simulators and Metro targets.
- Support common app lifecycle operations without hiding native build/install
  complexity.
- Keep build commands separate from runtime evidence commands.

### Navigation

```bash
expo-ios routes                         # current
expo-ios open-url <url>                 # current
expo-ios open-route /customers/123      # current
expo-ios navigation state               # target: current navigation tree/state
expo-ios navigation back                # target
expo-ios navigation pop-to-root         # target
expo-ios navigation tab <name|index>    # target
expo-ios navigation deep-link <route>   # target alias around open-route
```

Coverage intent:

- Cover Expo Router filesystem discovery and runtime navigation state.
- Let agents drive flows by route, tab, stack, and back behavior.
- Prefer real app navigation over direct state mutation.

### Semantic Snapshot and Refs

Browser automation CLIs work well because `snapshot` produces stable element
refs such as `@e1`. `expo-ios` needs the same idea for React Native.

```bash
expo-ios snapshot                         # target: semantic RN tree with refs
expo-ios snapshot --interactive           # target: pressable/text-input/switch rows only
expo-ios snapshot --compact               # target: remove empty structural nodes
expo-ios snapshot --depth 5               # target
expo-ios snapshot --source                # target: include source file/line when available
expo-ios snapshot --bounds                # target: include screen bounds
expo-ios snapshot --testid                # target: emphasize testID/nativeID
expo-ios refs                             # target: list cached refs from last snapshot
expo-ios get text @e1                     # target
expo-ios get props @e1                    # target
expo-ios get box @e1                      # target
expo-ios get style @e1                    # target: declared style summary
expo-ios get source @e1                   # target
```

Coverage intent:

- Make agents act on semantic refs instead of raw coordinates.
- Bind screenshots, annotations, gestures, and source hints to the same cached
  ref table.
- Prefer accessibility role/label/testID/source over private fiber paths.

Ref rules:

- Refs use `@e1`, `@e2`, etc. within a session and target.
- Refs are invalidated when the app reloads, route changes, or a fresh snapshot
  detects a materially different tree.
- Positional integers are not accepted as refs.
- Cached refs must record snapshot ID, target ID, bounds, label, role, testID,
  source hint, and staleness status.

### Element Finders

```bash
expo-ios find role button
expo-ios find role button --name "Save"
expo-ios find text "Sign In"
expo-ios find label "Email"
expo-ios find placeholder "Email"
expo-ios find testid submit-button
expo-ios find source "CustomerCard"
expo-ios find first "Pressable"
expo-ios find nth 2 "Cell"
```

Supported actions on finder results:

```bash
expo-ios find role button --name "Save" tap
expo-ios find label "Email" fill "test@example.com"
expo-ios find text "Delete" long-press
expo-ios find testid list scroll-into-view
expo-ios find source "CalendarEvent" inspect
```

Coverage intent:

- Provide semantic locator workflows equivalent to ARIA locators on the web.
- Keep raw coordinate actions as a fallback, not the default.
- Make source/component name search useful for developer workflows without
  treating it as user-facing truth.

### Actions

```bash
expo-ios tap --x 120 --y 480              # current
expo-ios tap @e1                          # target
expo-ios long-press @e1                   # target
expo-ios dbltap @e1                       # target
expo-ios fill @e1 "hello"                 # target
expo-ios type "hello"                     # target: type into current focus
expo-ios press Enter                      # target: hardware/software key event
expo-ios focus @e1                        # target
expo-ios blur                             # target
expo-ios select @e1 "Option"              # target: picker/menu where possible
expo-ios check @e1                        # target: switch/checkbox-like controls
expo-ios uncheck @e1                      # target
expo-ios gesture drag ...                 # current
expo-ios drag @e1 @e2                     # target
expo-ios scroll down 600                  # target
expo-ios scroll @e1 down 600              # target
expo-ios scroll-into-view @e1             # target
```

Coverage intent:

- Cover the full set of user manipulations an agent needs for forms, lists,
  modals, gestures, and direct-manipulation surfaces.
- Make each action optionally capture before/after screenshots and runtime
  context.
- Require `--dry-run true` support for all risky or environment-dependent
  actions.

### Waits

```bash
expo-ios wait 1000                         # target: sleep in milliseconds
expo-ios wait @e1 --state visible           # target
expo-ios wait --text "Welcome"              # target
expo-ios wait --route "/customers/:id"      # target
expo-ios wait --metro-ready                 # target
expo-ios wait --app-ready                   # target: runtime probe/app marker
expo-ios wait --no-spinner                  # target: common loading heuristic
expo-ios wait --fn "globalThis.appReady"    # target: Hermes expression, gated
```

Coverage intent:

- Replace brittle shell sleeps with explicit readiness checks.
- Cover route, UI, text, Metro, app runtime, and custom condition waits.
- Keep `--fn` disabled by policy unless runtime eval is allowed.

### Batch Execution

```bash
expo-ios batch \
  '["doctor"]' \
  '["open-route", "/customers"]' \
  '["wait", "--text", "Customers"]' \
  '["snapshot", "--interactive"]' \
  '["screenshot"]'

echo '[
  ["open-route", "/customers"],
  ["snapshot", "--interactive"],
  ["tap", "@e2"]
]' | expo-ios --json batch --bail
```

Coverage intent:

- Avoid process startup overhead for multi-step flows.
- Keep one session target and ref cache across commands.
- Support `--bail` to stop after the first failure.
- Emit per-step results under one JSON envelope.

### Clipboard and Text Input

```bash
expo-ios clipboard read             # target: simulator pasteboard
expo-ios clipboard write "text"      # target
expo-ios clipboard paste             # target
expo-ios keyboard type "hello"       # target
expo-ios keyboard press Enter        # target
```

Coverage intent:

- Support auth codes, copied debug output, and paste-heavy forms.
- Prefer simulator pasteboard APIs where available.

### Device and Environment Settings

```bash
expo-ios set appearance dark             # target
expo-ios set appearance light            # target
expo-ios set content-size accessibility  # target: Dynamic Type category
expo-ios set locale en_GB                # target
expo-ios set timezone Europe/London      # target
expo-ios set location 51.5074 -0.1278    # target
expo-ios set network offline             # target, simulator support permitting
expo-ios set permissions camera=granted  # target
expo-ios set orientation portrait        # target
expo-ios set keyboard software           # target
```

Coverage intent:

- Cover iOS state that materially changes UI behavior.
- Make accessibility and dark-mode verification scriptable.
- Keep environment mutation explicit and session-recorded.

### Screenshots, Video, and Diff

```bash
expo-ios screenshot                         # current
expo-ios screenshot --annotate              # target: refs overlaid on image
expo-ios screenshot --full                  # target when scroll capture is possible
expo-ios record start                       # target: simulator video
expo-ios record stop [path]                 # target
expo-ios diff screenshot --baseline a.png   # target
expo-ios diff snapshot --baseline before.json
expo-ios diff route /a /b --screenshot      # target
```

Coverage intent:

- Make visual verification first-class.
- Give multimodal agents stable labels matching semantic refs.
- Support before/after evidence without relying only on prose.

Annotated screenshot rules:

- Labels must map to cached refs from the same snapshot.
- Screenshot metadata must include device, scale, orientation, route hint,
  snapshot ID, and timestamp.
- If element bounds are unavailable, annotated screenshots must say so rather
  than drawing guessed labels.

### Accessibility

```bash
expo-ios accessibility tree             # target: native AX hierarchy
expo-ios accessibility inspect @e1      # target
expo-ios accessibility audit            # target: common RN/iOS checks
expo-ios accessibility focus @e1        # target, if supported
```

Coverage intent:

- Separate native accessibility hierarchy from React component hierarchy.
- Catch missing labels, roles, hit targets, focus traps, and Dynamic Type
  failures.
- Make design review evidence accessible to non-visual workflows.

### Network

```bash
expo-ios network status                  # target: can runtime see fetch/XHR hooks?
expo-ios network requests                # target: tracked requests
expo-ios network request <id>            # target: request/response detail
expo-ios network clear                   # target
expo-ios network har start               # target
expo-ios network har stop [output.har]   # target
```

Coverage intent:

- Support debugging loading states, failed mutations, auth redirects, and API
  errors in a running Expo app.
- Use dev-only runtime instrumentation when Metro/Hermes alone cannot observe
  enough.
- Redact headers, cookies, query secrets, and response bodies by default.

Out of scope until explicit app instrumentation exists:

- Request interception and mocking.
- Mutating production API traffic.

### Storage and App State

```bash
expo-ios storage async list              # target: AsyncStorage keys
expo-ios storage async get <key>         # target
expo-ios storage async set <key> <json>  # target, gated as write
expo-ios storage async clear             # target, dangerous
expo-ios storage mmkv list               # target when module detected
expo-ios storage sqlite list             # target when database path known
expo-ios state save <name>               # target: app/session evidence state
expo-ios state load <name>               # target, gated
expo-ios state list                      # target
expo-ios state clear <name>              # target, dangerous
```

Coverage intent:

- Give agents enough state visibility to debug onboarding, auth, feature flags,
  persisted forms, and cache bugs.
- Keep destructive storage operations explicitly gated.

### Dialogs, Alerts, Sheets, and Modals

```bash
expo-ios dialog status                  # target: alert/action sheet if visible
expo-ios dialog accept [text]           # target
expo-ios dialog dismiss                 # target
expo-ios sheet status                   # target: RN/native modal/sheet hints
expo-ios sheet dismiss                  # target
```

Coverage intent:

- Prevent hidden native dialogs from blocking sessions.
- Make modal/sheet state part of review evidence.

### Debug

```bash
expo-ios logs                            # current
expo-ios console                         # target: JS console messages
expo-ios console --clear                 # target
expo-ios errors                          # target: runtime JS errors
expo-ios errors --clear                  # target
expo-ios trace start                     # current
expo-ios trace read                      # current
expo-ios trace stop                      # current
expo-ios profiler start                  # target
expo-ios profiler stop [path]            # target
expo-ios inspect @e1                     # target: source/props/bounds/log bundle
expo-ios highlight @e1                   # target: temporary overlay highlight
expo-ios metro status                    # target
expo-ios metro reload                    # target
expo-ios metro symbolicate <stack-file>  # target
```

Coverage intent:

- Cover common runtime debugging without leaving the terminal.
- Keep React Native private-hook usage isolated and clearly labeled.
- Prefer app/runtime instrumentation for durable console/error/profiling data.

DevTools coverage target:

```bash
expo-ios devtools status                 # target: Metro/RN DevTools availability
expo-ios devtools open                   # target: open React Native DevTools
expo-ios devtools panels                 # target: list available known panels/domains
expo-ios devtools capabilities           # target: machine-readable capabilities
expo-ios devtools events start           # target: begin collecting DevTools events
expo-ios devtools events read            # target
expo-ios devtools events stop            # target
```

DevTools intent:

- Treat React Native DevTools as an evidence source, not just a UI to open.
- Surface whether console, errors, React tree, network, storage, navigation,
  performance, and custom app domains are available.
- Keep panel discovery separate from command execution. A panel may exist for
  humans without exposing enough machine-readable data for agents.
- Capture DevTools-derived events into artifacts that can be diffed and cited.
- State the transport used for each signal: Metro endpoint, Hermes inspector,
  React DevTools hook, app-side generated instrumentation, simulator command,
  or native profiler.

Agent-readable DevTools results must use the canonical `DevToolsCapability`
schema in the Schemas section.

### React Native and Expo Introspection

```bash
expo-ios rn tree                         # target: component tree
expo-ios rn inspect @e1                  # target: props/hooks/source when available
expo-ios rn renders start                # target
expo-ios rn renders stop                 # target
expo-ios rn fiber @e1                    # target: debug-only private details
expo-ios expo modules                    # target: detected Expo modules
expo-ios expo config                     # target: resolved Expo config summary
expo-ios expo doctor                     # target: wrapper around npx expo-doctor
expo-ios expo upstream-policy            # target: upstream dependency stability report
expo-ios expo prebuild-plan              # target: config-plugin/native-change summary
```

Coverage intent:

- Give Expo-specific context that browser automation does not need.
- Detect native runtime changes that require rebuilds instead of OTA updates.
- Distinguish source/static project facts from live runtime facts.

Upstream dependency stability policy:

- Public APIs, such as Expo config and `expo/devtools`, may be used directly
  when the project declares the package and compatibility is known.
- Documented but unstable APIs, such as Metro inspector endpoints and React
  Native DevTools metadata, must be accessed through narrow `expo-ios` adapter
  shims with structured unavailable states.
- Internal Expo, Metro, Hermes, React Native, or DevTools implementation paths
  are reference-only unless isolated behind optional compatibility shims with
  fallback behavior.
- Optional bridge ecosystems such as Rozenite are reported as optional
  compatibility shims. Their absence is not a CLI failure.
- `project-info` and `expo upstream-policy` expose the policy and per-surface
  status in machine-readable JSON, including direct dependencies,
  internal-reference-only surfaces, missing packages, unresolved catalog or
  workspace versions, and Expo/React Native version mismatches where known.

Required introspection layers:

- `expo project`: package manager, Expo SDK, RN version, app config, schemes,
  plugins, scripts, CNG/prebuild risk.
- `metro`: status, targets, bundle URLs, source-map availability, symbolication,
  Atlas or bundle metadata when enabled.
- `runtime`: Hermes/Fabric/dev mode, globals, current route, app readiness,
  component tree, selected props, source hints.
- `native`: simulator/device, bundle ID, process status, logs, screenshots,
  accessibility tree, memory/process summary when available.
- `app instrumentation`: optional generated dev-only module for network,
  storage, navigation, performance marks, custom controls, and stable refs.

### Performance

```bash
expo-ios perf summary                    # target
expo-ios perf startup                    # target
expo-ios perf js-thread                  # target
expo-ios perf frames                     # target
expo-ios perf memory                     # target
expo-ios perf bundle                     # target
expo-ios perf ettrace start              # target bridge to ETTrace skill/script
expo-ios perf ettrace stop               # target
expo-ios perf memgraph capture           # target bridge to memgraph skill/script
```

Coverage intent:

- Cover startup, JS thread responsiveness, render churn, memory, and bundle
  signals before reaching for heavyweight native tooling.
- Keep ETTrace and memgraph workflows available but not mixed into routine
  screenshot/review commands.

Performance must be measured in layers. The CLI should not collapse all
performance into one score.

Required measurement layers:

- `bundle`: Metro/Expo Atlas bundle size, module size, duplicate modules,
  dependency chains, production export artifacts.
- `startup`: launch to JS ready, launch to first route visible, module require
  cost, app-defined startup marks, Time to Interactive proxy.
- `interaction`: input latency, gesture duration, render commits during action,
  dropped-frame hints, layout churn, requestAnimationFrame activity.
- `render`: React commit count, render hot spots, selected component render
  counts, prop/style churn, Suspense/loading boundaries where detectable.
- `network`: request count, slow requests, failed requests, duplicate calls,
  waterfall around a user action.
- `storage`: cache size, large AsyncStorage/MMKV/SQLite reads, migration time,
  state load/save costs where instrumented.
- `memory`: process memory summary, JS heap where Hermes exposes it, memgraph
  artifacts for leak investigations.
- `native`: ETTrace/Instruments artifacts for CPU, hangs, animation stalls, and
  native memory when routine runtime signals are insufficient.

Performance command contracts:

```bash
expo-ios perf mark list                  # target: app-defined marks/measures
expo-ios perf mark clear                 # target
expo-ios perf measure start <name>       # target
expo-ios perf measure stop <name>        # target
expo-ios perf action "open customer" \
  --route /customers/123 \
  --wait-text "Customer" \
  --capture screenshot,trace,network
expo-ios perf compare --baseline before.json --candidate after.json
expo-ios perf budget check --file expo-ios.perf.json
```

Each performance result must include:

- measurement source;
- build context: Expo Go, dev build, preview/release-like build, or production
  export;
- device/simulator model and OS;
- Metro/dev mode status;
- warm/cold run classification;
- sample count and variance when repeated;
- artifact paths;
- interpretation limits.

Performance payloads must use the canonical `PerformanceResult` schema in the
Schemas section.

Performance acceptance rules:

- A startup or bundle-size claim must include bundle/build context.
- An interaction-performance claim must include the representative action used.
- A render-performance claim must say whether it came from React hooks,
  app-side instrumentation, or inferred Hermes tracing.
- A memory-leak claim requires repeated measurements or a memgraph/native
  artifact; one heap sample is only a hint.
- A UI smoothness claim requires screenshot/video/frame/trace evidence, not
  only source review.
- Development-mode measurements must be labeled as development-mode evidence
  and not generalized to release performance without a release-like run.

### Review and Annotation

```bash
expo-ios annotate-screen                 # current
expo-ios review-overlay scaffold         # current
expo-ios review-overlay prepare          # current
expo-ios review-overlay read             # current
expo-ios review-next                     # current
expo-ios review report                   # target: assemble evidence packet
expo-ios review matrix                   # target: acceptance matrix helper
```

Coverage intent:

- Preserve the CLI's current strength: disciplined UX review evidence.
- Connect semantic refs, screenshots, annotations, gestures, and source links.
- Make final handoffs easier without letting the CLI decide subjective quality.

### Observability Dashboard

```bash
expo-ios dashboard start                 # target
expo-ios dashboard stop                  # target
expo-ios dashboard status                # target
```

Coverage intent:

- Provide a local browser dashboard for active sessions.
- Show latest screenshot, command activity, logs, refs, comments, and artifacts.
- Avoid embedding model chat in v1. The dashboard is for observability first.

### Security and Policy

```bash
expo-ios policy show                     # target
expo-ios policy check action tap         # target
expo-ios redact <file>                   # target
```

Policy controls:

- `--max-output <chars>`: cap stdout payloads.
- `--content-boundaries`: wrap untrusted app text in delimiters.
- `--allow-runtime-eval true|false`: gate Hermes `Runtime.evaluate`.
- `--confirm-actions <list>`: require interactive confirmation for writes when
  a human TTY is available; auto-deny otherwise.
- `--action-policy <path>`: static policy for destructive storage, app install,
  uninstall, runtime eval, file upload, and state load/clear.

Coverage intent:

- Keep agent workflows safe on real projects.
- Make risky actions explicit and auditable.
- Treat app-rendered text as untrusted when feeding it back to an LLM.

### Discovery

#### `expo-ios doctor`

Check local readiness.

Usage:

```bash
expo-ios --json doctor [--cwd <dir>]
```

Behavior:

- Reports CLI name/version.
- Detects Node, `npx`, `xcrun`, `open`, `plutil`, `idb`, `axe`, and `adb`.
- Reports iOS simulator and Android device capability booleans.
- Reads project context when `cwd` or `--root` points at an Expo app.
- Reports auth as not required.
- Does not start Metro, boot devices, or mutate project files.

#### `expo-ios project-info`

Read Expo project metadata.

Usage:

```bash
expo-ios --json project-info --cwd apps/mobile
```

Behavior:

- Locates nearest `package.json`.
- Detects package manager, Expo, React Native, and Expo Router versions.
- Reads `app.json` or extracts a conservative summary from `app.config.*`.
- Reports iOS bundle identifier, Android package, URL scheme, app name, and
  scripts when discoverable.

#### `expo-ios routes`

Build a filesystem-derived Expo Router sitemap.

Usage:

```bash
expo-ios --json routes --cwd apps/mobile [--app-dir app]
```

Behavior:

- Scans route files without starting Metro.
- Emits route paths, source files, dynamic segment metadata, and special files
  such as layouts.
- Does not evaluate route modules.

#### `expo-ios devices`

List visible devices and simulators.

Usage:

```bash
expo-ios --json devices [--platform ios|android|all] [--limit 40]
```

Behavior:

- Uses `xcrun simctl list devices --json` for iOS.
- Uses `adb devices` for Android.
- Marks booted/default candidates.
- Does not boot or launch anything.

### Simulator and App Actions

#### `expo-ios boot-simulator`

Boot an iOS simulator.

Usage:

```bash
expo-ios --json boot-simulator [--device <name-or-udid>] [--open-simulator true]
```

Behavior:

- Resolves a simulator by UDID, exact name, partial name, booted device, or
  newest reasonable iPhone fallback.
- Boots the simulator if needed.
- Opens Simulator.app when requested.

#### `expo-ios open-url`

Open a URL or deep link on a device.

Usage:

```bash
expo-ios --json open-url myapp:///customers/123
expo-ios --json open-url --platform android --device emulator-5554 myapp:///customers/123
```

Behavior:

- Uses `xcrun simctl openurl` for iOS.
- Uses `adb shell am start` for Android.
- Redacts sensitive query parameters in run records.

#### `expo-ios open-route`

Open an Expo Router route using inferred or supplied scheme.

Usage:

```bash
expo-ios --json open-route /customers/123 --cwd apps/mobile
expo-ios --json open-route --scheme myapp --route /settings --query "tab=billing"
```

Behavior:

- Infers scheme from Expo config when possible.
- Builds a deep link from route and query.
- Delegates to `open-url`.
- Does not validate that the route exists unless route metadata is available.

#### `expo-ios launch-app`

Launch an installed app.

Usage:

```bash
expo-ios --json launch-app --bundle-id com.example.app
```

Behavior:

- Launches iOS bundle IDs or Android package/activity names.
- Does not install or build the app.

#### `expo-ios screenshot`

Capture a device screenshot.

Usage:

```bash
expo-ios --json screenshot [--output-path /tmp/screen.png]
```

Behavior:

- Writes a PNG to a supplied or temporary path.
- Returns the absolute image path and device metadata.
- Does not analyze the image.

#### `expo-ios tap`

Tap screen coordinates.

Usage:

```bash
expo-ios --json tap --x 120 --y 480
```

Behavior:

- Uses `idb ui tap` for iOS when installed.
- Uses `adb shell input tap` for Android.
- Fails with a setup hint when the required tool is missing.

#### `expo-ios gesture`

Plan or run tap, long-press, drag, and swipe gestures.

Usage:

```bash
expo-ios --json gesture drag \
  --start-x 180 --start-y 900 --end-x 180 --end-y 1200 \
  --duration-ms 1100 --capture-before-after true
```

Behavior:

- Supports `--dry-run true` and should default to dry-run in examples.
- Returns the exact platform command plan.
- Optionally captures before/after screenshots.
- Optionally wraps the interaction with `trace start/read/stop`.
- Includes review questions the gesture can answer.

### Evidence and Runtime

#### `expo-ios logs`

Collect recent device logs.

Usage:

```bash
expo-ios --json logs --bundle-id com.example.app --last 60s
```

Behavior:

- Uses `log show` for iOS simulator logs.
- Uses `adb logcat` for Android.
- Supports process, bundle, package, line, and predicate filters.
- Stores large output in artifacts and returns excerpts.

#### `expo-ios ux-context`

Capture a bounded context packet for the current screen.

Usage:

```bash
expo-ios --json ux-context --cwd apps/mobile --metro-port 8081
```

Behavior:

- Captures screenshot unless disabled.
- Optionally runs image analysis for coarse layout/color facts.
- Optionally gathers accessibility hierarchy via `axe`.
- Optionally inspects Metro and Hermes runtime state.
- Optionally summarizes React component/layout data from the debugger target.
- Optionally includes recent logs.
- Returns artifact paths plus a compact JSON summary.

`ux-context` must be an aggregator. Each sub-probe should be independently
available as an internal adapter so failures do not collapse the whole packet.

#### `expo-ios inspector`

Use React Native runtime inspector helpers through Metro/Hermes.

Usage:

```bash
expo-ios --json inspector probe --metro-port 8081
expo-ios --json inspector toggle --metro-port 8081
expo-ios --json inspector install-comment-menu --metro-port 8081
expo-ios --json inspector read-comments --metro-port 8081
```

Behavior:

- `probe` reports whether runtime hooks are reachable.
- `toggle` toggles the built-in RN element inspector.
- `install-comment-menu` registers a dev-menu comment action when supported.
- `open-dev-menu` shakes the simulator through `xcrun simctl`.
- `read-comments` returns stored simulator-side review comments.
- Missing Metro targets return `{ available: false, reason: ... }`.

#### `expo-ios trace`

Start, read, stop, or clear a lightweight interaction trace.

Usage:

```bash
expo-ios --json trace --action start --component-filter Calendar
expo-ios --json trace --action read --max-events 200
expo-ios --json trace --action stop
```

Behavior:

- Uses Metro's Hermes debugger target.
- Records React commits, selected layout/style prop changes, animation-frame
  activity, and handler-bearing components where available.
- Does not claim to observe native-driver or UI-thread work directly.
- Restores patched globals on `stop`.
- Returns interpretation hints and limitations in the payload.

### Human Review Artifacts

#### `expo-ios annotate-screen`

Create a local screenshot annotation board.

Usage:

```bash
expo-ios --json annotate-screen \
  --screenshot-path /tmp/screen.png \
  --output-dir .scratch/expo-ios/annotations/run-1 \
  --serve true
```

Behavior:

- Writes `annotate.html`, `annotations.json`, copied screenshot, and context.
- Can start a local HTTP server for saving comments.
- Does not require app code changes.
- Coordinates are screenshot-level, not guaranteed element bindings.

#### `expo-ios review-overlay`

Scaffold and run a dev-only in-app review overlay.

Usage:

```bash
expo-ios --json review-overlay scaffold --cwd apps/mobile
expo-ios --json review-overlay prepare --cwd apps/mobile --serve true
expo-ios --json review-overlay read --cwd apps/mobile --metro-port 8081
```

Behavior:

- `scaffold` writes a small review overlay component into the app project.
- `prepare` creates event artifacts and optionally starts a local event server.
- `read` returns comments, coordinates, source hints, and symbolicated frames
  when Metro is available.
- Generated app code must be development-only and easy to remove.

Long term, this should be split into:

- a generated dev-only app module with the overlay UI and element hit-testing;
- a CLI artifact server;
- a narrow `review-overlay` command group that wires the two together.

#### `expo-ios review-next`

Suggest the next evidence step for review-and-fix work.

Usage:

```bash
expo-ios --json review-next \
  --surface calendar \
  --stage pre-patch \
  --issue "drag creates scroll conflict"
```

Behavior:

- Reads only supplied flags.
- Emits constraint classification, required flows, stop conditions, and
  suggested commands.
- Does not inspect source or run model calls.
- Must remain deterministic and testable.

## Config

Core commands do not require a config file. Command-line flags and project
metadata should be enough for normal usage.

Optional future config discovery:

1. `--config <path>`
2. `<project-root>/expo-ios.config.json`
3. `<project-root>/.scratch/expo-ios/config.json`

Initial optional config:

```json
{
  "schemaVersion": 1,
  "defaultPlatform": "ios",
  "metroPort": 8081,
  "artifactDir": ".scratch/expo-ios",
  "redaction": {
    "queryKeys": ["token", "auth", "cookie", "session", "secret"],
    "headerKeys": ["authorization", "cookie", "x-api-key"]
  },
  "commands": {
    "verifyNativeExperience": null,
    "typecheck": null,
    "lint": null,
    "test": null
  }
}
```

Environment:

- `EXPO_IOS_ROOT`: default project root.
- `EXPO_IOS_STATE_DIR`: default run-record directory.
- `EXPO_IOS_METRO_PORT`: default Metro port.
- `NO_COLOR`: disables color output.

Secrets:

- The CLI must not require secrets.
- Secret-looking values in URLs, headers, args, stdout, stderr, and run records
  must be redacted.
- `doctor` reports auth as not required unless a future command family
  explicitly introduces authenticated behavior.

## State and Artifacts

Default project-local artifact layout:

```text
.scratch/
  expo-ios/
    runs/
      <run-id>.json
    screenshots/
      <run-id>-before.png
      <run-id>-after.png
    ux-context/
      <run-id>.json
      <run-id>.png
    annotations/
      <run-id>/
        annotate.html
        annotations.json
        context.json
        screenshot.png
    review-overlay/
      events.json
      server.log
```

Run records are append-only session evidence. They are not a database.

Recommended `.gitignore` entry:

```gitignore
.scratch/expo-ios/runs/
.scratch/expo-ios/screenshots/
.scratch/expo-ios/ux-context/
.scratch/expo-ios/annotations/
.scratch/expo-ios/review-overlay/
```

## Record IDs

- `runId`: UTC timestamp plus short random suffix.
- `artifactId`: `runId` plus command-specific suffix.
- `deviceId`: platform-native UDID or serial.
- `targetId`: Metro/Hermes target ID when available.

IDs must be short enough to use in filenames and stable enough to correlate
records within one session. They do not need cross-machine stability.

## Schemas

### `RunRecord`

```ts
type RunRecord = {
  schemaVersion: 1;
  runId: string;
  command: string;
  args: Record<string, unknown>;
  globals: {
    json: boolean;
    plain: boolean;
    quiet: boolean;
    debug: boolean;
    root: string | null;
    stateDir: string | null;
  };
  cwd: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "failed";
  exitCode: 0 | 1 | 2 | null;
  payload: unknown | null;
  error: RunError | null;
};
```

### `RunError`

```ts
type RunError = {
  type: "usage" | "runtime" | "tool-missing" | "unavailable" | "unexpected";
  message: string;
  hint?: string;
  command?: string;
  debug?: unknown;
};
```

### `DoctorResult`

```ts
type DoctorResult = {
  cli: { name: "expo-ios"; version: string };
  cwd: string;
  auth: { required: false; source: "not-required" };
  commands: Record<string, string | null>;
  capabilities: {
    iosSimulator: boolean;
    androidDevice: boolean;
    screenshots: boolean;
    taps: boolean;
    gestures: boolean;
    accessibilityHierarchy: boolean;
    metroRuntime: boolean;
  };
  project: ProjectInfoResult | null;
};
```

### `ProjectInfoResult`

```ts
type ProjectInfoResult = {
  projectRoot: string;
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "unknown";
  expoDependency: string | null;
  reactNativeDependency: string | null;
  expoRouterDependency: string | null;
  scripts: Record<string, string>;
  appConfig: {
    source: string;
    name: string | null;
    slug: string | null;
    scheme: string | null;
    iosBundleIdentifier: string | null;
    androidPackage: string | null;
    userInterfaceStyle: string | null;
    dynamic?: boolean;
  } | null;
};
```

### `UxContextResult`

```ts
type UxContextResult = {
  runId?: string;
  cwd: string;
  device: DeviceSummary | null;
  screenshot: {
    path: string | null;
    width: number | null;
    height: number | null;
    analysis: unknown | null;
  };
  routeContext: {
    routes: RouteRecord[];
    currentRouteHint: string | null;
  } | null;
  accessibility: {
    available: boolean;
    hierarchy: unknown | null;
    error?: string;
  };
  runtime: {
    available: boolean;
    metro: MetroSummary | null;
    hermes: HermesSummary | null;
    componentHierarchy: unknown | null;
    error?: string;
  };
  logs: {
    included: boolean;
    excerpt: string | null;
    artifactPath: string | null;
  };
};
```

### `SessionRecord`

```ts
type SessionRecord = {
  schemaVersion: 1;
  sessionId: string;
  name: string;
  artifactDir: string;
  createdAt: string;
  updatedAt: string;
  activeTargetId: string | null;
  lastSnapshotId: string | null;
  sidecars: Array<{
    name: string;
    pid: number | null;
    port: number | null;
    status: "running" | "stale" | "stopped" | "unknown";
  }>;
};
```

### `TargetRecord`

```ts
type TargetRecord = {
  targetId: string;
  platform: "ios" | "android";
  device: {
    id: string;
    name: string | null;
    state: "booted" | "shutdown" | "connected" | "unknown";
  };
  app: {
    bundleId: string | null;
    processName: string | null;
    running: boolean | null;
  };
  metro: {
    port: number | null;
    status: "available" | "unavailable" | "unknown";
    targetId: string | null;
    title: string | null;
    appId: string | null;
    debuggerUrl: string | null;
  };
  selected: boolean;
  stale: boolean;
};
```

### `SnapshotResult`

```ts
type SnapshotResult = {
  snapshotId: string;
  targetId: string;
  routeHint: string | null;
  source: Array<
    "native-accessibility" |
    "react-devtools-hook" |
    "hermes-fiber" |
    "app-instrumentation"
  >;
  generatedAt: string;
  filters: {
    interactiveOnly: boolean;
    compact: boolean;
    depth: number | null;
    includeSource: boolean;
    includeBounds: boolean;
  };
  refs: RefRecord[];
  tree: SnapshotNode[];
  artifacts: {
    json: string;
    screenshot: string | null;
    annotatedScreenshot: string | null;
  };
  limitations: string[];
};
```

### `RefRecord`

```ts
type RefRecord = {
  ref: `@e${number}`;
  snapshotId: string;
  targetId: string;
  stale: boolean;
  role: string | null;
  label: string | null;
  text: string | null;
  placeholder: string | null;
  testID: string | null;
  nativeID: string | null;
  component: string | null;
  source: {
    file: string | null;
    line: number | null;
    column: number | null;
  } | null;
  box: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  actions: Array<
    "tap" |
    "long-press" |
    "fill" |
    "focus" |
    "press" |
    "scroll" |
    "inspect"
  >;
};
```

### `DevToolsCapability`

```ts
type DevToolsCapability = {
  name: string;
  source:
    | "metro"
    | "hermes"
    | "react-devtools-hook"
    | "react-native-devtools"
    | "app-instrumentation"
    | "simulator"
    | "native-profiler";
  available: boolean;
  readCommands: string[];
  writeCommands: string[];
  artifactTypes: string[];
  limitations: string[];
};
```

### `PerformanceResult`

```ts
type PerformanceResult = {
  metric: string;
  value: number;
  unit: "ms" | "bytes" | "count" | "fps" | "percent";
  source:
    | "expo-atlas"
    | "metro"
    | "hermes"
    | "react-devtools-hook"
    | "app-performance-mark"
    | "simulator"
    | "xctrace"
    | "memgraph";
  confidence: "high" | "medium" | "low";
  context: {
    build: "expo-go" | "dev-build" | "preview" | "release-export" | "unknown";
    platform: "ios" | "android";
    device: string | null;
    metroDevMode: boolean | null;
    coldStart: boolean | null;
    samples: number;
  };
  artifacts: string[];
  limitations: string[];
};
```

## Architecture

The implementation should move away from a single monolithic bundle and toward
small adapters with explicit contracts. The TypeScript scaffold under `src/` is
interface-only: it must not contain command behavior, shell execution,
Metro/Hermes probing, or generated app code implementation until Milestone 0
freezes current behavior with tests.

Current interface scaffold layout:

```text
src/
  cli/
    interfaces.ts
  commands/
    interfaces.ts
    pipeline.ts
  adapters/
    domains.ts
    interfaces.ts
    native-profilers.ts
    review.ts
  contracts/
    args.ts
    commands.ts
    config.ts
    policy.ts
    primitives.ts
    records.ts
    results.ts
    services.ts
    shared.ts
  generated/
    app-instrumentation/
```

The current scaffold is the contractual skeleton. The target implementation
layout is the destination once each vertical slice has failing tests and an
implementation path. Keep both in the spec: the scaffold says what exists now;
the target layout says where production command behavior belongs. Existing
public commands are compatibility surfaces and must not disappear; broader
command-family modules can share internals with them, but they do not replace
the current command names.

Target implementation layout:

```text
src/
  cli/
    main.ts
    args.ts
    output.ts
    errors.ts
    run-records.ts
    runtime.ts
  commands/
    doctor.ts
    project-info.ts
    routes.ts
    devices.ts
    simulator.ts
    screenshot.ts
    gesture.ts
    logs.ts
    ux-context.ts
    inspector.ts
    trace.ts
    annotations.ts
    review-overlay.ts
    review-next.ts
    discovery.ts
    session.ts
    target.ts
    navigation.ts
    actions.ts
    waits.ts
    snapshots.ts
    devtools.ts
    performance.ts
    review.ts
    domains.ts
    policy.ts
    skills.ts
  adapters/
    command-runner.ts
    expo-config.ts
    metro.ts
    hermes.ts
    ios-simctl.ts
    idb.ts
    adb.ts
    accessibility.ts
    image-analysis.ts
    local-server.ts
    domains/
      navigation.ts
      network.ts
      storage.ts
      controls.ts
      state.ts
    review/
      inspector.ts
      trace.ts
      annotations.ts
      overlay.ts
    performance/
      bundle.ts
      startup.ts
      actions.ts
      native-profilers.ts
  contracts/
    args.ts
    commands.ts
    config.ts
    policy.ts
    primitives.ts
    records.ts
    results.ts
    schemas.ts
    services.ts
    redaction.ts
  generated/
    app-instrumentation/
      contracts.ts
      bridge.ts
    review-overlay/
```

Adapter rules:

- Adapters return data or typed unavailable results.
- Command handlers compose adapters and own CLI-facing payload shape.
- Runtime probe snippets are assets with names and version comments, not inline
  anonymous template strings inside command handlers.
- Local HTTP servers write logs and PID metadata so stale servers are visible.
- All shell execution flows through one command runner with timeout, cwd, env,
  redaction, and output truncation policy.

### Design Pattern Responsibilities

Use patterns only where they protect implementation boundaries. Do not add
classes or indirection just to name a pattern.

| Pattern | Boundary | Implementation value |
| --- | --- | --- |
| Command | `CommandDefinition`, `CommandHandler`, `CommandModule` | one public command behavior per handler |
| Facade | `CommandFacade`, `CliRuntime` | simple entrypoint over parsing, dispatch, output, sessions, policy, and records |
| Adapter | `adapters/*` | isolate Metro, Hermes, simulator, domains, native profilers, and generated app bridge details |
| Bridge | `generated/app-instrumentation/contracts.ts` | split CLI contracts from dev-only in-app implementation |
| Chain of Responsibility | `CommandPipeline`, middleware names | compose schema validation, policy, sessions, run records, redaction, output bounds, artifacts, and error envelopes |
| Strategy | adapter interfaces per probe/action/measurement | swap implementation source without changing command contracts |
| Memento | `RunRecord`, `SessionRecord`, `SnapshotResult`, `RefRecord` | persist state snapshots and evidence for restore, diff, stale checks, and audit trails |
| Observer | `EventStream`, DevTools event methods | collect streaming console, errors, network, performance, and custom app events |
| Proxy | `PolicyService`, `PolicyEngine` | gate risky actions before the real adapter executes |
| Composite | `SnapshotNode` tree | traverse React Native and native accessibility trees uniformly |

### Dependency Direction

```text
cli -> commands -> contracts
commands -> adapters -> contracts
commands -> command pipeline -> services -> contracts
generated/app-instrumentation -> contracts
```

Contracts must not import commands, adapters, CLI modules, or generated app
code. Adapters must not write CLI output directly. Commands own result shape;
adapters own external-system details.

### Boundary Rules

- `contracts/args.ts` owns command argument shapes so parsers, tests, and
  command handlers do not invent incompatible local objects.
- `contracts/services.ts` owns cross-cutting services: schema validation,
  redaction, artifacts, run records, snapshots, sessions, policy, and output
  boundaries.
- `adapters/domains.ts` owns Milestone 2 DevTools domain surfaces: navigation,
  network, storage, controls, accessibility, dialogs, recording, diff,
  dashboard, and skills.
- `adapters/review.ts` owns current review surfaces that must survive the
  Milestone 0 freeze: inspector comments, interaction traces, annotation
  boards, review overlay, and deterministic `review-next` guidance.
- `adapters/native-profilers.ts` owns Milestone 3 native evidence boundaries
  for ETTrace, memgraph, and process memory.
- `commands/pipeline.ts` owns middleware composition. New commands should not
  directly perform policy checks, run-record writes, or redaction unless they
  implement the corresponding middleware.
- `generated/app-instrumentation/contracts.ts` owns the dev-only app bridge
  contract. It is not implementation code and must stay production-safe by
  design.
- Generated app bridge implementation must be opt-in and removable. No command
  may assume it exists unless the command also returns a typed unavailable
  result when the manifest or requested domain is missing.
- New implementation should fill adapter modules behind these interfaces and
  keep existing `cli/expo-ios.mjs` command behavior stable until Milestone 0
  tests prove the current contract is frozen.

### Scaffold Coverage Contract

The scaffold is TDD-ready only when `SPEC.md` maps to explicit TypeScript
interfaces or documented boundaries.

| SPEC area | Required boundary |
| --- | --- |
| Global CLI contract | `contracts/commands.ts`, `cli/interfaces.ts` |
| Current Milestone 0 commands | `contracts/args.ts`, `adapters/interfaces.ts`, `adapters/review.ts` |
| Milestone 1 browser-parity core | `contracts/args.ts`, `contracts/records.ts`, `adapters/interfaces.ts`, `commands/pipeline.ts` |
| Milestone 2 DevTools domains | `adapters/domains.ts`, `generated/app-instrumentation/contracts.ts` |
| Milestone 3 native/performance evidence | `adapters/native-profilers.ts`, `adapters/interfaces.ts`, `contracts/results.ts` |
| Setup and maintenance | `SetupAdapter`, `InstallArgs`, `UpgradeArgs` |
| Sessions and targets | `SessionRecord`, `TargetRecord`, session services, device adapters |
| Semantic refs and snapshots | `SnapshotResult`, `RefRecord`, `SnapshotAdapter`, `SnapshotStore` |
| Actions, waits, and batch | command args, `GestureAdapter`, `CommandPipeline` |
| DevTools capabilities/events | `DevToolsCapability`, `DevToolsAdapter`, `EventStream` |
| Network/storage/navigation/controls/state | domain adapters plus generated app bridge contracts |
| Accessibility/dialogs/sheets | domain adapters plus command args |
| Review artifacts | inspector, trace, annotation, review overlay, review guidance, and review report adapters |
| Config and environment | `contracts/config.ts`, `ConfigService` |
| Safety and policy | `contracts/policy.ts`, `PolicyService`, command pipeline |
| Artifacts and records | artifact, run-record, session, snapshot services |
| Generated app instrumentation | app bridge and domain instrumentation contracts |

### Command Family Coverage Contract

Every public command family must have a named interface boundary before
implementation starts. This table prevents existing commands from disappearing
while newer browser-parity and DevTools surfaces are added.

| Family | Interface boundary |
| --- | --- |
| `install`, `upgrade` | `SetupAdapter`, `InstallArgs`, `UpgradeArgs` |
| `doctor`, `project-info`, `routes`, `devices` | `ProjectAdapter`, `DeviceAdapter`, current args |
| `boot-simulator`, `open-url`, `open-route`, `launch-app` | `DeviceAdapter`, current args |
| `terminate-app`, `reload-app`, `open-dev-menu`, `install-app`, `uninstall-app` | `DeviceAdapter`, `AppLifecycleArgs` |
| `screenshot`, `tap`, `gesture`, ref actions, aliases | `DeviceAdapter`, `GestureAdapter`, action args |
| `logs`, `ux-context`, `console`, `errors` | `RuntimeEvidenceAdapter` |
| `inspector`, `trace`, `annotate-screen`, `review-overlay`, `review-next`, `review` | inspector, trace, annotation, overlay, guidance, and report adapters |
| `session`, `target` | `SessionStore`, `SessionStoreAdapter`, `DeviceAdapter`, `TargetRecord` |
| `snapshot`, `refs`, `get`, `find` | `SnapshotAdapter`, `SnapshotStore`, ref and snapshot records |
| `wait`, `batch` | command args plus `CommandPipeline` |
| `devtools`, `metro` | `DevToolsAdapter`, `MetroAdapter` |
| `perf`, `profiler` | `PerformanceAdapter`, `NativeProfilerAdapter` |
| `skills` | `SkillsAdapter` |
| `clipboard`, `set` | `ClipboardAdapter`, `EnvironmentAdapter` |
| `network`, `navigation`, `storage`, `state`, `controls` | domain adapters and generated app bridge contracts |
| `rn`, `expo` | `SnapshotAdapter`, `ExpoIntrospectionAdapter`, generated app bridge contracts |
| `diff`, `record`, `accessibility`, `dialog`, `sheet`, `dashboard` | domain adapters |
| `instrumentation` | `InstrumentationAdapter`, generated app bridge contracts |
| `policy` | `PolicyService`, `PolicyEngine`, `PolicyArgs` |

### TDD Readiness Contract

Tests should verify behavior through public interfaces, not internal helper
shape. Public test entrypoints are:

- current CLI behavior through `cli/expo-ios.mjs` until TypeScript runtime
  replacement;
- future command behavior through `CommandFacade.dispatch(...)`;
- command modules through `CommandDefinition` and `CommandHandler.run(...)`;
- adapters only when the adapter is itself the public module under test;
- generated app bridge behavior through `AppInstrumentationBridge.callTool(...)`
  and domain instrumentation interfaces.

TDD start criteria:

- strict scaffold typecheck passes;
- ASCII and trailing-whitespace checks pass for `src/`;
- first implementation slice is a vertical behavior slice, not a horizontal
  layer rewrite;
- the slice uses a public command, facade, or adapter interface;
- no implementation bypasses the command pipeline for policy, redaction, output
  bounds, artifacts, or run records.

The first implementation milestone must freeze current behavior before any
refactor. Start with these vertical slices:

1. `doctor --json` returns the stable success envelope without auth.
2. `routes --json` maps an Expo Router fixture to route records.
3. `gesture --dry-run` returns a platform command plan without simulator tools.
4. `trace --action read --metro-port 9` returns unavailable JSON.
5. `inspector probe --metro-port 9` returns unavailable JSON.
6. `--state-dir` persists a redacted run record.
7. stale MCP-first session usage remains rejected by session-contract tests.

The architecture tracer bullet should prove one command can run through parser,
facade, pipeline, services, adapters, redaction, output, and run records:

```text
expo-ios --json session new review
```

Required observable behavior:

- returns `{ ok: true, data: SessionRecord }`;
- creates a session artifact directory;
- writes a redacted run record when recording is enabled;
- uses the command pipeline rather than command-local policy or redaction logic.

After the contract freeze and tracer bullet, add browser-parity slices one at a
time:

1. `target list` returns a deterministic target fixture through `DeviceAdapter`.
2. `snapshot --interactive` writes a `SnapshotResult` and ref cache.
3. `get source @e1` reads the cached ref through public ref lookup.
4. `find role button --name Add` returns matching refs.
5. `tap @e1 --dry-run` plans a ref action without executing device tooling.
6. `wait --text Customers` polls snapshot/runtime evidence until matched.
7. `screenshot --annotate` produces an artifact with labels mapped to refs.
8. `devtools capabilities` reports structured capabilities and limitations.
9. `perf summary` reports available metrics with confidence levels.

Fixture boundaries:

- Expo Router fixture for routes and deep links.
- Device fixture for iOS simulator and Android device parsing.
- Metro target fixture for available and unavailable runtime states.
- Snapshot fixture for refs, finders, and annotated screenshots.
- DevTools fixture for capabilities and event streams.
- Performance fixture for startup/action/bundle reports.
- Policy fixture for runtime eval denied, storage clear denied, and allowed
  read-only commands.

Test design rules:

- Test behavior through command output, artifacts, and public records.
- Prefer fixture adapters over mocks of internal functions.
- Keep command tests resilient to adapter implementation changes.
- Assert redaction at output and run-record boundaries.
- Treat unavailable optional sources as first-class behavior, not exceptions.
- Never test private helper names or internal filesystem layout beyond
  documented artifact paths.
- Refactor only after the relevant slice is green.

Red-green-refactor guardrails:

- RED: add exactly one behavior test.
- GREEN: implement the smallest command, service, or adapter path.
- REFACTOR: move duplication behind commands, services, adapters, or generated
  bridge contracts only after tests pass.

The goal is not to implement every interface at once. The goal is to make each
implemented vertical slice land behind the correct boundary without redesigning
the architecture.

## Runtime Probe Policy

Without Rozenite, runtime probing is allowed through Metro and Hermes inspector,
but it must be constrained.

Rules:

- Prefer read-only `Runtime.evaluate` probes.
- Keep probe output bounded.
- Return `available: false` when no target exists.
- Record target metadata: title, app ID, device name, and description.
- Restore globals patched by tracing.
- Avoid relying on private React Native internals unless the result clearly says
  which private hook was used and what fallback exists.
- Do not infer product semantics from component names alone.

Probe classes:

- `metro-status`: status, version, targets.
- `runtime-globals`: dev mode, Hermes, Fabric, selected globals.
- `component-summary`: bounded React tree and selected props.
- `inspector-control`: RN inspector availability and comment menu support.
- `interaction-trace`: React commit/layout/animation-frame evidence.

## Review Workflow Contract

The CLI does not decide whether a UI is good. It collects evidence and helps
the agent run a disciplined review.

Expected review-and-fix sequence:

1. Run `doctor`.
2. Identify project and route with `project-info` and `routes`.
3. Capture baseline evidence with `screenshot` or `ux-context`.
4. Use `review-next` only when the next evidence step is unclear.
5. Write an acceptance contract outside the CLI.
6. Patch app code outside the CLI.
7. Run typecheck/lint/tests outside the CLI.
8. Capture after evidence with `screenshot`, `ux-context`, and any relevant
   `gesture` or `trace`.
9. Compare evidence in the final handoff.

The CLI may suggest commands, but it must not claim the requested fix is done.

## Git Safety

The CLI must not perform git mutations.

Allowed:

- Read git root or branch information for context if a future command needs it.
- Record dirty-state metadata in run records.

Forbidden:

- `git reset`, `git checkout`, `git clean`, branch switching, commits, pushes,
  PR creation, or stash operations.

## Output Examples

Doctor plain output:

```text
ok: true
command: doctor
cli: expo-ios 0.1.0
auth: not-required
ios-simulator: true
android-device: false
```

Unavailable runtime probe:

```json
{
  "ok": true,
  "data": {
    "available": false,
    "action": "read",
    "reason": "No Metro inspector target.",
    "metroPort": 8081
  }
}
```

Gesture dry run:

```json
{
  "ok": true,
  "data": {
    "dryRun": true,
    "gesture": "drag",
    "coordinates": {
      "startX": 180,
      "startY": 900,
      "endX": 180,
      "endY": 1200
    },
    "plan": {
      "platform": "ios",
      "command": ["idb", "ui", "swipe", "180", "900", "180", "1200"]
    }
  }
}
```

## Testing Requirements

Unit tests:

- global flag parsing and mutual exclusions;
- `--json` success and error envelopes;
- `--plain` stable lines;
- redaction in run records;
- project-info from static fixtures;
- route mapping for Expo Router dynamic segments;
- device parser fixtures for `xcrun` and `adb`;
- missing-tool behavior for `idb`, `axe`, and `adb`;
- unavailable Metro target contract;
- inspector unavailable contract;
- trace unavailable contract;
- gesture dry-run command planning;
- screenshot artifact path handling;
- annotation artifact creation;
- review-next deterministic outputs.

Session-contract tests:

- reject stale MCP-first usage;
- accept direct `expo-ios --json` evidence gathering;
- require local-dev evidence before design claims for plugin-guided sessions.

Fixture projects:

- minimal Expo Router app;
- app with dynamic `app.config.ts`;
- app with custom scheme and nested routes;
- review-overlay scaffold target.

Snapshot tests:

- help output;
- plain doctor output;
- JSON schema examples;
- review-next command suggestions.

## Refactor Plan

1. Freeze current command behavior with tests.
2. Extract argument parsing, output, errors, redaction, and run records.
3. Extract command runner and platform adapters.
4. Extract Expo project and route discovery.
5. Extract Metro/Hermes runtime adapters.
6. Move runtime probe source strings into named assets.
7. Split review overlay scaffold/server/read into separate modules.
8. Add schema validation at command boundaries.
9. Keep `cli/expo-ios.mjs` as a thin executable wrapper.
10. Keep the installed command and JSON contract unchanged throughout.

## Release Criteria for the Next CLI Cleanup

- `make install-local` installs `expo-ios`.
- `expo-ios --version` works from outside the repo.
- `expo-ios --help` lists every implemented command family.
- `expo-ios --json doctor` passes without an Expo project.
- `expo-ios --json routes` passes against the minimal fixture.
- `expo-ios --json gesture ... --dry-run true` requires no simulator tooling.
- `expo-ios --json trace --action read --metro-port 9` returns unavailable JSON.
- Run records redact sensitive URL/query values.
- Session-contract tests confirm direct CLI use.
- README and skill docs point to this spec as the command contract.

Full coverage release criteria should be milestone-specific. A milestone should
ship only after its new command family has JSON contracts, `--plain` output
where useful, redaction, fixture tests, unavailable-state tests, and at least
one documented agent workflow.

## Architecture Decisions

- Keep the next cleanup in JavaScript until command behavior is frozen and
  adapters are extracted. Move to TypeScript only after the command runner,
  contracts, and schemas are isolated enough for a mechanical migration.
- Keep `ux-context` as an aggregator, but expose its sub-probes through internal
  adapters and future public commands where the output is useful on its own:
  `snapshot`, `accessibility tree`, `metro status`, `console`, `errors`,
  `network`, and `perf summary`.
- Keep the review overlay as generated dev-only app code for Milestone 1.
  Revisit packaging as a small reusable module after the snapshot/ref bridge and
  app instrumentation contracts stabilize.
- Keep Android as best-effort inside `expo-ios` only where current commands
  already support Android-style device actions. Do not split `expo-android`
  until there is enough Android-specific coverage to justify a separate CLI.
- Keep native-experience validation scripts in skills for now. The CLI may wrap
  configured validation commands later, but it should not own broad design
  judgment or subjective UI approval.
