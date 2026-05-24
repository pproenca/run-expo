export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: RequestInit & { signal: AbortSignal }) => Promise<FetchResponseLike>;

export interface LoopbackFetchOptions extends RequestInit {
  timeoutMs?: number;
}

export interface LocalFetchDependencies {
  fetch?: FetchLike;
}

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"] as const;
const LOOPBACK_HOSTNAME_SET = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export async function fetchLocalText(
  url: string,
  options: { timeoutMs: number },
  dependencies: LocalFetchDependencies = {},
): Promise<string> {
  const response = await fetchLocalLoopback(url, { timeoutMs: options.timeoutMs }, dependencies);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function fetchLocalLoopback(
  url: string,
  options: LoopbackFetchOptions = {},
  dependencies: LocalFetchDependencies = {},
): Promise<FetchResponseLike> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const fetchOptions = withoutTimeout(options);
  const urls = loopbackUrlCandidates(url);
  let lastError: unknown = null;

  for (const candidate of urls) {
    try {
      return await fetchWithTimeout(candidate, fetchOptions, timeoutMs, dependencies);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Local fetch failed");
}

export function loopbackUrlCandidates(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }

  if (!LOOPBACK_HOSTNAME_SET.has(parsed.hostname)) return [url];

  const candidates: string[] = [];
  for (const host of LOOPBACK_HOSTS) {
    const candidate = new URL(url);
    candidate.host = `${host}${parsed.port ? `:${parsed.port}` : ""}`;
    const candidateUrl = candidate.toString();
    if (!candidates.includes(candidateUrl)) candidates.push(candidateUrl);
  }
  return candidates;
}

export async function fetchLocalTextDirect(
  url: string,
  options: { timeoutMs: number },
  dependencies: LocalFetchDependencies = {},
): Promise<string> {
  const response = await fetchWithTimeout(url, {}, options.timeoutMs, dependencies);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function fetchLocalJson(
  url: string,
  options: { timeoutMs: number },
  dependencies: LocalFetchDependencies = {},
): Promise<unknown> {
  return JSON.parse(await fetchLocalText(url, options, dependencies));
}

function withoutTimeout(options: LoopbackFetchOptions): RequestInit {
  const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
  return fetchOptions;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  dependencies: LocalFetchDependencies,
): Promise<FetchResponseLike> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetcher = dependencies.fetch ?? defaultFetch;
    return await fetcher(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const defaultFetch: FetchLike = async (url, init) => fetch(url, init);
