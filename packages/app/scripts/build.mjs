#!/usr/bin/env node
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
/**
 * Build the publishable `run-expo` bin.
 *
 * WHY a bundle is the runnable artifact (not the .ts source): every workspace
 * module imports its siblings with `.js` specifiers that physically resolve to
 * `.ts` ONLY under a bundler / vitest (`moduleResolution: bundler`, `noEmit`).
 * So `node packages/app/src/main.ts` cannot run un-bundled by design — esbuild
 * rewrites those specifiers and inlines the whole `@expo98/*` + Effect graph
 * into one self-contained ESM file. THAT file is the bin (the published tarball
 * declares no runtime deps; everything is in the bundle).
 *
 * Bundler: esbuild. Chosen over tsup (esbuild + extra plumbing we don't need —
 * we emit no .d.ts, no CJS, one entry) and Bun build (would add a Bun runtime
 * dependency to a Node-targeted, @effect/platform-node CLI). esbuild is a single
 * fast pass and the smallest honest tool for "one ESM file, Node target".
 *
 * Emitted file:
 *   - cli/run-expo.mjs — the self-contained bin (effect + @effect/cli + ws all
 *                      inlined; only Node builtins stay external).
 *
 * Shebang: esbuild carries the entry file's (`src/main.ts`) own
 * `#!/usr/bin/env node` shebang to physical line 1 of the output automatically —
 * so the banner must NOT add a second one (a double shebang puts a `#!...` on
 * line 2, which Node rejects as an invalid token).
 *
 * Banner carries the one required shim: a `createRequire` definition — a
 * transitively-bundled CJS dep (`yaml`, pulled in by @effect/cli's config/help)
 * does `require("process")`; under ESM that throws "Dynamic require ... is not
 * supported" unless `require` exists. createRequire(import.meta.url) supplies it.
 *
 * No footer: the source's `isEntryModule()` (Node's symlink-safe
 * `import.meta.main`, realpath fallback otherwise) fires `main()` itself when the
 * bundle is the process entry. (An earlier footer:`main()` approach double-fired
 * because the source guard ALSO ran main() at the real path.)
 */
import { build } from "esbuild"

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, "..")
const outDir = join(pkgRoot, "cli")
const entry = join(pkgRoot, "src/main.ts")

// createRequire shim only — esbuild emits the entry's shebang on line 1 itself.
const REQUIRE_SHIM = "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"

// Single source of truth for the version: package.json. esbuild `define` inlines
// it into the bundle's `__RUN_EXPO_VERSION__` (see src/commands.ts CLI_VERSION),
// so the shipped bin can never drift from the published version. CI re-asserts it.
const { version } = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"))

mkdirSync(outDir, { recursive: true })

/** Bundle the CLI entry into one self-contained, self-executing ESM bin. */
const bundleBin = async (outfile) => {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    // Everything is inlined so the published tarball is self-contained: effect,
    // @effect/cli, @effect/platform(-node), and `ws` (which lives only behind
    // protocols' CdpSocketFactory, but IS reachable via the composition root, so
    // it must be in the bundle). Only Node builtins stay external.
    packages: undefined,
    // Inline the version from package.json at build time (drift-proof). The bare
    // global is replaced everywhere it appears; under vitest/dev (no define) the
    // source's `typeof` guard falls back to "0.0.0-dev".
    define: { __RUN_EXPO_VERSION__: JSON.stringify(version) },
    banner: { js: REQUIRE_SHIM },
    legalComments: "none",
    // silent: esbuild's stdout summary would otherwise pollute the `npm
    // pack`/`prepack` tarball-metadata stream. Build errors still throw.
    logLevel: "silent",
  })
  chmodSync(outfile, 0o755)
  // Log to stderr so `npm pack`/`prepack` stdout (the tarball metadata stream)
  // stays clean and machine-parseable.
  console.error(`built ${outfile}`)
}

// The single `run-expo` bin — a full self-contained bundle that is the process
// entry → `import.meta.main` true → main() runs exactly once.
await bundleBin(join(outDir, "run-expo.mjs"))

// Sync the LICENSE into the package so the published tarball ships it (the
// canonical file lives at the repo root; `files` lists `LICENSE` here). Running
// in `prepack` keeps the package copy from ever drifting from the root.
copyFileSync(join(pkgRoot, "../../LICENSE"), join(pkgRoot, "LICENSE"))
