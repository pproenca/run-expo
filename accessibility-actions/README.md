# @expo98/accessibility-actions

Modernized TypeScript transform for legacy `expo-ios accessibility
tree|inspect|audit|focus`.

## Scope

This package covers:

- native accessibility tree payloads with semantic bridge evidence
- cached ref inspection
- cached ref accessibility audit issues
- focus delegation through the existing ref-action path
- state-root and latest-session helpers needed to read ref caches

The command preserves the legacy tool JSON contract and keeps simulator,
semantic bridge, and ref-action adapters injected for router composition.

## Verification

```bash
npm test
```
