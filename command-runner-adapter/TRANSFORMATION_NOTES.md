# Command Runner Adapter Transformation Notes

## Scope

This module modernizes the subprocess helper boundary from
`legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:12001-12007` | `src/main/index.ts` `commandPath` | Runs `sh -lc "command -v <command>"` with 5000ms timeout and returns trimmed stdout or `null`. |
| `dist/expo-ios.mjs:12009-12034` | `src/main/index.ts` `execFilePromise` | Applies cwd/env/timeout/maxBuffer/reject/input defaults, calls `execFile`, attaches stdout/stderr on rejected errors, resolves normalized errors when `rejectOnError` is false, and writes optional stdin input. |
| `dist/expo-ios.mjs:12016-12018` | `src/main/index.ts` `MAX_OUTPUT` | Preserves the legacy 40000-byte subprocess buffer default. |

## Deliberate Deviations

- Node `execFile`, cwd, and env are injected instead of imported directly. This
  keeps the adapter deterministic and lets the final CLI composition own process
  policy and redaction.
- Default cwd/env fallback to `"."` and `{}` when no provider is injected. The
  final process adapter should pass `process.cwd()` and `process.env`, matching
  legacy runtime behavior.

## Not Migrated

- Higher-level command planning and policy decisions remain in their domain
  packages. This package only owns process invocation shape and result
  normalization.

## Proof

Characterization tests cover:

- default exec options
- explicit cwd/env/timeout/maxBuffer/input
- reject-on-error stdout/stderr attachment
- non-rejecting normalized error payloads
- `commandPath` command and null behavior
- non-Error normalization

## Follow-ups

- Wire packages that currently duplicate local `execFilePromise` helpers to this
  adapter in the final CLI composition layer.

