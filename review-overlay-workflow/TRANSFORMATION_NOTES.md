# Transformation Notes: review-overlay-workflow

## Scope

Transformed the legacy review overlay workflow orchestration:

- `reviewOverlay` action routing for `prepare`, `scaffold`, `server`, `read`, and `clear`
- default output directory and `events.json` path derivation
- prepare/clear event file calls
- read event calls with optional Metro port
- server action delegation
- served prepare mode detached process descriptor
- `scaffoldReviewOverlay` file writes, overwrite guard, integration instructions, and capabilities
- `relativeImportFromAppRoot`
- `normalizeEndpointPath`

The actual long-lived HTTP request handler is intentionally separate; durable event state behavior is covered in `review-sidecar-state`, and server hardening remains a dedicated wrapper task.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| `RULE-012` | Preserves review-overlay event artifact paths, read/clear behavior, endpoint path validation, and local server launch metadata. |
| `RULE-035` | Preserves review workflow evidence orchestration without judging UI quality. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:3797-3804` | `src/main/index.ts:44` | Normalizes action, validates allowed actions, and delegates scaffold. |
| `legacy/expo98/dist/expo-ios.mjs:3805-3813` | `src/main/index.ts:54` | Resolves cwd/output directory/events path and handles `read`/`clear`. |
| `legacy/expo98/dist/expo-ios.mjs:3814-3816` | `src/main/index.ts:67` | Delegates direct server action with dir, port, and endpoint path. |
| `legacy/expo98/dist/expo-ios.mjs:3818-3844` | `src/main/index.ts:71` | Prepares events and optionally spawns detached review-overlay server metadata. |
| `legacy/expo98/dist/expo-ios.mjs:3846-3862` | `src/main/index.ts:103` | Returns output paths, server descriptor, event data, and instructions. |
| `legacy/expo98/dist/expo-ios.mjs:3864-3895` | `src/main/index.ts:118` | Scaffolds component/index files and returns integration import, JSX, note, and capabilities. |
| `legacy/expo98/dist/expo-ios.mjs:3897-3900` | `src/main/index.ts:155` | Computes relative import path from app root. |
| `legacy/expo98/dist/expo-ios.mjs:4044-4049` | `src/main/index.ts:160` | Preserves endpoint path defaulting and simple path validation. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- default prepare output and instructions
- served prepare mode port clamping, endpoint normalization, spawn args, `unref`, and URLs
- read, clear, server, and unknown action routing
- scaffold file paths, writes, integration strings, and capabilities
- overwrite guard and `force`
- relative import path behavior
- endpoint path defaults and validation
- optional string and tool JSON helpers

## Deliberate Deviations

- Filesystem, event-state, server delegation, log file, process spawning, and path behavior are injected to make the workflow deterministic and adapter-friendly.
- The scaffolded component is a compact React Native overlay that preserves the primary contract: a development-only comment control, inactive pass-through, tap event submission, event count, and local endpoint sync. It is smaller than the bundled legacy component but preserves the scaffolded integration surface and event-posting role.
- The package does not run the unauthenticated wildcard-CORS HTTP server. That remains a deliberate hardening follow-up under `RULE-012`.

## Architecture Review

Local review found no high-severity issues. The module separates command orchestration from state and server adapters, which matches the existing modernization direction. Medium follow-up: the future CLI dispatch module should wire this package to `review-sidecar-state` and the hardened overlay server adapter.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '3797,3901p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '44,158p' modernized/expo98/review-overlay-workflow/src/main/index.ts)
```
