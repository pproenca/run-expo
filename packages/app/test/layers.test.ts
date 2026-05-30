import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { confinePath, SourceWriteCapability, Subprocess } from "@expo98/core"
import { Effect, Layer } from "effect"
import { AppLayer, NodeSubprocessLayer, PlatformLayer } from "../src/index"

const LiveSubprocess = NodeSubprocessLayer.pipe(Layer.provide(PlatformLayer))

describe("App layers — subprocess containment (AC-053)", () => {
  it.effect("AC-053 enforces maxBuffer while collecting stdout", () =>
    Effect.gen(function* () {
      const subprocess = yield* Subprocess
      const result = yield* Effect.either(
        subprocess.run(process.execPath, ["-e", "process.stdout.write('x'.repeat(20))"], { maxBuffer: 5 }),
      )
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("SubprocessFailed")
        if (result.left._tag !== "SubprocessFailed") return
        expect(result.left.stderr).toContain("maxBuffer 5")
      }
    }).pipe(Effect.provide(LiveSubprocess)),
  )

  it.effect("AC-053 enforces the per-call timeout", () =>
    Effect.gen(function* () {
      const subprocess = yield* Subprocess
      const result = yield* Effect.either(
        subprocess.run(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], { timeoutMs: 10 }),
      )
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("SubprocessTimeout")
        if (result.left._tag !== "SubprocessTimeout") return
        expect(result.left.timeoutMs).toBe(10)
      }
    }).pipe(Effect.provide(LiveSubprocess)),
  )
})

describe("App layers — source-write containment (AC-008)", () => {
  it.effect("AC-008 rejects writes through a symlinked ancestor", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "run-expo-root-"))
      const outside = mkdtempSync(join(tmpdir(), "run-expo-outside-"))
      const link = join(root, "src")
      symlinkSync(outside, link, "dir")
      try {
        const cap = yield* SourceWriteCapability
        const target = yield* confinePath(root, join(link, "expo98-devtools-bridge.ts"))
        const exit = yield* Effect.exit(cap.writeFile(target, "secret"))
        expect(exit._tag).toBe("Failure")
        expect(existsSync(join(outside, "expo98-devtools-bridge.ts"))).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
        rmSync(outside, { recursive: true, force: true })
      }
    }).pipe(Effect.provide(AppLayer)),
  )

  it.effect("AC-008 deleteFile is file-only, not recursive subtree deletion", () =>
    Effect.gen(function* () {
      const root = mkdtempSync(join(tmpdir(), "run-expo-root-"))
      const dir = join(root, "src")
      const child = join(dir, "keep.txt")
      mkdirSync(dir)
      writeFileSync(child, "keep")
      try {
        const cap = yield* SourceWriteCapability
        const confinedDir = yield* confinePath(root, dir)
        const exit = yield* Effect.exit(cap.deleteFile(confinedDir))
        expect(exit._tag).toBe("Failure")
        expect(existsSync(child)).toBe(true)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }).pipe(Effect.provide(AppLayer)),
  )
})
