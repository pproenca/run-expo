# @expo98/domain

The **domain model + persistence** package of the Effect-TS rebuild of `expo98`.
It owns service **S7 Persistence** (`REIMAGINED_ARCHITECTURE.md` §3) and the full
Effect `Schema` domain model: the four aggregates (Session · RunRecord ·
BridgeMetadata · OverlayEventsFile) plus every embedded value object, with a
**lenient-read / strict-write** migration shim so legacy artifacts stay readable.

DAG position (CI-enforced, §3): `domain → core`; `core → nothing`. This package
imports **nothing platform-specific** (no `@effect/platform-node`); the
filesystem is an injected port (`Fs`).

## Layout

```
src/
  ids.ts            Branded ids (SessionId/TargetId/SnapshotId/RunId/RefId) + canonical Timestamp (AC-034)
  value-objects.ts  ScreenBox, DeviceSummary, SidecarRecord, SnapshotFilters, RefRecord,
                    SnapshotNode, SemanticBridgeSnapshot (typed, was `unknown`), RunPayloadSummary
  entities.ts       SessionRecord, TargetRecord, SnapshotResult, RefCache, RunRecord
                    (+ Running/Finished), BridgeMetadata, OverlayEventsFile  — STRICT canonical structs
  errors.ts         Tagged persistence errors (NotFound, CorruptRecord, StorageFailure,
                    InvariantViolation, EmptySessionName, InvalidDuration)
  fs-port.ts        `Fs` port (hexagonal seam) + in-memory impl + Layer for tests
  paths.ts          On-disk layout (preserved verbatim from legacy; §5 step 1)
  naming.ts         AC-043 name/duration + AC-034 id calculation + AC-018 targetId composition
  migration.ts      Lenient-read shim (§5 step 2): accepts the 3 divergent legacy shapes,
                    `sidecars: unknown[]`, `semanticBridge: unknown` → normalises to strict
  decisions.ts      Pure read-side rules: AC-017 ref validity, AC-018 staleness,
                    AC-019 snapshot prereqs, AC-026 renumberRefs
  persist.ts        S7 Persistence service (Context.Tag) + Layer; enforces the 3 Session invariants
  index.ts          Public API barrel
test/               Executable acceptance tests (named by AC id)
```

## Acceptance criteria → tests

| AC | What | Test | Status |
|----|------|------|--------|
| **AC-024** | Session lifecycle new→close→clean; corrupt `session.json` skipped on list; missing `createdAt` not deleted; default `7d` clean age | `test/ac-024-session-lifecycle.test.ts` | PASS |
| **AC-017** | Ref validity: no-cache / missing / stale / lacks-action / lacks-bounds → unavailable; valid → dry-run plan; ref format `^@e\d+$` | `test/ac-017-018-019-decisions.test.ts` | PASS |
| **AC-018** | Target staleness: rediscovered → `selected:true,stale:false`; not rediscovered → `stale:true`; `targetId` composition + fallbacks | `test/ac-017-018-019-decisions.test.ts` | PASS |
| **AC-019** | Snapshot prereqs: no session / no active target / missing `device.id` → unavailable with reason; **no artifacts written** | `test/ac-017-018-019-decisions.test.ts` | PASS |
| **AC-026** | Snapshot persist + the **3 pointer invariants** hold after capture; refs rewritten `@e1..@eN`, `stale:false` | `test/ac-026-snapshot-persist.test.ts` | PASS |
| **AC-043** | Session-name normalisation (lowercase → `[^a-z0-9_.-]+`→`-` → trim → throw-if-empty → slice(0,48)); duration parse `^(\d+)([smhd])$` | `test/ac-043-034-naming.test.ts` | PASS |
| **AC-034** | Id format: `<prefix>-<timestamp>-<suffix>`, single canonical timestamp, collision-resistant suffix | `test/ac-043-034-naming.test.ts` | PASS |
| **Round-trip** | encode→decode === original for every entity; lenient shim normalises a legacy-loose `SessionRecord` to strict | `test/schema-roundtrip.test.ts` | PASS |

### Skipped (out of this package's scope — `it.skip` with AC id)

| Skip | Why |
|------|-----|
| `AC-026 semantic-bridge capture path — needs @expo98/protocols + bridge` (`test/ac-026-snapshot-persist.test.ts`) | Live capture = CDP `Runtime.evaluate` → bridge refs; lands in `@expo98/protocols` + the C7 bridge handler. This package only persists an **already-captured** `SnapshotResult`. |

## Schema-drift tightenings (vs legacy)

- One canonical `SessionRecord` (the strict variant: `schemaVersion:1`, `closedAt?`,
  typed `sidecars: SidecarRecord[]`). The two looser copies are accepted only by
  the migration shim.
- `semanticBridge` is typed `SemanticBridgeSnapshot` (was `unknown`) on both
  `SnapshotResult` and `RefCache`.
- `BridgeMetadata.domains` → `BridgeDomain` literal union; `OverlayEventsFile.events`
  → `OverlayEvent` element schema (was `any[]`).
- `sidecars` implements the real `running→stale→stopped→unknown` status set
  (AC-033 "implement", not the dead forward-declaration).

## The three Session pointer invariants (AC-026)

Enforced in `persist.ts` (`checkInvariants`), run after every `snapshotPersist`
and exposed via `verifyInvariants`:

1. `activeTargetId` ≠ null ⇒ `sessions/<id>/target.json` exists.
2. `lastSnapshotId` ≠ null ⇒ `sessions/<id>/snapshots/<sid>.json` exists.
3. `refs.json.snapshotId` === `lastSnapshotId` (the cache mirrors the pointer).

Pointers are only advanced **after** the referenced files are written, so the
invariant can never be transiently false on a successful write.

## `@expo98/core` integration seams

This package is built to typecheck independently of the concurrently-built
`@expo98/core`. The seams (marked `// INTEGRATION SEAM (@expo98/core): …` in
source) are:

1. **Clock / Id (S3).** `PersistenceClock` (`persist.ts`) — `nowIso()` +
   collision-resistant `suffix()` — is injected. Production wiring replaces the
   `defaultClock` with core's S3 Clock/Id service so timestamps + suffixes come
   from the one canonical generator (AC-034). *(`src/persist.ts` `layer` / `defaultClock`.)*
2. **Error → exit-code mapping.** The tagged persistence errors (`errors.ts`)
   are adapted to core's `DomainError` / `exitCodeForError` at the dispatch
   boundary; none is a usage error, so all map to exit 1. *(`src/errors.ts` header.)*
3. **Redaction (S5).** `RefRecord.raw` and `RunRecord.args` carry untyped
   passthrough that must be redacted by core's single redactor (AC-003) at the
   output boundary — this package stores, it does not redact. *(`src/value-objects.ts` `RefRecord.raw`.)*
4. **Filesystem port (deferred platform-node adapter).** `Fs` (`fs-port.ts`) is
   a narrow subset of `@effect/platform` `FileSystem` + `Path`; the deferred CLI
   shell package provides a node-backed `Layer`. Tests use the in-memory impl.

No hard import from `@expo98/core` exists in this package; all shared seam types
are defined locally.

## Verify

```sh
cd packages/domain
pnpm exec tsc --noEmit      # strict ESM typecheck, no `any`
```

> If `pnpm exec` aborts with `ERR_PNPM_IGNORED_BUILDS` (a workspace-level
> install gate for `@parcel/watcher` / `msgpackr-extract` build scripts,
> unrelated to this package), run it with
> `pnpm --config.verify-deps-before-run=false exec tsc --noEmit`. Both produce
> the same result; this package's typecheck passes with exit code 0.
