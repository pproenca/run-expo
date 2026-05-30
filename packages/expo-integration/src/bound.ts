/**
 * `bound` — size-bounding for bridge domain-action payloads (AC-006).
 *
 * Two independent caps applied to the bridge's returned value BEFORE it leaves
 * the handler (redaction is applied separately at core's output boundary):
 *   - `MAX_ARRAY_ITEMS` (1000): arrays are truncated to their first N items with
 *     an explicit overflow marker recording how many were dropped.
 *   - `MAX_OUTPUT` (40000): the serialised JSON of the bounded value is capped at
 *     N chars; if it still overflows, the value is replaced by a marker object.
 *
 * These are payload-shape caps specific to bridge values; the canonical stdout
 * truncation (`@expo98/core`'s `OUTPUT_BUDGET`) still applies at serialisation.
 */

/** Max chars of serialised bridge value (AC-006). */
export const MAX_OUTPUT = 40_000 as const

/** Max items kept from any array in a bridge value (AC-006). */
export const MAX_ARRAY_ITEMS = 1_000 as const
export const MAX_OBJECT_KEYS = 1_000 as const
export const MAX_DEPTH = 32 as const
export const MAX_STRING_CHARS = 8_192 as const

const serializationFailed = (): unknown => ({
  _bounded: "output",
  reason: "Bridge value could not be serialized.",
  bytes: null,
  limit: MAX_OUTPUT,
})

/** Recursively cap bridge values before serialisation can become the bottleneck. */
const capValue = (value: unknown, depth = 0, seen = new WeakSet<object>()): unknown => {
  if (typeof value === "string") {
    return value.length > MAX_STRING_CHARS
      ? {
          _bounded: "string",
          value: value.slice(0, MAX_STRING_CHARS),
          kept: MAX_STRING_CHARS,
          dropped: value.length - MAX_STRING_CHARS,
        }
      : value
  }
  if (depth > MAX_DEPTH) {
    return { _bounded: "depth", depth, limit: MAX_DEPTH }
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return { _bounded: "cycle", reason: "Circular bridge value reference." }
    }
    seen.add(value)
    const kept = value.slice(0, MAX_ARRAY_ITEMS).map((item) => capValue(item, depth + 1, seen))
    seen.delete(value)
    if (value.length > MAX_ARRAY_ITEMS) {
      return {
        _bounded: "array",
        items: kept,
        kept: kept.length,
        dropped: value.length - MAX_ARRAY_ITEMS,
        total: value.length,
      }
    }
    return kept
  }
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) {
      return { _bounded: "cycle", reason: "Circular bridge value reference." }
    }
    seen.add(value)
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const keys = Object.keys(source)
    for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
      out[key] = capValue(source[key], depth + 1, seen)
    }
    if (keys.length > MAX_OBJECT_KEYS) {
      out["_bounded"] = "object"
      out["_kept"] = MAX_OBJECT_KEYS
      out["_dropped"] = keys.length - MAX_OBJECT_KEYS
      out["_total"] = keys.length
    }
    seen.delete(value)
    return out
  }
  return value
}

/**
 * Size-bound a bridge value: cap arrays to `MAX_ARRAY_ITEMS`, then cap the
 * serialised size to `MAX_OUTPUT` chars. Returns a marker object if it still
 * overflows after array-capping (the value is too large to surface whole).
 */
export const boundBridgeValue = (value: unknown): unknown => {
  const arrayBounded = capValue(value)
  let serialised: string
  try {
    serialised = JSON.stringify(arrayBounded) ?? ""
  } catch {
    return serializationFailed()
  }
  if (serialised.length <= MAX_OUTPUT) {
    return arrayBounded
  }
  return {
    _bounded: "output",
    reason: "Bridge value exceeded the output size bound.",
    bytes: serialised.length,
    limit: MAX_OUTPUT,
  }
}
