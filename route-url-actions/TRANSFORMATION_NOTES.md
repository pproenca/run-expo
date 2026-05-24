# route-url-actions Transformation Notes

## Scope

Transformed route URL construction, direct URL opening, open-route execution, and simulator device selection from `legacy/expo98/dist/expo-ios.mjs` into `modernized/expo98/route-url-actions`.

Business rule coverage:

- `RULE-026`: Route/deep-link URL evidence redacts sensitive query material before output, including `cookie`, `token`, `authorization`, `password`, and `secret`.
- `RULE-022`: This slice preserves the legacy direct device mutation behavior for `open-url` and `open-route`; central policy hardening is deferred to the future reimagined command router.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:2381-2398` | `src/main/index.ts:153-174` | `openUrl` validates URL input, rejects whitespace, invokes Android VIEW intents or iOS `simctl openurl`, and returns bounded stdout/stderr. |
| `legacy/expo98/dist/expo-ios.mjs:3526-3543` | `src/main/index.ts:176-198` | `openExpoRoute` validates cwd, resolves a booted simulator, accepts explicit URL or builds a route URL, invokes `simctl openurl`, redacts returned sensitive query values, and includes normalized exec errors. |
| `legacy/expo98/dist/expo-ios.mjs:9640-9652` | `src/main/index.ts:66-77` | `buildExpoRouteUrl` resolves explicit or inferred scheme, strips one leading route slash, preserves URLSearchParams encoding, and lets `authCookie` set/override the cookie query key. |
| `legacy/expo98/dist/expo-ios.mjs:9654-9666` | `src/main/index.ts:79-93` | `inferExpoScheme` reads `app.json` `expo.scheme` before top-level `scheme`, then static `app.config.*` files through the legacy regex. |
| `legacy/expo98/dist/expo-ios.mjs:11782-11800`, `12038-12056` | `src/main/index.ts:55-64`, `95-109`, `242-249`, `252-283` | String validation, optional string trimming, sensitive URL redaction, process-name extraction, truncation, and payload redaction preserve or harden helper behavior. |
| `legacy/expo98/dist/expo-ios.mjs:11816-11832` | `src/main/index.ts:200-213` | cwd normalization validates that the directory exists before open-route work proceeds. |
| `legacy/expo98/dist/expo-ios.mjs:11923-11955` | `src/main/index.ts:111-151` | `resolveIosDevice` and `androidDeviceArgs` preserve UDID shortcut, simulator list parsing, exact/partial matching, booted/iPhone/first-device fallback, and Android `-s` prefix behavior. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Required and optional string validation.
- Route URL construction with explicit scheme, default route, route slash trimming, query encoding, cookie override, and missing-scheme errors.
- Scheme inference from `app.json` and static `app.config.*`.
- Sensitive URL redaction through URL parsing and malformed-URL regex fallback.
- iOS simulator selection, direct UDID handling, Android device args, and no-simulator errors.
- `openUrl` iOS and Android command arguments and redacted payloads.
- `openExpoRoute` cwd validation, explicit URL handling, route URL building, sensitive query redaction, normalized exec error projection, and `simctl openurl` invocation.
- `processNameFromBundleId` fallback and sanitization.

Current verification:

```bash
cd modernized/expo98/route-url-actions && npm test
```

Result: 28 tests passing.

## Deliberate Deviations

- Subprocess execution is dependency-injected through `execFile` for deterministic tests and future CLI composition.
- Default cwd normalization uses `path.resolve(cwd ?? ".")`, equivalent to `process.cwd()` when no cwd is supplied.
- This module intentionally does not add action-policy enforcement to `open-url` or `open-route`; the legacy functions are direct device mutations, while RULE-022 records the future reimagined hardening decision.
- URL output redaction is broader than the legacy `redactUrlAuthCookie` helper, which only redacted `cookie`. This deliberate hardening follows RULE-026 and prevents command echo output from leaking sensitive query values.

## Not Migrated

- Top-level CLI command registration.
- App launch, terminate, reload, install, uninstall, crash evidence, screenshots, and logs. Those remain separate interaction/diagnostics slices.
- Central policy loading and command-level mutation gating.

## Follow-Ups

- Wire this module into `navigation-deeplinks` as the open-route adapter.
- Transform the broader app lifecycle action module so launch/reload/install policy and crash evidence can be verified separately.
- Apply RULE-022 central policy hardening at the modernized CLI router boundary after all direct action slices are transformed.

## Architecture Review

Architecture critic findings:

- High: RULE-026 redaction was incomplete because the first implementation preserved `token`, `authorization`, and `password` query values.
- High: `openExpoRoute` redacted the `url` field but returned raw stdout/stderr/error strings that could echo sensitive URLs.
- Medium: `openUrl` had no redaction boundary for direct deep links.
- Medium: adapter error values were emitted as arbitrary `unknown`.
- Medium: truncation behavior is implemented but not yet characterized with an overflow-marker test.
- Nit: notes understated the RULE-026 redaction gap.

Applied fixes:

- Added a shared payload redaction pass for returned URL-bearing strings.
- Extended sensitive query redaction to `cookie`, `token`, `authorization`, `password`, and `secret`.
- Applied the redaction pass to `openUrl` and `openExpoRoute` stdout/stderr/error payloads.
- Normalized exec errors to a serializable `{ message, code, signal }` shape before output.
- Updated characterization tests to fail on sensitive query leakage in direct URLs, open-route URLs, command output, and error messages.

Remaining non-High items:

- Add explicit overflow-marker characterization for stdout/stderr over `MAX_OUTPUT` in a follow-up test pass.
