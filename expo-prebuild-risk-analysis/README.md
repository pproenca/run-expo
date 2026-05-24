# @expo98/expo-prebuild-risk-analysis

Modernized Expo module discovery and prebuild risk analysis extracted from
`legacy/expo98/dist/expo-ios.mjs`.

The package preserves the legacy static behavior for:

- Expo-related dependency filtering and categorization
- `app.json` and dynamic `app.config.*` plugin extraction
- native project, config-plugin dependency, and app config plugin risk messages
- dynamic-vs-static Expo config limitation messages

Run:

```bash
npm test
```
