# router-sitemap characterization tests

These tests pin Expo Router sitemap behavior from
`legacy/expo98/dist/expo-ios.mjs:1201-1229`,
`legacy/expo98/dist/expo-ios.mjs:11692-11718`, and
`legacy/expo98/dist/expo-ios.mjs:11882-11919`, with RULE-025 from
`analysis/expo98/BUSINESS_RULES.md`.

Run from this package:

```bash
npm test
```

The suite uses injected path and filesystem adapters. It does not import,
evaluate, or read application route modules while building the sitemap.
