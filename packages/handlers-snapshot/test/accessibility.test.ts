/**
 * AC-023 — accessibility audit flags interactive refs lacking a name.
 *
 * A cached ref with `actions.length > 0` AND no `label` AND no `text` is flagged
 * `{ ref, rule:"interactive-name", message:"Interactive ref has no label or text." }`.
 * With NO snapshot/ref cache, the result is `available:false`. We assert the rule
 * (including the negative cases that must NOT flag) and the no-cache edge, both
 * via the pure projection and END-TO-END through core's `dispatch` (read path,
 * runs ungated).
 */
import { describe, expect, it } from "@effect/vitest"
import { DeviceCapability, dispatch, RuntimeEvalCapability, SourceWriteCapability } from "@expo98/core"
import type { RefCache, RefRecord } from "@expo98/domain"
import {
  accessibilityCommand,
  type AccessibilityAuditResult,
  accessibilityResult,
  type AccessibilityUnavailable,
  INTERACTIVE_NAME_MESSAGE,
  isInteractiveUnnamed,
} from "@expo98/handlers-snapshot"
import { Effect, Layer } from "effect"

const Caps = Layer.mergeAll(
  Layer.succeed(RuntimeEvalCapability, RuntimeEvalCapability.of({ evaluate: () => Effect.succeed(null) })),
  Layer.succeed(DeviceCapability, DeviceCapability.of({ invoke: () => Effect.succeed("ok") })),
  Layer.succeed(
    SourceWriteCapability,
    SourceWriteCapability.of({ writeFile: () => Effect.void, deleteFile: () => Effect.void }),
  ),
)

const ref = (over: Omit<Partial<RefRecord>, "ref"> & { ref: string }): RefRecord => ({
  snapshotId: "snapshot-1" as RefRecord["snapshotId"],
  targetId: "ios:dev:app:8081" as RefRecord["targetId"],
  stale: false,
  role: null,
  label: null,
  text: null,
  placeholder: null,
  testID: null,
  nativeID: null,
  component: null,
  box: null,
  actions: [],
  ...over,
  ref: over.ref as RefRecord["ref"],
})

const cache = (refs: ReadonlyArray<RefRecord>): RefCache => ({
  snapshotId: "snapshot-1" as RefCache["snapshotId"],
  targetId: "ios:dev:app:8081" as RefCache["targetId"],
  source: ["semantic-bridge"],
  refs,
})

describe("AC-023 interactive-name rule (pure)", () => {
  it("AC-023 flags a ref with actions but no label and no text", () => {
    expect(isInteractiveUnnamed(ref({ ref: "@e1", actions: ["press"] }))).toBe(true)
  })

  it("AC-023 does NOT flag a named interactive ref (has a label)", () => {
    expect(isInteractiveUnnamed(ref({ ref: "@e1", actions: ["press"], label: "Submit" }))).toBe(false)
  })

  it("AC-023 does NOT flag a named interactive ref (has text)", () => {
    expect(isInteractiveUnnamed(ref({ ref: "@e1", actions: ["press"], text: "OK" }))).toBe(false)
  })

  it("AC-023 does NOT flag a non-interactive unnamed ref (no actions)", () => {
    expect(isInteractiveUnnamed(ref({ ref: "@e1", actions: [] }))).toBe(false)
  })

  it("AC-023 treats an empty-string label/text as unnamed (still flagged)", () => {
    expect(isInteractiveUnnamed(ref({ ref: "@e1", actions: ["press"], label: "", text: "" }))).toBe(true)
  })
})

describe("AC-023 audit projection", () => {
  it("AC-023 emits one interactive-name finding per unnamed interactive ref", () => {
    const result = accessibilityResult(
      "audit",
      cache([
        ref({ ref: "@e1", actions: ["press"] }), // flagged
        ref({ ref: "@e2", actions: ["press"], label: "Named" }), // ok
        ref({ ref: "@e3", actions: [] }), // ok (no actions)
        ref({ ref: "@e4", actions: ["scroll"] }), // flagged
      ]),
    ) as AccessibilityAuditResult
    expect(result.available).toBe(true)
    expect(result.findings).toEqual([
      { ref: "@e1", rule: "interactive-name", message: INTERACTIVE_NAME_MESSAGE },
      { ref: "@e4", rule: "interactive-name", message: INTERACTIVE_NAME_MESSAGE },
    ])
  })

  it("AC-023 no ref cache → available:false (both verbs)", () => {
    const audit = accessibilityResult("audit", null) as AccessibilityUnavailable
    const tree = accessibilityResult("tree", null) as AccessibilityUnavailable
    expect(audit.available).toBe(false)
    expect(tree.available).toBe(false)
  })
})

describe("AC-023 audit through dispatch (read path, ungated)", () => {
  it.effect("AC-023 audit flags unnamed interactive refs end-to-end", () =>
    Effect.gen(function* () {
      const cmd = accessibilityCommand("audit", cache([ref({ ref: "@e1", actions: ["press"] })]))
      const result = yield* dispatch(cmd, {}).pipe(Effect.provide(Caps))
      const payload = result.payload as AccessibilityAuditResult
      expect(payload.available).toBe(true)
      expect(payload.findings[0]?.rule).toBe("interactive-name")
      expect(payload.findings[0]?.message).toBe(INTERACTIVE_NAME_MESSAGE)
    }),
  )

  it.effect("AC-023 audit with no cache → available:false end-to-end", () =>
    Effect.gen(function* () {
      const cmd = accessibilityCommand("audit", null)
      const result = yield* dispatch(cmd, {}).pipe(Effect.provide(Caps))
      const payload = result.payload as AccessibilityUnavailable
      expect(payload.available).toBe(false)
    }),
  )
})
