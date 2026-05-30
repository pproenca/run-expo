/**
 * AC-006 — bridge storage/state/controls actions: reads ungated, mutates gated,
 * allowed values redacted + size-bounded, plus the defense-in-depth re-check.
 *
 * The bridge is a COUNTING fake `BridgeTransport`; a denied mutate must invoke
 * the bridge 0× (capability withheld).
 */
import { describe, expect, it } from "@effect/vitest"
import { redact, REDACTED } from "@expo98/core"
import {
  type DomainActionEvidence,
  domainActionSideEffect,
  MAX_ARRAY_ITEMS,
  runDomainAction,
} from "@expo98/expo-integration"
import { Effect, Layer, Ref } from "effect"
import { BridgeTransport } from "../src/bridge-transport.js"

const makeBridge = (calls: Ref.Ref<number>, value: unknown = { ok: true }) =>
  Layer.succeed(
    BridgeTransport,
    BridgeTransport.of({
      call: () => Ref.update(calls, (n) => n + 1).pipe(Effect.as({ available: true, value })),
    }),
  )

describe("AC-006 bridge storage/state/controls gating", () => {
  it("AC-006 classifier: storage list/get=read else device; state list=read else device; controls press=device else read", () => {
    expect(domainActionSideEffect("storage", "list")).toBe("read")
    expect(domainActionSideEffect("storage", "get")).toBe("read")
    expect(domainActionSideEffect("storage", "set")).toBe("device")
    expect(domainActionSideEffect("storage", "clear")).toBe("device")
    expect(domainActionSideEffect("state", "list")).toBe("read")
    expect(domainActionSideEffect("state", "save")).toBe("device")
    expect(domainActionSideEffect("controls", "press")).toBe("device")
    expect(domainActionSideEffect("controls", "describe")).toBe("read")
  })

  it.effect("AC-006 storage list (read) runs UNGATED with no policy and is tagged", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const result = yield* runDomainAction({
        domain: "storage",
        action: "list",
        metroPort: 8081,
        target: "iphone:app",
        policy: {},
      }).pipe(Effect.provide(makeBridge(calls)))
      const ev = result as DomainActionEvidence
      expect(ev.domain).toBe("storage")
      expect(ev.action).toBe("list")
      expect(ev.sideEffect).toBe("read")
      expect(ev.metroPort).toBe(8081)
      expect(ev.target).toBe("iphone:app")
      expect(ev.transport).toBe("expo-devtools-bridge")
      expect(ev.evidenceSource).toBe("bridge")
      expect(ev.available).toBe(true)
      expect(yield* Ref.get(calls)).toBe(1)
    }),
  )

  for (const [domain, action] of [
    ["storage", "set"],
    ["state", "save"],
    ["controls", "press"],
  ] as const) {
    it.effect(`AC-006 ${domain} ${action} (mutate) is DENIED without policy and the bridge is invoked 0×`, () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0)
        const result = yield* runDomainAction({
          domain,
          action,
          policy: {},
        }).pipe(Effect.provide(makeBridge(calls)))
        const payload = result as { code?: string; denied?: boolean }
        expect(payload.code).toBe("policy-denied")
        expect(payload.denied).toBe(true)
        // Capability withheld: the bridge was NEVER consulted for a denied mutate.
        expect(yield* Ref.get(calls)).toBe(0)
      }),
    )
  }

  it.effect("AC-006 storage set WITH policy allow runs and returns bounded evidence", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const result = yield* runDomainAction({
        domain: "storage",
        action: "set",
        args: { key: "k", value: "v" },
        policy: { allow: ["storage.set"] },
      }).pipe(Effect.provide(makeBridge(calls, { written: true })))
      const ev = result as DomainActionEvidence
      expect(ev.sideEffect).toBe("device")
      expect(ev.available).toBe(true)
      expect(ev.value).toEqual({ written: true })
      expect(yield* Ref.get(calls)).toBe(1)
    }),
  )

  it.effect("AC-006 controls press WITH policy allow invokes the bridge once", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const result = yield* runDomainAction({
        domain: "controls",
        action: "press",
        policy: { allow: ["controls.press"] },
      }).pipe(Effect.provide(makeBridge(calls, { pressed: "ok" })))
      const ev = result as DomainActionEvidence
      expect(ev.available).toBe(true)
      expect(yield* Ref.get(calls)).toBe(1)
    }),
  )

  it.effect("AC-006 allowed value is size-bounded — arrays capped to MAX_ARRAY_ITEMS", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const big = Array.from({ length: MAX_ARRAY_ITEMS + 50 }, (_, i) => i)
      const result = yield* runDomainAction({
        domain: "storage",
        action: "list",
        policy: {},
      }).pipe(Effect.provide(makeBridge(calls, big)))
      const ev = result as DomainActionEvidence
      const bounded = ev.value as { _bounded: string; kept: number; dropped: number; total: number }
      expect(bounded._bounded).toBe("array")
      expect(bounded.kept).toBe(MAX_ARRAY_ITEMS)
      expect(bounded.dropped).toBe(50)
      expect(bounded.total).toBe(MAX_ARRAY_ITEMS + 50)
    }),
  )

  it.effect("AC-006 the surfaced evidence is REDACTABLE at core's boundary (secret keys stripped)", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const result = yield* runDomainAction({
        domain: "storage",
        action: "get",
        policy: {},
      }).pipe(Effect.provide(makeBridge(calls, { authToken: "super-secret", id: 7 })))
      // Core's redactor (the single output boundary dispatch applies) strips secrets.
      const redacted = redact(result) as DomainActionEvidence & { value: { authToken: string; id: number } }
      expect(redacted.value.authToken).toBe(REDACTED)
      expect(redacted.value.id).toBe(7)
    }),
  )

  it.effect(
    "AC-006 defense-in-depth: even if the bridge is consulted, a non-read without allow never yields evidence (re-denied AFTER the call)",
    () =>
      Effect.gen(function* () {
        // A transport that REVOKES the allow after it is called — modelling a
        // policy that changed (or a classification drift) between the first gate
        // and the surfacing step. The second, independent gate must re-deny so the
        // bridge value is NEVER surfaced as evidence.
        const calls = yield* Ref.make(0)
        const policy = { allow: ["storage.set"] as Array<string> }
        const revoking = Layer.succeed(
          BridgeTransport,
          BridgeTransport.of({
            call: () =>
              Ref.update(calls, (n) => n + 1).pipe(
                // Mutate the shared policy object so the SECOND gate check sees no allow.
                Effect.tap(() => Effect.sync(() => (policy.allow = []))),
                Effect.as({ available: true, value: { leaked: "secret-value" } }),
              ),
          }),
        )
        const result = yield* runDomainAction({
          domain: "storage",
          action: "set",
          policy,
        }).pipe(Effect.provide(revoking))

        // The bridge WAS consulted (first gate passed), but the defense-in-depth
        // re-check re-denied → no evidence, no leaked value.
        const payload = result as { code?: string; denied?: boolean; value?: unknown }
        expect(yield* Ref.get(calls)).toBe(1)
        expect(payload.code).toBe("policy-denied")
        expect(payload.denied).toBe(true)
        expect(payload.value).toBeUndefined()
      }),
  )
})
