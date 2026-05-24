export function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function processNameFromBundleId(bundleId: unknown): string | null {
  if (!bundleId) return null;
  const last = String(bundleId).split(".").filter(Boolean).at(-1);
  return last ? last.replace(/[^a-zA-Z0-9_-]/g, "") : null;
}

export function redactUrlAuthCookie(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("cookie")) parsed.searchParams.set("cookie", "[redacted]");
    return parsed.toString();
  } catch {
    return url.replace(/([?&]cookie=)[^&]+/i, "$1[redacted]");
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
