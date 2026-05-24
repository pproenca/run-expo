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

/** Recursively cap arrays to `MAX_ARRAY_ITEMS`, annotating dropped counts. */
const capArrays = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ARRAY_ITEMS).map(capArrays)
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
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source)) {
      out[key] = capArrays(source[key])
    }
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
  const arrayBounded = capArrays(value)
  let serialised: string
  try {
    serialised = JSON.stringify(arrayBounded) ?? ""
  } catch {
    serialised = ""
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
