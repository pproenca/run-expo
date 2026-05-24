# @expo98/live-backlog

Modernized TypeScript transform for legacy `expo-ios live-backlog`.

## Scope

This package covers:

- command matrix generation from dispatcher aliases and help text
- smoke/full row selection and terminal action ordering
- row template materialization for live command execution
- self-check validation for command coverage and evidence captures
- captured row classification for `RULE-036`
- report writing for `live-backlog run`

Process execution and filesystem operations are dependency-injected so the row
runner can be tested without invoking the legacy CLI.

## Verification

```bash
npm test
```
