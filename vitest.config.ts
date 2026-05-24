import { defineConfig } from "vitest/config"

// Single root config runs every package's acceptance suite. Workspace packages
// (@expo98/*) resolve to TS source via their package.json exports, so no build
// step is needed to run tests. Acceptance tests import `it`/`expect` from
// `@effect/vitest`, so globals stay off.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    globals: false,
    passWithNoTests: false
  }
})
