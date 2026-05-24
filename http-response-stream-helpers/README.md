# @expo98/http-response-stream-helpers

Modernized HTTP response and request-body helpers extracted from
`legacy/expo98/dist/expo-ios.mjs`.

The package preserves:

- file response headers and byte body writes
- pretty JSON response formatting with a trailing newline
- request body UTF-8 aggregation, oversize rejection, and request destruction

Run:

```bash
npm test
```
