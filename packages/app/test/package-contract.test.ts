import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "@effect/vitest"

type PackageManifest = {
  readonly bin?: unknown
  readonly exports?: unknown
  readonly files?: unknown
  readonly os?: unknown
}

const manifestPath = fileURLToPath(new URL("../package.json", import.meta.url))

const readManifest = (): PackageManifest => JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest

describe("Published package contract", () => {
  it("AC-034 ships the CLI bin without a root module export to unshipped source", () => {
    const manifest = readManifest()

    expect(manifest.bin).toEqual({ "run-expo": "./cli/run-expo.mjs" })
    expect(manifest.files).toEqual(["cli/run-expo.mjs", "README.md", "LICENSE"])
    expect(Object.hasOwn(manifest, "exports")).toBe(false)
    expect(Object.hasOwn(manifest, "os")).toBe(false)
  })
})
