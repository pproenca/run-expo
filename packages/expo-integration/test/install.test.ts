/**
 * AC-008 — bridge install/remove require an explicit confirmation token.
 *
 * Run THROUGH core's dispatch (inside `bridgeInstall`/`bridgeRemove`) with a
 * COUNTING `SourceWriteCapability` + an in-memory `Fs`:
 *   - no token            → ZERO file writes/deletes, `requiredConfirmation`,
 *                           current `status`, and `plan`. The SourceWriteCapability
 *                           is invoked 0× (THE denial assertion).
 *   - matching token+allow → install writes `.expo98/bridge.json` +
 *                           `src/expo98-devtools-bridge.ts`; remove deletes both
 *                           (+ the legacy `.expo-ios/bridge.json` fallback).
 */
import { describe, expect, it } from "@effect/vitest"
import { SourceWriteCapability } from "@expo98/core"
import { Fs, makeMemoryFs } from "@expo98/domain"
import {
  bridgeFilePaths,
  bridgeInstall,
  BRIDGE_INSTALL_TOKEN,
  bridgeRemove,
  BRIDGE_REMOVE_TOKEN,
  type BridgeConfirmationRequired,
  type BridgeWriteResult,
} from "@expo98/expo-integration"
import { Effect, Layer, Ref } from "effect"

const ROOT = "/proj"
const paths = bridgeFilePaths(ROOT)

interface SwCounters {
  readonly writes: Ref.Ref<ReadonlyArray<string>>
  readonly deletes: Ref.Ref<ReadonlyArray<string>>
  readonly calls: Ref.Ref<number>
}

const makeCounters = Effect.all({
  writes: Ref.make<ReadonlyArray<string>>([]),
  deletes: Ref.make<ReadonlyArray<string>>([]),
  calls: Ref.make(0),
})

/**
 * Build a Layer where SourceWriteCapability ALSO writes through a real in-memory
 * `Fs` (so we can verify the files materialise) AND counts invocations (so denial
 * can assert zero capability calls).
 */
const makeLayer = (c: SwCounters, fs: Fs["Type"]) =>
  Layer.merge(
    Layer.succeed(Fs, fs),
    Layer.succeed(
      SourceWriteCapability,
      SourceWriteCapability.of({
        writeFile: (path, contents) =>
          Ref.update(c.calls, (n) => n + 1).pipe(
            Effect.zipRight(Ref.update(c.writes, (xs) => [...xs, path])),
            Effect.zipRight(fs.writeFile(path, contents).pipe(Effect.orDie)),
          ),
        deleteFile: (path) =>
          Ref.update(c.calls, (n) => n + 1).pipe(
            Effect.zipRight(Ref.update(c.deletes, (xs) => [...xs, path])),
            Effect.zipRight(fs.remove(path).pipe(Effect.orDie)),
          ),
      }),
    ),
  )

const seedExpo = (fs: Fs["Type"]) =>
  fs.writeFile(`${ROOT}/package.json`, JSON.stringify({ dependencies: { expo: "54.0.0" } })).pipe(Effect.orDie)

describe("AC-008 bridge install/remove require a confirmation token", () => {
  it.effect(
    "AC-008 install with NO token writes ZERO files and returns requiredConfirmation/status/plan (SourceWriteCapability invoked 0×)",
    () =>
      Effect.gen(function* () {
        const c = yield* makeCounters
        const fs = yield* makeMemoryFs()
        yield* seedExpo(fs)

        // No policy / no confirmation token.
        const result = yield* bridgeInstall(ROOT, {}).pipe(Effect.provide(makeLayer(c, fs)))

        const payload = result.payload as BridgeConfirmationRequired
        expect(payload.applied).toBe(false)
        expect(payload.requiredConfirmation).toBe(BRIDGE_INSTALL_TOKEN)
        expect(payload.status.status).toBe("absent")
        expect(payload.plan.action).toBe(BRIDGE_INSTALL_TOKEN)
        expect(payload.plan.writes).toEqual([paths.metadata, paths.source])

        // THE denial assertion: the write capability was invoked 0×.
        expect(yield* Ref.get(c.calls)).toBe(0)
        expect(yield* Ref.get(c.writes)).toEqual([])
        // And nothing materialised on disk.
        expect(yield* fs.exists(paths.metadata).pipe(Effect.orDie)).toBe(false)
        expect(yield* fs.exists(paths.source).pipe(Effect.orDie)).toBe(false)
      }),
  )

  it.effect("AC-008 install with allow but NO confirmation token still denies (0× writes)", () =>
    Effect.gen(function* () {
      const c = yield* makeCounters
      const fs = yield* makeMemoryFs()
      yield* seedExpo(fs)

      // Policy allows the action but the confirmation token is absent.
      const result = yield* bridgeInstall(ROOT, {
        allow: [BRIDGE_INSTALL_TOKEN],
      }).pipe(Effect.provide(makeLayer(c, fs)))

      const payload = result.payload as BridgeConfirmationRequired
      expect(payload.applied).toBe(false)
      expect(payload.requiredConfirmation).toBe(BRIDGE_INSTALL_TOKEN)
      expect(yield* Ref.get(c.calls)).toBe(0)
    }),
  )

  it.effect("AC-008 install WITH allow + matching token writes bridge.json + the source file", () =>
    Effect.gen(function* () {
      const c = yield* makeCounters
      const fs = yield* makeMemoryFs()
      yield* seedExpo(fs)

      const result = yield* bridgeInstall(ROOT, {
        allow: [BRIDGE_INSTALL_TOKEN],
        confirmations: [BRIDGE_INSTALL_TOKEN],
      }).pipe(Effect.provide(makeLayer(c, fs)))

      const payload = result.payload as BridgeWriteResult
      expect(payload.applied).toBe(true)
      expect(payload.written).toEqual([paths.metadata, paths.source])
      expect(yield* Ref.get(c.calls)).toBe(2)
      // Files materialised on disk.
      expect(yield* fs.exists(paths.metadata).pipe(Effect.orDie)).toBe(true)
      expect(yield* fs.exists(paths.source).pipe(Effect.orDie)).toBe(true)
      // The metadata is valid JSON with the right version.
      const meta = JSON.parse(yield* fs.readFile(paths.metadata).pipe(Effect.orDie)) as {
        bridgeVersion: string
        schemaVersion: number
        developmentOnly: boolean
      }
      expect(meta.bridgeVersion).toBe("1.0.0")
      expect(meta.schemaVersion).toBe(1)
      expect(meta.developmentOnly).toBe(true)
    }),
  )

  it.effect("AC-008 install followed by a fresh read reports `present`", () =>
    Effect.gen(function* () {
      const c = yield* makeCounters
      const fs = yield* makeMemoryFs()
      yield* seedExpo(fs)
      yield* bridgeInstall(ROOT, {
        allow: [BRIDGE_INSTALL_TOKEN],
        confirmations: [BRIDGE_INSTALL_TOKEN],
      }).pipe(Effect.provide(makeLayer(c, fs)))

      // A no-token install now reports the post-install status as `present`.
      const after = yield* bridgeInstall(ROOT, {}).pipe(Effect.provide(makeLayer(c, fs)))
      const payload = after.payload as BridgeConfirmationRequired
      expect(payload.status.status).toBe("present")
    }),
  )

  it.effect("AC-008 remove with NO token deletes ZERO files (0× capability calls)", () =>
    Effect.gen(function* () {
      const c = yield* makeCounters
      const fs = yield* makeMemoryFs()
      yield* seedExpo(fs)
      // Pre-install both files directly.
      const { bridgeMetadataContents, bridgeSourceContents } = yield* Effect.promise(
        () => import("@expo98/expo-integration"),
      )
      yield* fs.writeFile(paths.metadata, bridgeMetadataContents()).pipe(Effect.orDie)
      yield* fs.writeFile(paths.source, bridgeSourceContents()).pipe(Effect.orDie)

      const result = yield* bridgeRemove(ROOT, {}).pipe(Effect.provide(makeLayer(c, fs)))
      const payload = result.payload as BridgeConfirmationRequired
      expect(payload.applied).toBe(false)
      expect(payload.requiredConfirmation).toBe(BRIDGE_REMOVE_TOKEN)
      expect(payload.status.status).toBe("present")
      expect(payload.plan.deletes).toEqual([paths.metadata, paths.source, paths.legacyMetadata])
      // Denial assertion: zero capability calls, files still present.
      expect(yield* Ref.get(c.calls)).toBe(0)
      expect(yield* fs.exists(paths.metadata).pipe(Effect.orDie)).toBe(true)
      expect(yield* fs.exists(paths.source).pipe(Effect.orDie)).toBe(true)
    }),
  )

  it.effect("AC-008 remove WITH allow + token deletes both files plus the legacy .expo-ios fallback", () =>
    Effect.gen(function* () {
      const c = yield* makeCounters
      const fs = yield* makeMemoryFs()
      yield* seedExpo(fs)
      const { bridgeMetadataContents, bridgeSourceContents } = yield* Effect.promise(
        () => import("@expo98/expo-integration"),
      )
      yield* fs.writeFile(paths.metadata, bridgeMetadataContents()).pipe(Effect.orDie)
      yield* fs.writeFile(paths.source, bridgeSourceContents()).pipe(Effect.orDie)
      // A leftover legacy install too.
      yield* fs.writeFile(paths.legacyMetadata, bridgeMetadataContents()).pipe(Effect.orDie)

      const result = yield* bridgeRemove(ROOT, {
        allow: [BRIDGE_REMOVE_TOKEN],
        confirmations: [BRIDGE_REMOVE_TOKEN],
      }).pipe(Effect.provide(makeLayer(c, fs)))

      const payload = result.payload as BridgeWriteResult
      expect(payload.applied).toBe(true)
      expect(payload.deleted).toEqual([paths.metadata, paths.source, paths.legacyMetadata])
      expect(yield* Ref.get(c.calls)).toBe(3)
      expect(yield* fs.exists(paths.metadata).pipe(Effect.orDie)).toBe(false)
      expect(yield* fs.exists(paths.source).pipe(Effect.orDie)).toBe(false)
      expect(yield* fs.exists(paths.legacyMetadata).pipe(Effect.orDie)).toBe(false)
    }),
  )

  it.skip("AC-008 live install delivers the bridge to a running Expo dev client (Expo DevTools Plugins SDK seam)", () => {
    // Requires the TARGET project's Expo install + a running dev client.
  })
})
