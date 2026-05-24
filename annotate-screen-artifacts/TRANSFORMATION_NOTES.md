# Transformation Notes: annotate-screen-artifacts

## Scope

Transformed the legacy `annotateScreen` orchestration flow:

- cwd fallback and timestamped output directory selection
- screenshot path derivation
- provided screenshot copy mode
- UX-context capture mode
- screenshot-only fallback mode
- context, annotation, and HTML artifact writes
- annotation JSON initialization skip when the file already exists
- optional detached annotation-server process descriptor
- returned paths, server metadata, and instructions

The long-lived `annotationServer` request handler is covered by `review-sidecar-state` for durable state behavior and remains a separate HTTP wrapper hardening task.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| `RULE-012` | Produces annotation artifacts consumed by the local annotation server and preserves `annotations.json` initialization. |
| `RULE-035` | Captures review evidence without making unsupported visual-quality judgments. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:3658-3668` | `src/main/index.ts:58` | Resolves cwd, timestamp, output directory, creates the directory, and derives `screenshot.png`. |
| `legacy/expo98/dist/expo-ios.mjs:3670-3678` | `src/main/index.ts:73` | Copies a provided screenshot and creates a `provided-screenshot` context. |
| `legacy/expo98/dist/expo-ios.mjs:3678-3692` | `src/main/index.ts:81` | Calls UX-context capture with the fixed include flags and screenshot output path. |
| `legacy/expo98/dist/expo-ios.mjs:3692-3700` | `src/main/index.ts:95` | Uses screenshot-only fallback when `includeUxContext` is false. |
| `legacy/expo98/dist/expo-ios.mjs:3702-3718` | `src/main/index.ts:104` | Writes `context.json`, conditionally initializes `annotations.json`, and writes `annotate.html`. |
| `legacy/expo98/dist/expo-ios.mjs:3720-3744` | `src/main/index.ts:121` | Builds detached annotation server process metadata and log path. |
| `legacy/expo98/dist/expo-ios.mjs:3746-3756` | `src/main/index.ts:146` | Returns artifact paths, server descriptor, and user instructions. |
| `legacy/expo98/dist/expo-ios.mjs:4206-4330` | `src/main/index.ts:162` | Generates the annotation HTML board with escaped title, point comments, rectangle comments, save/download/copy actions, and JSON state. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- default UX-context mode and fixed capture arguments
- timestamped default output directory
- context, annotation, and HTML writes
- HTML title escaping plus point/rectangle comment support
- provided screenshot copy mode
- skip behavior when `annotations.json` already exists
- screenshot-only fallback mode
- served mode port clamping, log file path, detached spawn args, `unref`, and server instructions
- `findAvailablePort` branch and helper contracts for optional strings, clamping, and JSON unwrapping

## Deliberate Deviations

- The modern HTML renderer avoids legacy `innerHTML` for comment cards and uses DOM text/element APIs, reducing stored-XSS risk while preserving annotation file behavior.
- Process spawning, filesystem, path, clock, screenshot, and context capture dependencies are injected. The legacy implementation closed over globals.
- The HTML template is intentionally smaller than the bundled legacy string but preserves the core annotation interactions: point comments, rectangle comments, save, download, copy, title escaping, and `annotations.json` state.

## Architecture Review

Local review found no high-severity issues. The package has deterministic characterization tests and isolates side effects behind dependencies. Medium follow-up: wire this package to `ux-context-capture` and the hardened annotation server wrapper once the monolithic CLI dispatch transform lands.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '3658,3756p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '58,160p' modernized/expo98/annotate-screen-artifacts/src/main/index.ts)
```
