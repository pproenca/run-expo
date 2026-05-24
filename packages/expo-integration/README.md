# @expo98/expo-integration

**D9 (in-app devtools bridge) + D5 (Expo / React Native introspection)** of the
Effect-TS `expo98` rebuild.

The official Expo SDK (live `expo config` parsing, in-app bridge delivery) is a
**documented seam** — it needs the _target_ project's Expo install, not ours — so
this package implements the contracts/logic over file reads, the
subprocess/CDP capability seams, and a **data-file compatibility map**. The
Expo→RN map lives in `src/data/expo-rn-compat.json` so it updates **without a code
release** (brief Q#10).

## What it does

| Area                                 | Module                        | Side-effect class                               | AC                 |
| ------------------------------------ | ----------------------------- | ----------------------------------------------- | ------------------ |
| Bridge install / remove              | `install.ts`                  | `source-write` (token-gated, via core dispatch) | AC-008             |
| Bridge install-state                 | `install-state.ts`            | `read` (over the `Fs` port)                     | AC-027             |
| Bridge runtime-health                | `health.ts`                   | `read` (ordered state machine)                  | AC-028, AC-009     |
| Bridge storage/state/controls        | `domain-actions.ts`           | `read` / `device` per action                    | AC-006             |
| Expo↔RN compat                       | `compat.ts` + `introspect.ts` | `read` (pure classifier + Fs read)              | AC-020             |
| Expo Router sitemap                  | `sitemap.ts`                  | pure                                            | AC-044             |
| Bridge artifacts / layout            | `bridge-files.ts`             | —                                               | AC-008/009/027/028 |
| Size-bounding                        | `bound.ts`                    | —                                               | AC-006             |
| Bridge transport tag (Expo SDK seam) | `bridge-transport.ts`         | —                                               | AC-006/028         |

## The design rule (capability injection)

Mutating surfaces never import a protocol's eval/device/write API directly.

- **Install/remove** are `source-write`-classed `Command`s dispatched **through
  `@expo98/core`'s gate**. Core injects `SourceWriteCapability` into the handler's
  `R` **only on the gate-pass branch**; a denied (no-token) call never builds the
  handler, so the capability is invoked **0×** (no files written/deleted). The
  no-token branch then surfaces `{ requiredConfirmation, status, plan }`.
- **Domain actions** gate on the per-action side-effect class with core's `gate` /
  `policyDeniedPayload`; a denied mutate **never consults the bridge transport**,
  and a **second defense-in-depth re-check** re-denies after the call so a
  classification drift can't surface a mutate's value. Allowed values are
  size-bounded (`MAX_OUTPUT=40000`, `MAX_ARRAY_ITEMS=1000`) and redacted at core's
  output boundary.

## AC → test map

| AC     | Test file                     | Asserts                                                                                                                                                                                                                                           |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-008 | `test/install.test.ts`        | no token → 0 file writes/deletes + `requiredConfirmation`/`status`/`plan` (**SourceWriteCapability invoked 0×**); token+allow → writes `.expo98/bridge.json` + `src/expo98-devtools-bridge.ts`; remove deletes both + legacy `.expo-ios` fallback |
| AC-027 | `test/install-state.test.ts`  | every branch: missing-expo / absent / partial-install / version-mismatch / not-development-only / present + legacy metadata fallback                                                                                                              |
| AC-028 | `test/health.test.ts`         | each unavailable code at the right step (install-state→transport→registration→version), ordering (install short-circuits before the probe), all-pass `ready` payload                                                                              |
| AC-009 | `test/health.test.ts`         | not-development-only → incompatible-project; runtime refusals `development-mode-required` (`__DEV__` undefined) + `production-build` (`__DEV__` false); single registration path                                                                  |
| AC-006 | `test/domain-actions.test.ts` | classifier; read ungated; mutate denied without policy (**bridge invoked 0×**); allowed → bounded evidence; redaction at boundary; defense-in-depth re-check re-denies after the call                                                             |
| AC-020 | `test/compat.test.ts`         | all five classes from the data file; first-`\d+\.\d+(\.\d+)?` parse; **adds an Expo 55 row to a manifest object to prove no-code-change extensibility**                                                                                           |
| AC-044 | `test/sitemap.test.ts`        | extension strip, `_layout`→layout, `+`→special, index/group drop, `[...rest]`/`[[opt]]`/`[param]`/literal                                                                                                                                         |

## Expo SDK seams (documented, not implemented)

All marked `// SEAM (Expo SDK): ...` in source:

- **Live `expo config` introspection** (`introspect.ts`) — the authoritative
  resolved-config/version read is `expo config` + `@expo/config-plugins`; needs the
  target's Expo install. Static fallback: declared versions from `package.json`
  feed the same pure `classifyCompat`.
- **In-app bridge delivery** (`bridge-files.ts`, `install.ts`) — the official Expo
  DevTools Plugins SDK delivers the written bridge to the running dev client. This
  package only writes/deletes the **project-side** files via `SourceWriteCapability`.
- **Bridge transport** (`bridge-transport.ts`) — the `BridgeTransport` tag is the
  channel the Expo DevTools Plugins SDK fills; tests inject a fake.
- **Runtime registration probe** (`health.ts`) — uses `@expo98/protocols`'
  `HermesEvidence` (loopback CDP) as the probe seam; live probing needs a running
  Metro/Hermes target.

## Data-file location

`src/data/expo-rn-compat.json` — Expo SDK major → expected RN `major.minor`
(54→0.81, 53→0.79, 52→0.76, 51→0.74, 50→0.73). Append a row (or replace the file
with a fetched manifest) to support a newer SDK **without editing code**;
`classifyCompat(input, map)` accepts an override map.

## Skipped acceptance (require live target)

- `it.skip` AC-008 live: bridge delivery to a running Expo dev client (Expo
  DevTools Plugins SDK seam).
- `it.skip` AC-028 live: bridge runtime registration probe against running Hermes.

## Self-verify

```bash
cd packages/expo-integration && pnpm exec tsc --noEmit
```
