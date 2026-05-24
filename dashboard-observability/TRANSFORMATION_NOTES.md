# dashboard-observability Transformation Notes

## Scope

Transformed static dashboard observability behavior from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/dashboard-observability`.

Business rule coverage:

- `RULE-013`: dashboard artifacts live under the Expo state root and summarize
  session artifact namespaces.
- `RULE-035`: the dashboard assembles existing evidence and does not expose a
  server or make unsupported review judgments.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:8737-8765` | `src/main/index.ts:30-58` | `dashboardCommand` validates action, resolves state/artifact paths, reuses previous state, clamps port, writes HTML/JSON/state artifacts, and returns tool JSON. |
| `legacy/expo98/dist/expo-ios.mjs:8767-8783` | `src/main/index.ts:60-79` | `dashboardSessions` sorts session directory names, skips unreadable JSON, and projects stable session summary fields. |
| `legacy/expo98/dist/expo-ios.mjs:8785-8801` | `src/main/index.ts:81-94` | `writeDashboardHtml` writes the static HTML dashboard and escapes status/session JSON. |
| `legacy/expo98/dist/expo-ios.mjs:1383-1390`, `11846-11848`, `13045-13047` | `src/main/index.ts:96-112` | State-root normalization and JSON read/write behavior. |
| `legacy/expo98/dist/expo-ios.mjs:5071-5078`, `12045-12050` | `src/main/index.ts:114-125` | HTML escaping and finite-number clamping. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- `start` status, port clamping, session projection, and JSON/HTML/state writes.
- `status` reuse of previous running state and artifact paths.
- `stop` persistence of stopped state.
- default stopped status and default artifact paths when no prior state exists.
- `--state-dir .../runs` parent normalization.
- unreadable session skipping.
- HTML escaping, numeric clamping, and unknown-action errors.

Current verification:

```bash
cd modernized/expo98/dashboard-observability && npm test
```

Result: 5 tests passing.

## Deliberate Deviations

- The module exposes state helpers for focused tests and future router
  composition. The command remains filesystem-backed like the legacy source.

## Not Migrated

- Future server adapters are not part of legacy `dashboard`; legacy only writes
  local static observability artifacts.
- Final CLI router wiring is deferred until command modules are transformed.

## Follow-Ups

- Wire `dashboardCommand` into the final modernized CLI router.
- Compose it with the session/run-record package for shared state-root helpers
  once the router package is assembled.
