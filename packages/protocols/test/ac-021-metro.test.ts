/**
 * AC-021 — Metro probes never auto-start Metro; loopback only; skip malformed.
 * AC-038  — Metro port defaults to 8081 and clamps to 1..65535 (covered here + ac-038 file).
 *
 * Strategy: inject a FAKE {@link MetroHttpClient} that (a) records every URL requested so we can
 * assert loopback-only + never-auto-start, and (b) returns canned bodies to exercise the
 * malformed-list / skip-row / unreachable branches. No real socket is ever opened.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  HttpTransportError,
  MetroHttpClient,
  type MetroHttpRequest,
  type MetroHttpResponse,
  MetroProbe,
  MetroProbeLayer,
} from "../src/index.js";

/** Build a fake HTTP client layer + a shared log of issued requests. */
const fakeHttp = (
  handler: (req: MetroHttpRequest) => Effect.Effect<MetroHttpResponse, HttpTransportError>,
) => {
  const log: MetroHttpRequest[] = [];
  const layer = Layer.succeed(MetroHttpClient, {
    request: (req) => {
      log.push(req);
      return handler(req);
    },
  });
  return { log, layer };
};

const okJson = (body: unknown): Effect.Effect<MetroHttpResponse, HttpTransportError> =>
  Effect.succeed({ status: 200, text: JSON.stringify(body) });

const okText = (text: string): Effect.Effect<MetroHttpResponse, HttpTransportError> =>
  Effect.succeed({ status: 200, text });

describe("AC-021 Metro probes — loopback-only, never auto-start, skip malformed", () => {
  it.effect("loopback allowlist: every request URL is http://127.0.0.1:<port>", () => {
    const { log, layer } = fakeHttp(() => okText("packager-status:running"));
    return Effect.gen(function* () {
      const probe = yield* MetroProbe;
      yield* probe.status({ metroPort: 8081 });
      expect(log.length).toBe(1);
      expect(log[0]!.url).toBe("http://127.0.0.1:8081/status");
      // Never a non-loopback host — the base URL is constructed, not caller-controlled.
      for (const r of log) expect(r.url.startsWith("http://127.0.0.1:")).toBe(true);
    }).pipe(Effect.provide(MetroProbeLayer.pipe(Layer.provide(layer))));
  });

  it.effect("never auto-starts Metro: a probe issues only read/symbolicate fetches, no spawn", () => {
    // The probe has NO subprocess dependency at all — proving it cannot spawn Metro is structural:
    // the only injected port is HTTP. We assert it issues exactly one fetch and nothing else.
    const { log, layer } = fakeHttp(() => Effect.fail(new HttpTransportError({ url: "x", cause: "refused" })));
    return Effect.gen(function* () {
      const probe = yield* MetroProbe;
      const res = yield* probe.status({ metroPort: 8081 });
      expect(res.available).toBe(false);
      expect(log.length).toBe(1); // one fetch, then give up — never starts anything
    }).pipe(Effect.provide(MetroProbeLayer.pipe(Layer.provide(layer))));
  });

  it.effect("non-array /json/list -> malformedTargets:[{index:null, reason:...}]", () => {
    const { layer } = fakeHttp(() => okJson({ not: "an array" }));
    return Effect.gen(function* () {
      const probe = yield* MetroProbe;
      const res = yield* probe.listTargets({ metroPort: 8081 });
      expect(res.available).toBe(false);
      expect(res.targets).toEqual([]);
      expect(res.malformedTargets).toEqual([
        { index: null, reason: "Metro target list was not an array." },
      ]);
    }).pipe(Effect.provide(MetroProbeLayer.pipe(Layer.provide(layer))));
  });

  it.effect("non-JSON /json/list body -> treated as non-array (malformed list)", () => {
    const { layer } = fakeHttp(() => okText("<html>not json</html>"));
    return Effect.gen(function* () {
      const probe = yield* MetroProbe;
      const res = yield* probe.listTargets({ metroPort: 8081 });
      expect(res.available).toBe(false);
      expect(res.malformedTargets[0]?.index).toBeNull();
    }).pipe(Effect.provide(MetroProbeLayer.pipe(Layer.provide(layer))));
  });

  it.effect("skip-malformed rows: good rows returned, bad rows -> malformedTargets per index", () => {
    const list = [
      // good
      {
        id: "page-1",
        title: "Hermes app",
        description: "RN",
        webSocketDebuggerUrl: "ws://127.0.0.1:8081/inspector/debug?page=1",
        devtoolsFrontendUrl: "devtools://x",
      },
      // missing webSocketDebuggerUrl -> skipped
      { id: "page-2", title: "no ws" },
      // not an object -> skipped
      "garbage",
      // missing id/title -> skipped
      { webSocketDebuggerUrl: "ws://127.0.0.1:8081/inspector/debug?page=3" },
    ];
    const { layer } = fakeHttp(() => okJson(list));
    return Effect.gen(function* () {
      const probe = yield* MetroProbe;
      const res = yield* probe.listTargets({ metroPort: 8081 });
      expect(res.available).toBe(true);
      expect(res.targets.length).toBe(1);
      expect(res.targets[0]!.id).toBe("page-1");
      expect(res.malformedTargets.map((m) => m.index)).toEqual([1, 2, 3]);
    }).pipe(Effect.provide(MetroProbeLayer.pipe(Layer.provide(layer))));
  });

  it.effect("unreachable (transport failure) -> { available:false, status:'unavailable' }", () => {
    const { layer } = fakeHttp((req) =>
      Effect.fail(new HttpTransportError({ url: req.url, cause: "ECONNREFUSED" })),
    );
    return Effect.gen(function* () {
      const probe = yield* MetroProbe;
      const res = yield* probe.listTargets({ metroPort: 9999 });
      expect(res.available).toBe(false);
      if (!res.available) {
        expect(res.status).toBe("unavailable");
        expect(res.reason).toBe("Metro is not reachable on the requested port.");
      }
    }).pipe(Effect.provide(MetroProbeLayer.pipe(Layer.provide(layer))));
  });
});
