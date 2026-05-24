/**
 * AC-027 — bridge install state: absent / present / stale / incompatible.
 *
 * Every branch, over the in-memory `Fs` port:
 *   - no expo dep                                  → incompatible(missing-expo)
 *   - metadata XOR source                          → stale(partial-install)
 *   - both, version/schema mismatch                → stale(version-mismatch)
 *   - both, versions match, !dev-only              → incompatible(not-development-only)
 *   - both, versions match, dev-only               → present
 *   - expo present, neither file                    → absent
 *   - legacy `.expo-ios/bridge.json` is recognised as metadata
 */
import { describe, expect, it } from "@effect/vitest"
import { Fs, makeMemoryFs } from "@expo98/domain"
import {
  bridgeFilePaths,
  bridgeMetadataContents,
  bridgeSourceContents,
  readInstallState,
} from "@expo98/expo-integration"
import { Effect, Layer } from "effect"

const ROOT = "/proj"
const paths = bridgeFilePaths(ROOT)

const withFs = (setup: (fs: Fs["Type"]) => Effect.Effect<unknown, never>) =>
  Effect.gen(function* () {
    const fs = yield* makeMemoryFs()
    yield* setup(fs)
    return yield* readInstallState(ROOT).pipe(Effect.provide(Layer.succeed(Fs, fs)))
  })

const writePackageJson = (fs: Fs["Type"], withExpo: boolean) =>
  fs
    .writeFile(
      `${ROOT}/package.json`,
      JSON.stringify(
        withExpo
          ? { dependencies: { expo: "54.0.0", "react-native": "0.81.0" } }
          : { dependencies: { "react-native": "0.81.0" } },
      ),
    )
    .pipe(Effect.orDie)

describe("AC-027 bridge install state", () => {
  it.effect("incompatible(missing-expo) — no expo dependency", () =>
    Effect.gen(function* () {
      const result = yield* withFs((fs) =>
        writePackageJson(fs, false).pipe(
          Effect.zipRight(fs.writeFile(paths.metadata, bridgeMetadataContents())),
          Effect.zipRight(fs.writeFile(paths.source, bridgeSourceContents())),
          Effect.orDie,
        ),
      )
      expect(result.status).toBe("incompatible")
      expect(result.issue).toBe("missing-expo")
    }),
  )

  it.effect("absent — expo present, neither file", () =>
    Effect.gen(function* () {
      const result = yield* withFs((fs) => writePackageJson(fs, true))
      expect(result.status).toBe("absent")
      expect(result.issue).toBeNull()
      expect(result.expoPresent).toBe(true)
    }),
  )

  it.effect("stale(partial-install) — metadata WITHOUT source", () =>
    Effect.gen(function* () {
      const result = yield* withFs((fs) =>
        writePackageJson(fs, true).pipe(
          Effect.zipRight(fs.writeFile(paths.metadata, bridgeMetadataContents())),
          Effect.orDie,
        ),
      )
      expect(result.status).toBe("stale")
      expect(result.issue).toBe("partial-install")
    }),
  )

  it.effect("stale(partial-install) — source WITHOUT metadata", () =>
    Effect.gen(function* () {
      const result = yield* withFs((fs) =>
        writePackageJson(fs, true).pipe(
          Effect.zipRight(fs.writeFile(paths.source, bridgeSourceContents())),
          Effect.orDie,
        ),
      )
      expect(result.status).toBe("stale")
      expect(result.issue).toBe("partial-install")
    }),
  )

  it.effect("stale(version-mismatch) — both present, wrong version", () =>
    Effect.gen(function* () {
      const wrongMeta = JSON.stringify({
        schemaVersion: 1,
        bridgeVersion: "0.9.0",
        developmentOnly: true,
        generatedBy: "expo98",
        domains: [],
      })
      const result = yield* withFs((fs) =>
        writePackageJson(fs, true).pipe(
          Effect.zipRight(fs.writeFile(paths.metadata, wrongMeta)),
          Effect.zipRight(fs.writeFile(paths.source, bridgeSourceContents())),
          Effect.orDie,
        ),
      )
      expect(result.status).toBe("stale")
      expect(result.issue).toBe("version-mismatch")
    }),
  )

  it.effect("stale(version-mismatch) — both present, wrong schema", () =>
    Effect.gen(function* () {
      const wrongMeta = JSON.stringify({
        schemaVersion: 2,
        bridgeVersion: "1.0.0",
        developmentOnly: true,
        generatedBy: "expo98",
        domains: [],
      })
      const result = yield* withFs((fs) =>
        writePackageJson(fs, true).pipe(
          Effect.zipRight(fs.writeFile(paths.metadata, wrongMeta)),
          Effect.zipRight(fs.writeFile(paths.source, bridgeSourceContents())),
          Effect.orDie,
        ),
      )
      expect(result.status).toBe("stale")
      expect(result.issue).toBe("version-mismatch")
    }),
  )

  it.effect("incompatible(not-development-only) — versions match, dev-only false", () =>
    Effect.gen(function* () {
      const notDev = JSON.stringify({
        schemaVersion: 1,
        bridgeVersion: "1.0.0",
        developmentOnly: false,
        generatedBy: "expo98",
        domains: [],
      })
      const result = yield* withFs((fs) =>
        writePackageJson(fs, true).pipe(
          Effect.zipRight(fs.writeFile(paths.metadata, notDev)),
          Effect.zipRight(fs.writeFile(paths.source, bridgeSourceContents())),
          Effect.orDie,
        ),
      )
      expect(result.status).toBe("incompatible")
      expect(result.issue).toBe("not-development-only")
    }),
  )

  it.effect("present — both present, versions match, dev-only", () =>
    Effect.gen(function* () {
      const result = yield* withFs((fs) =>
        writePackageJson(fs, true).pipe(
          Effect.zipRight(fs.writeFile(paths.metadata, bridgeMetadataContents())),
          Effect.zipRight(fs.writeFile(paths.source, bridgeSourceContents())),
          Effect.orDie,
        ),
      )
      expect(result.status).toBe("present")
      expect(result.issue).toBeNull()
      expect(result.bridgeVersion).toBe("1.0.0")
      expect(result.schemaVersion).toBe(1)
      expect(result.developmentOnly).toBe(true)
    }),
  )

  it.effect("present — recognises a devDependencies expo entry", () =>
    Effect.gen(function* () {
      const result = yield* withFs((fs) =>
        fs
          .writeFile(`${ROOT}/package.json`, JSON.stringify({ devDependencies: { expo: "54.0.0" } }))
          .pipe(
            Effect.zipRight(fs.writeFile(paths.metadata, bridgeMetadataContents())),
            Effect.zipRight(fs.writeFile(paths.source, bridgeSourceContents())),
            Effect.orDie,
          ),
      )
      expect(result.status).toBe("present")
    }),
  )

  it.effect("legacy .expo-ios/bridge.json is recognised as metadata (partial-install)", () =>
    Effect.gen(function* () {
      // Legacy metadata present, no source → partial-install (proves fallback read).
      const result = yield* withFs((fs) =>
        writePackageJson(fs, true).pipe(
          Effect.zipRight(fs.writeFile(paths.legacyMetadata, bridgeMetadataContents())),
          Effect.orDie,
        ),
      )
      expect(result.metadataPresent).toBe(true)
      expect(result.status).toBe("stale")
      expect(result.issue).toBe("partial-install")
    }),
  )
})
