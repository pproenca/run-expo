# HTTP Response Stream Helpers Transformation Notes

## Scope

This module modernizes the generic Node HTTP response/body helper trio from
`legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:4153-4160` | `src/main/index.ts` `sendFile` | Reads a file as bytes, writes status `200`, preserves `content-type` and `cache-control: no-store`, and ends the response with the bytes. |
| `dist/expo-ios.mjs:4162-4168` | `src/main/index.ts` `sendJson` | Writes status `200` by default or an explicit status, preserves JSON content type and no-store cache header, and ends with pretty JSON plus trailing newline. |
| `dist/expo-ios.mjs:4170-4182` | `src/main/index.ts` `readRequestBody` | Sets request encoding to UTF-8, concatenates `data` chunks, rejects with `request body too large` and destroys the request after exceeding the limit, resolves on `end`, and rejects on request `error`. |

## Deliberate Deviations

- `sendFile` accepts an optional `readFile` dependency for deterministic tests.
  The default still reads from local filesystem bytes like the legacy helper.
- Request and response types are structural interfaces so the helpers can be
  used by real Node HTTP objects or test doubles.

## Not Migrated

- Annotation and review overlay route handlers remain in their owning packages.
  This package owns only the shared response/body stream primitives.

## Proof

Characterization tests in `src/test/characterization.test.ts` cover:

- file response status, headers, byte body, and file-read path
- JSON status defaults, explicit status codes, pretty formatting, and trailing
  newline
- UTF-8 body aggregation, chunk concatenation, oversize rejection with request
  destruction, and error-event rejection

## Follow-ups

- Replace duplicated payload-only response helpers in server packages once the
  final HTTP adapter layer is composed.
