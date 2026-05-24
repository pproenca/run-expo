/**
 * S5 — Redaction (pure). AC-003 / AC-012.
 *
 * ONE redactor, the strongest-superset key pattern, applied at the single
 * output boundary (the dispatcher) before any payload reaches stdout or disk.
 *
 * SAFETY INVARIANT (finding M2): redaction operates over *whole values* of a
 * fully-materialised payload — never over wire-chunks. A secret therefore can
 * never split across two NDJSON events and slip past the matcher. The
 * dispatcher serialises only AFTER calling `redact`.
 */

export const REDACTED = "[redacted]" as const

/**
 * Strongest-superset secret KEY pattern (AC-003). Any object key matching this
 * (case-insensitively) has its whole value replaced with `[redacted]`,
 * regardless of the value's shape.
 */
const SECRET_KEY_PATTERN =
  /authorization|bearer|cookie|set-cookie|token|secret|password|pwd|api[-_]?key|apikey|x-api-key|client_secret|refresh|credential|session|auth/i

/**
 * Secret-shaped *substring* pattern for free-form strings (URLs, `key=value`
 * blobs). We redact the VALUE half of any `key=value` (or `key: value`) pair
 * whose key half matches the secret pattern, including URL query parameters.
 */
const SECRET_PARAM_KEY =
  /token|secret|key|password|pwd|auth|session|cookie|bearer|credential|refresh|client_secret/i

const isSecretKey = (key: string): boolean => SECRET_KEY_PATTERN.test(key)

/**
 * Redact secret-shaped `key=value` and `key: value` substrings inside a single
 * string (covers URL query strings, `Set-Cookie` lines, joined env blobs).
 * We never partially reveal a matched value — the entire value token is
 * replaced.
 */
export const redactSecretsInString = (input: string): string => {
  // The key quantifiers are LENGTH-BOUNDED ({1,256}). An unbounded greedy `+`
  // on these patterns backtracks O(n^2) on a long delimiter-free string (a big
  // evidence field, a base64 blob) — a real DoS, since the redactor runs on ALL
  // output. No real header/param key is >256 chars, so the bound is lossless and
  // makes matching linear.
  // URL/query and generic key=value pairs: keep the key, redact the value up to
  // the next delimiter (& ; whitespace or end-of-string).
  let out = input.replace(
    /([?&#;\s]|^)([A-Za-z0-9_.\-[\]]{1,256})(=)([^&;#\s]*)/g,
    (match, lead: string, key: string, eq: string, _value: string) =>
      SECRET_PARAM_KEY.test(key) ? `${lead}${key}${eq}${REDACTED}` : match
  )
  // `key: value` header-style pairs (e.g. "authorization: Bearer abc").
  out = out.replace(
    /([A-Za-z0-9_.-]{1,256})(\s*:\s*)([^\r\n]*)/g,
    (match, key: string, sep: string, _value: string) =>
      SECRET_PARAM_KEY.test(key) ? `${key}${sep}${REDACTED}` : match
  )
  return out
}

/**
 * Recursively redact an arbitrary value.
 *
 * - object key matches secret pattern ⇒ whole value ⇒ `[redacted]`
 * - other object values / array elements ⇒ recurse
 * - strings ⇒ scan for secret-shaped substrings
 * - other primitives ⇒ unchanged
 *
 * Cycles are handled with a visited set so a self-referential payload cannot
 * loop forever (defensive; payloads here are plain JSON).
 */
export const redact = (value: unknown): unknown => redactInner(value, new WeakSet())

const redactInner = (value: unknown, seen: WeakSet<object>): unknown => {
  if (typeof value === "string") {
    return redactSecretsInString(value)
  }

  if (value === null || typeof value !== "object") {
    return value
  }

  if (seen.has(value)) {
    return REDACTED
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((element) => redactInner(element, seen))
  }

  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    // SAFETY: redact the WHOLE value when the key is secret-shaped — do not
    // recurse into it, so nested non-secret-looking leaves can't leak it.
    result[key] = isSecretKey(key) ? REDACTED : redactInner(source[key], seen)
  }
  return result
}
