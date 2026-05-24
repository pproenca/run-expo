/**
 * Loopback allowlist + port clamping — PURE functions shared by S8 (Metro) and S9 (CDP).
 *
 * The loopback allowlist is the network-confinement floor (AC-021 / AC-030). It is a pure
 * predicate so it can be tested exhaustively: accept every loopback form, reject everything else.
 *
 * Allowlist (verbatim from the contract): `127.0.0.1 | localhost | [::1] | ::1`.
 * NOTE the deliberate asymmetry vs the legacy: a non-loopback host is NEVER expanded into the
 * loopback candidate set — it is rejected. This is the AC-030 FIX (close the CWE-918 gap).
 */

/** The four canonical loopback host spellings. */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1",
]);

/** Metro default port (AC-038). Hoisted to one constant (legacy duplicated it 9+ times). */
export const DEFAULT_METRO_PORT = 8081 as const;

/** Port range bounds (AC-038 / all-ports clamp 1..65535). */
export const MIN_PORT = 1 as const;
export const MAX_PORT = 65535 as const;

/**
 * Is `host` one of the allowlisted loopback spellings? PURE.
 *
 * Comparison is exact against the canonical set after a case-insensitive fold of `localhost`
 * (DNS names are case-insensitive; IP-literals are compared verbatim). Surrounding brackets for
 * IPv6 are significant: both `[::1]` (URL-host form) and `::1` (bare form) are accepted.
 */
export const isLoopbackHost = (host: string): boolean => {
  if (LOOPBACK_HOSTS.has(host)) return true;
  // `localhost` may arrive in mixed case from a URL host component.
  return host.toLowerCase() === "localhost";
};

/**
 * Extract the host component from an `ws://`/`wss://`/`http://`/`https://` URL and test it against
 * the loopback allowlist. Returns the parse outcome so callers can reject BEFORE connecting.
 *
 * This is the AC-030 enforcement primitive: it runs on the `webSocketDebuggerUrl` returned by
 * Metro `/json/list` and rejects any non-loopback target before a socket is ever opened.
 */
export interface LoopbackUrlResult {
  readonly ok: boolean;
  /** The extracted host (lower-cased for `localhost`), or null when the URL could not be parsed. */
  readonly host: string | null;
  /** Reason present only when `ok === false`. */
  readonly reason?: string;
}

export const checkLoopbackUrl = (url: string): LoopbackUrlResult => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, host: null, reason: "URL could not be parsed." };
  }
  // URL#hostname strips the brackets from IPv6 literals (`[::1]` -> `::1`), so `::1` matches.
  const host = parsed.hostname;
  if (isLoopbackHost(host)) {
    return { ok: true, host };
  }
  return {
    ok: false,
    host,
    reason: `Refusing to connect to non-loopback host '${host}'. Allowed: 127.0.0.1, localhost, [::1], ::1.`,
  };
};

/** Clamp a value into [lo, hi]. PURE. */
export const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(Math.max(value, lo), hi);

/**
 * Resolve a Metro port: `clamp(port ?? 8081, 1, 65535)` (AC-038).
 * Non-finite / non-integer inputs fall back to the default before clamping.
 */
export const resolveMetroPort = (port: number | undefined | null): number => {
  if (port === undefined || port === null || !Number.isFinite(port)) {
    return DEFAULT_METRO_PORT;
  }
  return clamp(Math.trunc(port), MIN_PORT, MAX_PORT);
};

/** The loopback base URL every Metro fetch uses: `http://127.0.0.1:<port>`. */
export const loopbackMetroBaseUrl = (port: number): string =>
  `http://127.0.0.1:${resolveMetroPort(port)}`;
