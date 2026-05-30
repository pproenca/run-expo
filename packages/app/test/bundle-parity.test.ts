import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
/**
 * Source ↔ bundle PARITY guard (ASSESSMENT debt #8 — the legacy's missing
 * safeguard).
 *
 * The runnable artifact is the esbuild BUNDLE (`cli/run-expo.mjs`), not the `.ts`
 * source (whose `.js`→`.ts` specifiers resolve only under a bundler). Nothing
 * otherwise proves the SHIPPED bin wires the SAME command surface the in-process
 * source registry does — a stale or partial bundle would pass every other test.
 *
 * This test closes that gap WITHOUT a second "lib" bundle: it derives the
 * source's command surface from the SAME registry the shell builds
 * (`coreReadCommands` + `handlerCommands`, grouped by first verb token — exactly
 * how `main.ts` builds its `@effect/cli` subcommands), then derives the BUNDLE's
 * surface by spawning the bin with an invalid subcommand and parsing the
 * `@effect/cli` "Invalid subcommand ... use one of '...'" list it prints. The two
 * sets must be equal.
 *
 * Skips (does not fail) when the bundle has not been built, so a fresh checkout's
 * `pnpm test` stays green; CI runs `pnpm build` first, so there the bundle exists
 * and the assertion is live. See the CI workflow.
 */
import { describe, expect, it } from "@effect/vitest"
import { handlerCommands } from "../src/all-commands.js"
import { coreReadCommands } from "../src/commands.js"

const BIN = fileURLToPath(new URL("../cli/run-expo.mjs", import.meta.url))

/** First verb token of each registration — the `@effect/cli` subcommand names. */
const sourceFirstTokens = (): ReadonlySet<string> => {
  const set = new Set<string>()
  for (const reg of [...coreReadCommands, ...handlerCommands]) {
    set.add(reg.path.split(" ")[0] ?? reg.path)
  }
  return set
}

/**
 * Run the built bin with an unknown subcommand and parse the command names from
 * the `@effect/cli` "use one of '...'" error. Returns the bundle's first-token
 * command surface. (Exit 2 is expected; execFileSync throws on non-zero, so the
 * stderr/stdout is read off the thrown error.)
 */
const bundleFirstTokens = (): ReadonlySet<string> => {
  let output: string
  try {
    output = execFileSync("node", [BIN, "__definitely_not_a_command__"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    output = `${e.stdout ?? ""}${e.stderr ?? ""}`
  }
  const names = new Set<string>()
  for (const match of output.matchAll(/'([a-z][a-z0-9-]*)'/g)) {
    if (match[1] !== undefined) {
      names.add(match[1])
    }
  }
  return names
}

describe("Bundle ↔ source command-surface parity (ASSESSMENT debt #8)", () => {
  it("the built bin exposes exactly the source registry's command surface", () => {
    if (!existsSync(BIN)) {
      // Bundle not built (fresh checkout). CI builds first; locally run `pnpm build`.
      return
    }
    const source = sourceFirstTokens()
    const bundle = bundleFirstTokens()

    const missingFromBundle = [...source].filter((n) => !bundle.has(n)).sort()
    const extraInBundle = [...bundle].filter((n) => !source.has(n)).sort()

    expect(
      { missingFromBundle, extraInBundle },
      `bundle command surface drifted from source — rebuild with \`pnpm build\``,
    ).toEqual({ missingFromBundle: [], extraInBundle: [] })
  })
})
