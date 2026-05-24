import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import {
  BridgeMetadata,
  OverlayEventsFile,
  RefCache,
  RunRecord,
  SessionRecord,
  SnapshotResult,
  TargetRecord,
} from "../src/entities.js"
import type { RefId, RunId, SessionId, SnapshotId, TargetId } from "../src/ids.js"
import { readSessionLenient } from "../src/migration.js"

/** encode -> decode equals the original (parse-don't-validate round trip). */
const roundtrip = <A, I>(schema: Schema.Schema<A, I>, value: A) =>
  Effect.gen(function* () {
    const encoded = yield* Schema.encode(schema)(value)
    const decoded = yield* Schema.decode(schema)(encoded)
    expect(decoded).toEqual(value)
  })

const TID = "ios:D:app:8081" as TargetId
const SID = "snapshot-a-aaaaaa" as SnapshotId

describe("Schema round-trip (encode -> decode === original)", () => {
  it.effect("SessionRecord", () =>
    roundtrip(SessionRecord, {
      schemaVersion: 1,
      sessionId: "review-2026-aaaaaa" as SessionId,
      name: "review",
      artifactDir: "/s/review-2026-aaaaaa/artifacts",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z",
      closedAt: "2026-05-24T01:00:00.000Z",
      activeTargetId: null,
      lastSnapshotId: null,
      sidecars: [{ name: "overlay", pid: 123, port: 17655, status: "running" }],
    }),
  )

  it.effect("TargetRecord", () =>
    roundtrip(TargetRecord, {
      targetId: TID,
      platform: "ios",
      device: { id: "D", name: null, state: "booted" },
      app: { bundleId: "app", processName: null, running: true },
      metro: {
        port: 8081,
        status: "running",
        targetId: "page-1",
        title: "T",
        appId: "app",
        debuggerUrl: "ws://127.0.0.1:8081/x",
      },
      selected: true,
      stale: false,
    }),
  )

  it.effect("SnapshotResult (with semanticBridge)", () =>
    roundtrip(SnapshotResult, {
      snapshotId: SID,
      targetId: TID,
      routeHint: "/home",
      source: ["axe", "semantic-bridge"],
      semanticBridge: {
        routeHint: "/home",
        refs: [{ ref: "@e1", role: "button", actions: ["tap"] }],
        limitations: ["partial"],
      },
      generatedAt: "2026-05-24T01:00:00.000Z",
      filters: {
        interactiveOnly: true,
        compact: false,
        depth: 10,
        includeSource: true,
        includeBounds: true,
      },
      refs: [
        {
          ref: "@e1" as RefId,
          snapshotId: SID,
          targetId: TID,
          stale: false,
          role: "button",
          label: "Go",
          text: null,
          placeholder: null,
          testID: null,
          nativeID: null,
          component: null,
          box: { x: 1, y: 2, width: 3, height: 4 },
          actions: ["tap"],
          disabled: false,
        },
      ],
      tree: [
        {
          ref: "@e1" as RefId,
          role: "button",
          label: "Go",
          text: null,
          testID: null,
          source: "axe",
          box: { x: 1, y: 2, width: 3, height: 4 },
          actions: ["tap"],
        },
      ],
      artifacts: { json: "/x.json", screenshot: null, annotatedScreenshot: null },
      limitations: [],
    }),
  )

  it.effect("RefCache", () =>
    roundtrip(RefCache, {
      snapshotId: SID,
      targetId: TID,
      source: ["axe"],
      refs: [],
    }),
  )

  it.effect("RunRecord (finished)", () =>
    roundtrip(RunRecord, {
      schemaVersion: 1,
      runId: "2026-aaaaaa" as RunId,
      cli: { name: "expo98", version: "1.0.0" },
      command: "snapshot",
      args: ["--json"],
      root: "/p",
      stateDir: "/p/.scratch/expo98",
      startedAt: "2026-05-24T00:00:00.000Z",
      finishedAt: "2026-05-24T00:00:01.000Z",
      status: "completed",
      exitCode: 0,
      summary: { keys: ["available", "refs"], available: true, routeCount: 2 },
      error: null,
    }),
  )

  it.effect("BridgeMetadata", () =>
    roundtrip(BridgeMetadata, {
      schemaVersion: 1,
      bridgeVersion: "1.0.0",
      developmentOnly: true,
      generatedBy: "expo98",
      domains: ["navigation", "network", "snapshot"],
    }),
  )

  it.effect("OverlayEventsFile", () =>
    roundtrip(OverlayEventsFile, {
      version: 1,
      title: "Review",
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:01:00.000Z",
      events: [{ id: "evt-1", createdAt: "2026-05-24T00:00:30.000Z", kind: "comment", payload: { note: "hi" } }],
    }),
  )
})

// ===========================================================================
// Lenient-read / strict-write migration shim (§5)
// ===========================================================================
describe("migration shim normalises a legacy-loose SessionRecord", () => {
  it.effect("missing closedAt / updatedAt / pointers + sidecars:unknown[] normalise", () =>
    Effect.gen(function* () {
      // A divergent legacy SessionRecord (target-management / snapshot-evidence
      // copies): no schemaVersion field guarantee, no closedAt, no updatedAt,
      // missing pointers, untyped sidecars.
      const legacy = {
        sessionId: "old-session-1",
        name: "Legacy Name That Is Quite Long".repeat(3), // >48 chars
        artifactDir: "/old/artifacts",
        createdAt: "2025-01-01T00:00:00.000Z",
        sidecars: [
          { name: "srv", pid: 1, port: 99, status: "running" },
          { name: "bad", status: "weird-status" }, // coerced to unknown
          "not-an-object", // dropped
        ],
      }

      const normalised = yield* readSessionLenient(legacy, "/old/session.json")

      // Normalised to the strict canonical struct.
      expect(normalised.schemaVersion).toBe(1)
      expect(normalised.updatedAt).toBe(normalised.createdAt) // filled from createdAt
      expect(normalised.closedAt).toBeUndefined()
      expect(normalised.activeTargetId).toBeNull()
      expect(normalised.lastSnapshotId).toBeNull()
      expect(normalised.name.length).toBe(48) // re-capped
      // sidecars normalised: object entries typed, junk dropped.
      expect(normalised.sidecars.length).toBe(2)
      expect(normalised.sidecars[0]).toEqual({
        name: "srv",
        pid: 1,
        port: 99,
        status: "running",
      })
      expect(normalised.sidecars[1]?.status).toBe("unknown") // coerced

      // The normalised value validates against the STRICT schema.
      yield* Schema.decode(SessionRecord)(yield* Schema.encode(SessionRecord)(normalised))
    }),
  )
})
