# @expo98/runtime-inspector-actions

Modernized runtime inspector and dev-menu actions for expo98.

This package covers:

- `inspector probe`
- `inspector toggle`
- `inspector install-comment-menu`
- `inspector read-comments`
- `inspector clear-comments`
- `inspector open-dev-menu` / `open-dev-menu`

Metro target discovery, Hermes evaluation, simulator selection, Metro message
socket broadcast, dev-client repair, and `xcrun` execution are injected so the
legacy behavior can be characterized without live devices.

## Verification

```bash
npm test
```

