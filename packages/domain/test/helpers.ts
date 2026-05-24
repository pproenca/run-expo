import { Effect, Layer } from "effect"
import { Fs, makeMemoryFs } from "../src/fs-port.js"
import { PersistenceService, layer as persistenceLayer } from "../src/persist.js"
import type { Persistence, PersistenceClock } from "../src/persist.js"

/**
 * Deterministic clock for acceptance tests (AC-034 / AC-024).
 *
 * `nowIso` is settable so `session clean` cutoff math is reproducible; `suffix`
 * is a monotonically increasing fixed-width hex string so produced ids are
 * stable and assertable.
 */
export class TestClock implements PersistenceClock {
  private current: number
  private counter = 0
  constructor(startMs = Date.parse("2026-05-24T00:00:00.000Z")) {
    this.current = startMs
  }
  nowIso = (): string => new Date(this.current).toISOString()
  suffix = (): string => {
    this.counter += 1
    return this.counter.toString(16).padStart(6, "0")
  }
  /** Advance the simulated wall clock. */
  advance = (ms: number): void => {
    this.current += ms
  }
  set = (ms: number): void => {
    this.current = ms
  }
}

/**
 * Build a fresh in-memory `Persistence` + `Fs` layer pair plus the clock, so
 * each test runs against an isolated filesystem. Returns an Effect that yields
 * the live service and the clock handle for assertions.
 */
export const withPersistence = <A, E>(
  clock: TestClock,
  use: (p: Persistence) => Effect.Effect<A, E>,
): Effect.Effect<A, E> => {
  const fsLayer = Layer.effect(Fs, makeMemoryFs())
  const layer = persistenceLayer(clock).pipe(Layer.provide(fsLayer))
  return Effect.gen(function* () {
    const persistence = yield* PersistenceService
    return yield* use(persistence)
  }).pipe(Effect.provide(layer))
}

export const STATE_ROOT = "/tmp/expo98-test/.scratch/expo98"
