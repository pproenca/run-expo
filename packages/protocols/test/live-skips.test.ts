/**
 * Live-only paths that require a real Metro bundler / Hermes target running on loopback.
 * These are it.skip'd in CI; tagged with the AC id so coverage is tracked from day one.
 *
 * To run locally: start Metro + a dev app, then convert the relevant `it.skip` to `it.effect`
 * wiring the real `@effect/platform` HttpClient adapter (Metro) and `WsCdpSocketFactoryLayer` (CDP).
 */
import { describe, it } from "@effect/vitest";

describe("live-only protocol paths (skipped — need a running Metro/Hermes)", () => {
  it.skip("AC-021 live Metro fetch against a running packager (/status,/json/list,/json/version)", () => {});
  it.skip("AC-021 live POST /symbolicate against a running packager", () => {});
  it.skip("AC-030 live CDP round-trip via WsCdpSocketFactoryLayer against a real Hermes target", () => {});
});
