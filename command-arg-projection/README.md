# @expo98/command-arg-projection

Modernized TypeScript transformation of the legacy expo98 command argument projection table.

This package converts parsed CLI args plus global flags into handler args for the full runtime command surface. It is intended to plug into the `command-dispatch-envelope` `projectArgs` dependency and replace the bundled `commandArgs` switch as a separately testable module.

## Commands

```bash
npm test
```

The tests are characterization tests derived from `legacy/expo98/dist/expo-ios.mjs:12215-12777`.
