import { randomBytes } from "node:crypto"
import { Clock, Context, Effect, Layer } from "effect"

/**
 * S3 — Clock / Id. AC-034.
 *
 * Thin service for: (1) ONE unified timestamp format, and (2) collision-resistant
 * ids `<prefix>-<timestamp>-<suffix>`. Kept as a Layer ONLY so deterministic
 * time/ids make crash-grace and id tests reproducible (finding N1).
 *
 * Time is read through Effect's `Clock` so a `TestClock` can drive it; the
 * random suffix is read through an injectable `RandomBytes` so id generation is
 * deterministic under test.
 */

/** Single canonical timestamp format: ISO-8601 UTC with millisecond precision. */
export const formatTimestamp = (epochMillis: number): string => new Date(epochMillis).toISOString()

export interface IdService {
  /** Current time as the one canonical timestamp string. */
  readonly now: Effect.Effect<string>
  /** Current time as epoch milliseconds (for grace-window arithmetic, AC-056). */
  readonly nowMillis: Effect.Effect<number>
  /**
   * A collision-resistant id `<prefix>-<timestamp>-<suffix>`. The timestamp is
   * the unified format with separators stripped so it is filename-safe; the
   * suffix is a fixed-length lowercase-base36 random run (never <6 chars — the
   * legacy `slice(2,8)` defect, AC-034).
   */
  readonly generateId: (prefix: string) => Effect.Effect<string>
}

export class Id extends Context.Tag("@expo98/core/Id")<Id, IdService>() {}

/** Injectable randomness so ids are deterministic under test. */
export interface RandomBytesService {
  readonly nextSuffix: Effect.Effect<string>
}

export class RandomBytes extends Context.Tag("@expo98/core/RandomBytes")<RandomBytes, RandomBytesService>() {}

const SUFFIX_LEN = 10
const SUFFIX_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
const RANDOM_BYTE_REJECTION_LIMIT = 252

/**
 * Filesystem-safe timestamp for ids: the ISO-8601 *basic* form — drop all
 * separators (`:`, `.`, `-`) so e.g. `1970-01-01T00:00:00.000Z` → `19700101T000000000Z`.
 * Only applied inside generated ids; stored `createdAt`/`now` keep full ISO.
 */
const fsSafeTimestamp = (iso: string): string => iso.replace(/[:.-]/g, "")

/**
 * Production randomness layer: 10 chars of base36 derived from cryptographic
 * random bytes. Rejection sampling avoids modulo bias while preserving the
 * fixed-length suffix contract (AC-034).
 */
export const RandomBytesLive = Layer.succeed(
  RandomBytes,
  RandomBytes.of({
    nextSuffix: Effect.sync(() => {
      let s = ""
      while (s.length < SUFFIX_LEN) {
        for (const byte of randomBytes(SUFFIX_LEN)) {
          if (byte >= RANDOM_BYTE_REJECTION_LIMIT) continue
          s += SUFFIX_ALPHABET.charAt(byte % SUFFIX_ALPHABET.length)
          if (s.length === SUFFIX_LEN) break
        }
      }
      return s.slice(0, SUFFIX_LEN)
    }),
  }),
)

/** The Id service, built from the ambient `Clock` and an injected `RandomBytes`. */
export const IdLive = Layer.effect(
  Id,
  Effect.gen(function* () {
    const random = yield* RandomBytes
    const nowMillis = Clock.currentTimeMillis
    const now = nowMillis.pipe(Effect.map(formatTimestamp))
    return Id.of({
      now,
      nowMillis,
      generateId: (prefix: string) =>
        Effect.gen(function* () {
          const ts = fsSafeTimestamp(yield* now)
          const suffix = yield* random.nextSuffix
          return `${prefix}-${ts}-${suffix}`
        }),
    })
  }),
)

/** Convenience: the full production stack for the Id service. */
export const IdDefault = IdLive.pipe(Layer.provide(RandomBytesLive))
