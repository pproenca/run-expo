---
summary: "Plan and audit checklist for turning the scaffold-complete Effect-TS TypeScript workspace into a publishable, live-wired expo98 CLI."
read_when:
  - Refactoring the command registry, live evidence seams, package shape, or persistence service
  - Auditing whether the TypeScript rebuild is still scaffold-complete rather than publish-ready
  - Preparing a productionization PR that touches Effect Layers, command ownership, live tests, or package output
title: "TypeScript productionization refactor"
sidebarTitle: "TypeScript productionization"
---

# TypeScript productionization refactor

The Effect-TS rebuild is green and structurally safer than the legacy CLI. The
remaining problem is ownership: too much production behavior is inferred from
temporary composition glue, placeholder live seams, and docs that disagree about
the package shape.

Treat this as a productionization refactor, not a rewrite. Keep the security
spine. Move command metadata to the packages that own commands, wire live
evidence through explicit Effect services, align package contracts, and replace
skipped live paths with concrete fake-backed or live UAT proof.

## Goal

Make the current TypeScript workspace publishable and maintainable while
preserving the existing safety model:

- every command still reaches `@expo98/core` dispatch
- state-changing commands still require the typed policy gate
- read-only evidence may use read-only protocol seams, not dangerous capability
  tags
- secret redaction still happens at the output/persistence boundary
- package boundaries remain acyclic and CI-enforced
- live Metro, Hermes, simulator, bridge, snapshot, perf, and overlay paths have
  explicit services and tests instead of stubs or skipped-only coverage
- docs, build scripts, bins, and package metadata describe one real package
  shape

## Non-goals

- Do not weaken `CapabilityFor<S>` or let handlers import device/runtime/source
  capabilities directly.
- Do not collapse handler packages into `app` just to simplify imports.
- Do not move protocol loopback, Origin, or bounded-open rules out of
  `@expo98/protocols`.
- Do not make a generic command framework unless it deletes current
  `all-commands.ts` glue in the same change.
- Do not change CLI command names, JSON payload fields, or exit-code contracts in
  the same patch as ownership refactors.
- Do not delete live-path skipped tests until the replacement proof exists.
- Do not publish, version, or change release metadata without explicit approval.

## Current branch state

Done:

- Added an Effect-TS workspace with 11 `@expo98/*` packages and strict
  per-package `tsconfig.json` files.
- Root README describes the workspace package map and says the publishable CLI is
  `packages/app`.
- `@expo98/core` owns the side-effect classifier, fail-closed policy gate,
  capability-injection dispatcher, redactor, path confinement, subprocess
  taxonomy, ids, and truncation.
- `@expo98/domain` owns Effect Schema entities, lenient-read/strict-write
  migration, the injected `Fs` port, persistence, session naming, and snapshot
  pointer invariants.
- `@expo98/protocols` owns loopback Metro probing, Hermes CDP, Origin headers,
  bounded open, CDP socket abstraction, and network evidence validation.
- Handler packages expose typed command builders for devtools, interaction,
  snapshot, net/perf, artifacts, Expo integration, and overlay behavior.
- `@expo98/app` registers the full command surface through
  `packages/app/src/all-commands.ts` and runs everything through core dispatch.
- The package DAG guard in `packages/app/test/dependency-dag.test.ts` blocks
  handler-to-handler dependencies and keeps `core` dependency-free.
- The current local validation is green:

```text
pnpm run check
format: passed
lint: passed
typecheck: passed
tests: 56 files passed, 3 skipped; 520 passed, 29 skipped
```

Scanned TypeScript surface:

```text
156 TypeScript files
21,429 TypeScript lines
11 packages
packages/*/src and packages/*/test scanned
```

Package scan ledger:

```text
app                    files=16 src=9  test=7
core                   files=20 src=10 test=10
domain                 files=17 src=11 test=6
expo-integration       files=17 src=11 test=6
handlers-artifacts     files=14 src=9  test=5
handlers-devtools      files=11 src=6  test=5
handlers-interaction   files=15 src=8  test=7
handlers-net-perf      files=14 src=10 test=4
handlers-snapshot      files=9  src=5  test=4
overlay-server         files=10 src=7  test=3
protocols              files=13 src=8  test=5
```

Known temporary state:

- `packages/app/src/all-commands.ts` is 570 lines of central command ownership.
  It manually stores command paths, summaries, side-effect metadata, positional
  parsing, and placeholder live behavior.
- `packages/app/src/layers.ts` constructs the node Layer stack, but
  `RuntimeEvalCapabilityLayer` calls Hermes with `attemptedUrls: []`, and
  `MetroHttpClientLayer` always fails with `metro-http-not-wired`.
- `packages/protocols/src/cdp.ts` documents read-only Hermes evaluation as a
  fixed package-controlled expression seam, but the service currently accepts an
  arbitrary `expression: string`.
- Snapshot, accessibility, RN, network, perf, and review-overlay registrations
  in `all-commands.ts` intentionally return unavailable or empty read payloads.
- `packages/overlay-server/src/server.ts` documents port search through
  `findAvailablePort`, but `overlayServerLayer` binds `resolvePort(...)`
  directly and casts the resulting layer. Its adapter also reads `req.text`
  before the handler-level body cap can reject oversized bodies.
- `packages/domain/src/persist.ts` keeps session, target, snapshot/ref cache,
  invariant, and run-record implementations in one closure.
- Root `AGENTS.md` still describes a single-package CLI with `src/`,
  `cli/expo98.mjs`, `pnpm run build`, `SPEC.md`, and `docs/business-rules.md`,
  while the checked-in code is a private pnpm workspace with no root build/bin
  surface.
- `pnpm pack --dry-run --json` currently succeeds but would pack workspace
  internals broadly, and `npx --no-install expo98 --json doctor` cannot work
  until a real executable/bin surface exists.

## Known remaining refactor surfaces

### Command ownership

Core command safety is strong, but command ownership is centralized in app.
`all-commands.ts` imports every handler package, carries every verb list, and
contains comments saying argv mapping is pragmatic. That file is now the main
place command behavior can drift from owner packages.

Risk: a command can have one side-effect class in app metadata and a different
class in its built command.

Mitigation: move command specs to owner packages and test every spec with
`spec.sideEffect === spec.build(ctx).descriptor.sideEffect`.

### Live evidence seams

The live transport seams are documented, but not composed into useful runtime
evidence. Network and perf run over empty input. Snapshot and RN paths receive no
live graph/ref cache. Runtime eval cannot find debugger targets because app
passes no candidate URLs.

Risk: adding live wiring in one patch can accidentally bypass protocol security
or make read commands depend on mutation capabilities.

Mitigation: add one `EvidenceContext` service in app, backed first by tests and
then by protocols. Wire `network` first because its derivation package is pure
and already well tested.

Risk: the read-eval seam can become a general JavaScript execution escape hatch
if handlers pass arbitrary expressions into `HermesEvidence.evaluateReadOnly`.

Mitigation: introduce package-owned evidence methods or a typed expression
registry before any live read-eval wiring. Keep arbitrary JavaScript on the
runtime-eval capability path, behind policy and confirmation.

### Overlay server lifecycle

Request hardening is good: synthetic request parsing, token, loopback Origin,
body cap, schema validation, and event store are separate. The server launch
does not yet use the port-search contract it documents.

Risk: changing the server Layer shape can ripple through app wiring.

Mitigation: add a new effectful launch helper that resolves the bound port before
building the server layer. Keep the old wrapper until callers move.

Risk: the server adapter buffers request text before the hardened handler applies
its body cap.

Mitigation: enforce the cap at the adapter/read boundary as well as in the
synthetic request handler, then keep the existing schema/token/origin tests.

### Persistence implementation size

The public `Persistence` service is useful. The implementation is crowded:
encoding, JSON parse, sessions, targets, snapshots, invariants, refs, and run
records live in one file.

Risk: splitting persistence can break strict-write behavior or snapshot pointer
invariants.

Mitigation: preserve the public `Persistence` interface and `layer(clock)`.
Move internals by aggregate with no behavior changes, running the domain suite
after each move.

### Protocol cleanup

Protocol behavior is intentionally conservative. Metro probing is loopback-only
and CDP connects with bounded open plus Origin headers. The remaining cleanup is
smaller: repeated JSON parse blocks in Metro, one localized core dispatch type
bridge, and the too-wide read-eval expression surface.

Risk: deduplicating protocol helpers can subtly change malformed-body,
non-loopback, or timeout diagnostics.

Mitigation: pin current failure payloads first, then extract helpers only where
tests prove identical diagnostics.

### Package contract

The code and docs disagree about what is publishable. README says workspace and
`packages/app`. Root package metadata is private and has no `bin`. AGENTS says
single-package root with generated `cli/expo98.mjs`.

Risk: package edits can break `npx expo98`, dependency placement, and packed
contents.

Mitigation: choose the package shape before changing build output. Add pack
dry-run and executable smoke checks before changing metadata.

### Test proof

The acceptance suite is broad and green. The remaining live paths are still
tracked by skips across app, protocols, handlers, integration, and overlay
packages.

Risk: skipped tests become a permanent substitute for proof.

Mitigation: convert skips into either fake-backed seam contracts or documented
local live UAT commands with explicit prerequisites.

## Target shape

`@expo98/core` should own only generic safety:

- `SideEffect` classification
- policy evaluation and confirmation token handling
- capability tags and capability injection
- redaction, truncation, error and exit-code mapping
- path confinement, subprocess service, ids, and batch/stream primitives

`@expo98/protocols` should own only generic device protocols:

- loopback Metro HTTP client port and probe service
- Hermes CDP socket factory and `ws` adapter
- read-only evidence methods or typed fixed-expression registry
- runtime-eval surface used only after core gate approval
- network evidence validation

`@expo98/domain` should expose the same public persistence service, backed by
smaller aggregate-owned internals:

```text
persist/
  service.ts       public tag, facade, layer(clock)
  json.ts          encode/decode helpers
  session.ts       new/show/list/close/clean
  target.ts        save/current
  snapshot.ts      persist/show/ref cache + invariants
  run.ts           runStart/runFinish/runShow
```

Handler packages should own command specs as well as command builders:

```ts
export interface CommandSpec<S extends SideEffect> {
  readonly path: string
  readonly summary: string
  readonly sideEffect: S
  readonly build: (ctx: CommandContext) => Command<S, unknown>
}
```

`@expo98/app` should own only composition:

- global CLI parsing and usage guard
- command spec collection
- registry construction
- node-backed Layers
- evidence context resolution
- output envelopes
- package executable entry

The live read path should look like:

```text
CLI args
  -> CommandSpec.parse/build
  -> EvidenceContext resolves Metro targets / session / refs when needed
  -> handler command receives typed read evidence or gated capability
  -> core dispatch gates, runs, redacts, truncates
  -> app envelope writes json/plain/ndjson
```

## Migration steps

1. Freeze the current contracts.
   Keep `pnpm run check` green. Add or preserve registry-count tests, side-effect
   parity tests, package DAG tests, and skipped live-path inventory.

2. Move command specs out of `app`.
   Start with `handlers-devtools` because it already has explicit
   `traceSideEffect`, `inspectorSideEffect`, and `navigationSideEffect`
   functions. Then move `handlers-net-perf`, `handlers-interaction`,
   `handlers-snapshot`, `handlers-artifacts`, `expo-integration`, and
   `overlay-server`.

   Risk: app routing changes command behavior.
   Mitigation: migrate one package at a time and assert old path list equals new
   path list.

3. Add an app-owned `EvidenceContext` service.
   It should resolve Metro port, target rows, debugger URLs, state root, current
   session, active target, and ref cache without giving read handlers dangerous
   capabilities.

   Risk: live evidence can become a second dispatcher.
   Mitigation: keep it read-only and feed its outputs into existing command
   builders. Mutations still go through `DeviceCapability`,
   `RuntimeEvalCapability`, or `SourceWriteCapability`.

4. Tighten the read-eval protocol surface.
   Replace stringly `evaluateReadOnly(expression, options)` calls with
   package-owned methods or a typed expression registry before app supplies live
   Hermes candidates.

   Risk: making this too generic recreates runtime eval under a read command.
   Mitigation: permit only fixed expressions owned by packages, and keep
   arbitrary expressions on gated runtime-eval commands.

5. Wire `network` through live evidence first.
   Use protocols to get Metro targets and read-only CDP network payloads. Then
   feed `handlers-net-perf` pure normalization and waterfall/duplicates/HAR
   code.

   Risk: network capture can leak secrets or touch non-loopback URLs.
   Mitigation: use existing protocols loopback/CDP surfaces and core redaction.
   Add tests with secret-bearing payloads and non-loopback candidates.

6. Fix overlay server launch ownership.
   Make port search part of server launch, remove the `as unknown as` layer cast
   if the new function can carry the real type, cap request bodies before
   buffering, and wire the app command only after server lifecycle tests pass.

   Risk: live server tests can flake on busy local ports.
   Mitigation: keep most tests fake-probe based; reserve real socket proof for a
   narrowly tagged local UAT.

7. Split persistence internals.
   Keep `PersistenceService`, `makePersistence`, and `layer(clock)` as public
   API. Move one aggregate at a time behind the facade.

   Risk: strict-write and invariant behavior can drift.
   Mitigation: run `packages/domain/test` after each move and add a facade test
   that touches session, target, snapshot/ref cache, invariant, and run-record
   methods through the public service.

8. Align package shape.
   Decide whether the publishable unit is the root package or `packages/app`.
   Then align README, AGENTS, package metadata, build scripts, generated bundle
   location, `files`, and smoke commands.

   Risk: a half-migration leaves users unable to run `npx expo98`.
   Mitigation: make `pnpm pack --dry-run --json` and
   `npx --no-install expo98 --json doctor` part of the package PR.

9. Replace skipped live tests with explicit proof.
   For each skip, either add fake-backed seam coverage or document a runnable
   live command with prerequisites. Do not remove the skip inventory until the
   replacement is in place.

## Audit checklist

Before calling this refactor complete:

- `rg "as unknown as" packages --glob '*.ts'` returns only reviewed,
  documented casts, ideally not in overlay server launch.
- `rg "evaluateReadOnly" packages --glob '*.ts'` shows fixed
  package-controlled expressions or typed evidence methods, not arbitrary
  handler-supplied JavaScript.
- `rg "attemptedUrls: \\[\\]" packages/app/src/layers.ts` is gone or appears only
  in a test/default fallback that cannot be reached by live commands.
- `rg "metro-http-not-wired" packages/app/src/layers.ts` is gone from the live app
  layer.
- `rg "req\\.text" packages/overlay-server/src/server.ts` shows request body
  bytes are capped before buffering can grow beyond the configured limit.
- `rg "Live capture seam not wired|graph: null|normalizeRequests\\(\\[\\]\\)|reportFindings\\(\\{\\}\\)" packages/app/src`
  returns no production command registrations.
- `rg "path: .*summary: .*sideEffect:" packages/app/src/all-commands.ts` no
  longer shows owner-specific command metadata after spec migration.
- `rg "review-overlay.*server|networkListener: false" packages/app/src` does not
  hide the overlay server action behind a read stub.
- `rg "findAvailablePort" packages/overlay-server/src packages/overlay-server/test`
  shows the launch path using the port-search result.
- `rg "class PersistenceService|makePersistence|layer = \\(clock" packages/domain/src`
  shows the public facade still exported after persistence internals split.
- `rg "it\\.skip" packages` is limited to documented live UAT, with a matching
  fake-backed contract or local verification command.
- `rg "src/bundled-cli|cli/expo98\\.mjs|SPEC\\.md|docs/business-rules\\.md" AGENTS.md README.md package.json packages`
  no longer reports stale package-shape instructions unless those files exist
  and are authoritative again.
- `pnpm run check` passes.
- Package-shape PRs also pass `pnpm pack --dry-run --json`.
- Runtime behavior PRs also pass an executable smoke:

```sh
npx --no-install expo98 --json doctor
```

## Verification commands

Use broad local checks after report or docs-only edits:

```sh
git diff --check
pnpm run check
```

Use focused checks while moving command specs:

```sh
pnpm exec vitest run packages/app/test/integration.test.ts packages/app/test/commands.test.ts
pnpm exec vitest run packages/handlers-devtools/test
pnpm exec vitest run packages/handlers-net-perf/test
```

Use focused checks while wiring live evidence:

```sh
pnpm exec vitest run packages/protocols/test packages/handlers-net-perf/test packages/app/test
pnpm exec vitest run packages/handlers-snapshot/test packages/expo-integration/test
```

Use focused checks while changing overlay server lifecycle:

```sh
pnpm exec vitest run packages/overlay-server/test
```

Use focused checks while splitting persistence:

```sh
pnpm exec vitest run packages/domain/test
```

Use publish-oriented checks only after package metadata or build/bin files
change:

```sh
pnpm pack --dry-run --json
npx --no-install expo98 --json doctor
```

Run `pnpm run check` before handoff for every non-docs refactor wave.
