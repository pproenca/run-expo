# `@expo98/handlers-snapshot`

D8 command handlers for the Effect-TS rebuild of `expo98`: **snapshot capture**
orchestration, **accessibility** `tree`/`audit`, the **snapshot depth filter**, and
**RN** component-tree introspection. Every command is `read` — none mutates the app
or device, so no handler ever needs one of core's dangerous capability tags in `R`.

## What it owns

| Area            | Verbs                                   | AC             |
| --------------- | --------------------------------------- | -------------- |
| `snapshot`      | capture orchestration                   | AC-019, AC-026 |
| `snapshot`      | depth filter                            | AC-040         |
| `accessibility` | `tree` · `audit`                        | AC-023         |
| `rn`            | `tree` · `refs` · `renders` · `inspect` | AC-055         |

## The capture capability seam (read-only, injected)

Capture is `read`-classed but still reaches the running app — over **READ surfaces
only**, so it never touches the dispatcher-withheld runtime-eval mutation surface:

1. **Semantic bridge** (`SemanticCapture`) — a FIXED, package-controlled CDP
   `HermesEvidence` probe (eval timeout `5000ms`). Caller JS is never injected.
2. **Native `axe describe-ui`** (`NativeAxe`) — a subprocess fallback over core's
   `Subprocess` service (timeout `12000ms`, `maxBuffer 4 MiB`).

Both are documented `Context.Tag` SEAMS, mirroring the D10 rule: the live transport
is **injected via `R`**, never imported. The orchestrator tries the semantic bridge
first; if it is unavailable (`null`), it falls back to native `axe`; if the CLI is
absent it returns `available:false` (`no-axe`), and a native run failure returns
`transport-failure`. Prerequisites (no session / no active target / missing
`device.id`) reuse domain's `checkSnapshotPrereqs` and write **NO artifacts**.

## Persistence is domain-owned (AC-026)

`captureSnapshot` builds the `SnapshotResult` (refs renumbered to `@e1..@eN`,
`stale:false`, via domain's `renumberRefs`) and calls domain's `snapshotPersist`,
which writes `sessions/<id>/snapshots/<snapshotId>.json` + `sessions/<id>/refs.json`,
sets `lastSnapshotId`/`updatedAt`, and asserts the **THREE Session pointer
invariants** (`activeTargetId`→target.json, `lastSnapshotId`→snapshot file,
`refs.json` mirrors `lastSnapshotId`). None of that is re-implemented here.

## Parameters (canonical bounds)

- **AC-019 capture:** semantic eval `5000ms`; native `axe describe-ui` `12000ms` /
  `maxBuffer 4 MiB`; unavailable codes include `no-session`/`no-active-target`/
  `missing-device-id`/`transport-failure`/`no-axe`.
- **AC-040 depth:** `null` (unbounded) or `clamp(args.depth, 1, 100)`; prune nodes
  with `depth > limit` (root depth 0).
- **AC-055 RN caps:** `maxDepth = max(1, min(depth ?? 30, 80))`;
  `maxNodes = max(1, min(limit ?? 500, 2000))`; ancestor path `slice(0,40)` then
  `slice(16,24)`; control list `slice(0,80)`; record list `slice(0,60)`; element
  actions `slice(0,10)`; `round(v) = Math.round(v*100)/100`.

## AC → test map

| AC         | Test file                    | What it proves                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-019** | `test/snapshot.test.ts`      | each prerequisite miss (no session / no active target / missing `device.id`) → `available:false` with the matching reason and **zero artifacts on the in-memory fs**; semantic path persists; native `axe` fallback persists when the bridge is absent; `axe` absent → `no-axe` (no artifacts); native run failure → `transport-failure`.                            |
| **AC-026** | `test/snapshot.test.ts`      | end-to-end capture via domain's real `PersistenceService` + in-memory fs persists `snapshots/<id>.json` + `refs.json`, sets `lastSnapshotId` (asserted on the returned AND reloaded session), refs are `@e1..@eN` with `stale:false`, and **`verifyInvariants` succeeds — confirming the 3 Session pointer invariants hold** for both the semantic and native paths. |
| **AC-040** | `test/depth-filter.test.ts`  | `resolveDepth`: `null`/`undefined` → unbounded, else `clamp(1,100)`; `filterByDepth`: `null` keeps all, depth 0 keeps only the root, depth N prunes deeper (root depth 0).                                                                                                                                                                                           |
| **AC-023** | `test/accessibility.test.ts` | `interactive-name` flags refs with `actions.length>0 && !label && !text` (incl. empty-string label/text); does NOT flag named or non-interactive refs; emits the exact `{ref, rule, message}`; no ref cache → `available:false`; verified both as a pure projection and END-TO-END through `dispatch` (read path, ungated).                                          |
| **AC-055** | `test/rn.test.ts`            | depth/node caps, ancestor `slice(0,40)→slice(16,24)`, control `slice(0,80)`, record `slice(0,60)`, action `slice(0,10)`, `round` (incl. `0.1+0.2`); per-verb `tree`/`refs`/`renders`/`inspect` projections; missing element / no graph → `available:false`.                                                                                                          |

### Skipped (require a live device)

- `test/snapshot.test.ts` — `it.skip("AC-019 live capture against a running app /
Hermes / axe ...")`. Needs a running Metro + Hermes target OR an installed `axe`
  CLI against a booted simulator. All pure orchestration + persistence is covered
  above with the in-memory fs and the injected semantic/native SEAM fakes.

## Boundary rule

Handlers depend on domain (entities + persistence + the AC-017/018/019 decisions +
`renumberRefs`), core (`command`/`dispatch`/`descriptor`), and the two package-local
capture SEAM tags. They **never** import a protocol's runtime-eval mutation surface —
capture evidence arrives over read surfaces injected via `R`, which is what keeps the
legacy ungated-runtime-eval defect impossible to reintroduce here.
