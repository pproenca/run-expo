/**
 * AC-030 — CDP/WebSocket connections are loopback, id-correlated, time-bounded.
 *
 * The AC-030 FIX is the loopback enforcement on `webSocketDebuggerUrl` BEFORE connecting. The core
 * of that fix is a PURE allowlist check (`checkLoopbackUrl` / `assertLoopbackUrl`) tested
 * exhaustively here — reject non-loopback BEFORE any socket opens. We also assert the Origin header
 * value computation and the bounded-open `min(timeoutMs, 2500)`.
 *
 * A fake {@link CdpSocketFactory} proves: (a) non-loopback candidates are NEVER passed to connect;
 * (b) the Origin + openTimeout the factory receives match the contract; (c) the enable->evaluate
 * id-correlated round trip + malformed-JSON truncation + all-attempts-fail diagnostics.
 *
 * Live Hermes round-trips are it.skip'd (need a running target).
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Queue } from "effect";
import {
  assertLoopbackUrl,
  boundedOpenMs,
  CdpSocketFactory,
  type CdpConnectOptions,
  type CdpSocket,
  checkLoopbackUrl,
  HermesEvidence,
  HermesEvidenceLayer,
  HermesRuntimeEval,
  HermesRuntimeEvalLayer,
  isLoopbackHost,
  originForPort,
} from "../src/index.js";

// ------------------------------------------------------------------------------------------------
// PURE: loopback allowlist on the webSocketDebuggerUrl (the AC-030 FIX core)
// ------------------------------------------------------------------------------------------------

describe("AC-030 loopback enforcement (PURE) — reject non-loopback BEFORE connect", () => {
  it("accepts every loopback host spelling", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LocalHost")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });

  it("rejects non-loopback hosts (no expansion — the AC-030 fix vs legacy)", () => {
    expect(isLoopbackHost("evil.com")).toBe(false);
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
    expect(isLoopbackHost("192.168.1.5")).toBe(false);
    expect(isLoopbackHost("169.254.169.254")).toBe(false); // cloud metadata SSRF target
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.evil.com")).toBe(false);
  });

  it("checkLoopbackUrl: accepts loopback ws/wss URLs, rejects the rest with a reason", () => {
    expect(checkLoopbackUrl("ws://127.0.0.1:8081/inspector/debug?page=1").ok).toBe(true);
    expect(checkLoopbackUrl("ws://localhost:8081/debug").ok).toBe(true);
    expect(checkLoopbackUrl("ws://[::1]:8081/debug").ok).toBe(true);

    const bad = checkLoopbackUrl("ws://evil.com:8081/debug");
    expect(bad.ok).toBe(false);
    expect(bad.host).toBe("evil.com");
    expect(bad.reason).toContain("non-loopback");

    const unparsable = checkLoopbackUrl("not a url");
    expect(unparsable.ok).toBe(false);
    expect(unparsable.host).toBeNull();
  });

  it.effect("assertLoopbackUrl: succeeds on loopback, fails LoopbackViolation on non-loopback", () =>
    Effect.gen(function* () {
      const okUrl = yield* assertLoopbackUrl("ws://127.0.0.1:8081/debug");
      expect(okUrl).toBe("ws://127.0.0.1:8081/debug");

      const failure = yield* assertLoopbackUrl("ws://10.0.0.1:8081/debug").pipe(Effect.flip);
      expect(failure._tag).toBe("LoopbackViolation");
      expect(failure.host).toBe("10.0.0.1");
    }),
  );
});

// ------------------------------------------------------------------------------------------------
// PURE: Origin header value + bounded open
// ------------------------------------------------------------------------------------------------

describe("AC-030 Origin header value + bounded open (PURE)", () => {
  it("Origin is http://127.0.0.1:<clamped metroPort>", () => {
    expect(originForPort(8081)).toBe("http://127.0.0.1:8081");
    expect(originForPort(undefined)).toBe("http://127.0.0.1:8081");
    expect(originForPort(19000)).toBe("http://127.0.0.1:19000");
    expect(originForPort(0)).toBe("http://127.0.0.1:1"); // clamped
  });

  it("bounded open = min(timeoutMs, 2500)", () => {
    expect(boundedOpenMs(8000)).toBe(2500);
    expect(boundedOpenMs(2500)).toBe(2500);
    expect(boundedOpenMs(1000)).toBe(1000);
    expect(boundedOpenMs(0)).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------
// Fake CdpSocketFactory — assert connect-time contract + round trip via the split surfaces
// ------------------------------------------------------------------------------------------------

interface FakeRecorder {
  readonly connects: CdpConnectOptions[];
  readonly sent: string[];
}

/**
 * A fake factory that scripts responses keyed by request `method`. Records every connect() call so
 * we can assert non-loopback urls are never connected and the Origin/openTimeout are correct.
 */
const fakeFactory = (rec: FakeRecorder, script: (method: string, id: number) => unknown) =>
  Layer.succeed(CdpSocketFactory, {
    connect: (options) =>
      Effect.gen(function* () {
        rec.connects.push(options);
        const inbound = yield* Queue.unbounded<string | null>();
        const socket: CdpSocket = {
          send: (frame) =>
            Effect.gen(function* () {
              rec.sent.push(frame);
              const parsed = JSON.parse(frame) as { id: number; method: string };
              const result = script(parsed.method, parsed.id);
              // echo a correlated response frame
              yield* Queue.offer(inbound, JSON.stringify({ id: parsed.id, result }));
            }),
          receive: Queue.take(inbound),
          close: Effect.void,
        };
        return socket;
      }),
  });

describe("AC-030 CDP round trip (fake socket) — Origin, bounded open, id-correlation", () => {
  it.effect("non-loopback candidates are never connected; loopback Origin + openTimeout asserted", () => {
    const rec: FakeRecorder = { connects: [], sent: [] };
    // Script: Runtime.evaluate returns the returnByValue shape { result: { value } }.
    const layer = fakeFactory(rec, (method) =>
      method === "Runtime.evaluate" ? { result: { value: 42 } } : {},
    );
    return Effect.gen(function* () {
      const evidence = yield* HermesEvidence;
      const res = yield* evidence.evaluateReadOnly("globalThis.x", {
        attemptedUrls: [
          "ws://evil.com:8081/debug", // must be SKIPPED, never connected
          "ws://127.0.0.1:8081/inspector/debug?page=1", // loopback, used
        ],
        metroPort: 8081,
        timeoutMs: 8000,
      });

      expect(res.available).toBe(true);
      if (res.available) expect(res.result.value).toBe(42);

      // Only the loopback url was ever connected.
      expect(rec.connects.length).toBe(1);
      expect(rec.connects[0]!.url).toBe("ws://127.0.0.1:8081/inspector/debug?page=1");
      // Origin header value (AC-030).
      expect(rec.connects[0]!.origin).toBe("http://127.0.0.1:8081");
      // Bounded open = min(8000, 2500).
      expect(rec.connects[0]!.openTimeoutMs).toBe(2500);

      // id-correlation: enable then evaluate, incrementing ids.
      const ids = rec.sent.map((f) => (JSON.parse(f) as { id: number; method: string }));
      expect(ids[0]).toMatchObject({ id: 1, method: "Runtime.enable" });
      expect(ids[1]).toMatchObject({ id: 2, method: "Runtime.evaluate" });
    }).pipe(Effect.provide(HermesEvidenceLayer.pipe(Layer.provide(layer))));
  });

  it.effect("all candidates non-loopback -> unavailable with diagnostics.attemptedUrls", () => {
    const rec: FakeRecorder = { connects: [], sent: [] };
    const layer = fakeFactory(rec, () => ({}));
    return Effect.gen(function* () {
      const evidence = yield* HermesEvidence;
      const attemptedUrls = ["ws://evil.com/debug", "ws://10.0.0.1/debug"];
      const res = yield* evidence.evaluateReadOnly("x", { attemptedUrls, metroPort: 8081 });
      expect(res.available).toBe(false);
      if (!res.available) {
        expect(res.diagnostics.attemptedUrls).toEqual(attemptedUrls);
      }
      // Zero connects — every candidate was rejected before connect (the AC-030 fix).
      expect(rec.connects.length).toBe(0);
    }).pipe(Effect.provide(HermesEvidenceLayer.pipe(Layer.provide(layer))));
  });

  it.effect("the split runtime-eval surface shares the same engine (Origin + correlation)", () => {
    const rec: FakeRecorder = { connects: [], sent: [] };
    const layer = fakeFactory(rec, (method) =>
      method === "Runtime.evaluate" ? { result: { value: "ok" } } : {},
    );
    return Effect.gen(function* () {
      const runtimeEval = yield* HermesRuntimeEval;
      const res = yield* runtimeEval.evaluate("doMutation()", {
        attemptedUrls: ["ws://localhost:19000/debug"],
        metroPort: 19000,
      });
      expect(res.available).toBe(true);
      expect(rec.connects[0]!.origin).toBe("http://127.0.0.1:19000");
    }).pipe(Effect.provide(HermesRuntimeEvalLayer.pipe(Layer.provide(layer))));
  });

  it.effect("malformed JSON frame -> attempt fails (truncation path) -> unavailable", () => {
    const rec: FakeRecorder = { connects: [], sent: [] };
    // A factory whose socket emits a NON-JSON frame for the enable response.
    const layer = Layer.succeed(CdpSocketFactory, {
      connect: (options) =>
        Effect.gen(function* () {
          rec.connects.push(options);
          const inbound = yield* Queue.unbounded<string | null>();
          const socket: CdpSocket = {
            send: (frame) =>
              Effect.gen(function* () {
                rec.sent.push(frame);
                yield* Queue.offer(inbound, "}{ this is not valid json".repeat(80));
              }),
            receive: Queue.take(inbound),
            close: Effect.void,
          };
          return socket;
        }),
    });
    return Effect.gen(function* () {
      const evidence = yield* HermesEvidence;
      const res = yield* evidence.evaluateReadOnly("x", {
        attemptedUrls: ["ws://127.0.0.1:8081/debug"],
        metroPort: 8081,
      });
      // Single loopback candidate that yields a malformed frame -> all attempts fail.
      expect(res.available).toBe(false);
      if (!res.available) expect(res.diagnostics.attemptedUrls).toEqual(["ws://127.0.0.1:8081/debug"]);
    }).pipe(Effect.provide(HermesEvidenceLayer.pipe(Layer.provide(layer))));
  });

  // ---- live-only paths (need a running Hermes target) ----
  it.skip("AC-030 live Runtime.evaluate round-trip — needs running Hermes target", () => {});
  it.skip("AC-030 live malformed-frame truncation to 1000 chars (raw preview) — needs running Hermes target", () => {});
});
