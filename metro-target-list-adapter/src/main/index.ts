export interface MetroTargetListDependencies {
  fetchLocalJson?: (url: string, options: { timeoutMs: number }) => Promise<unknown> | unknown;
}

export async function fetchMetroTargets(
  metroPort: number,
  dependencies: MetroTargetListDependencies,
): Promise<unknown> {
  const fetchLocalJson = dependencies.fetchLocalJson ?? defaultFetchLocalJson;
  return fetchLocalJson(`http://127.0.0.1:${metroPort}/json/list`, { timeoutMs: 1000 });
}

export async function fetchMetroTargetsForDiscovery(
  metroPort: number,
  dependencies: MetroTargetListDependencies,
): Promise<unknown> {
  return fetchMetroTargets(metroPort, dependencies).catch(() => []);
}

async function defaultFetchLocalJson(url: string, options: { timeoutMs: number }): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return JSON.parse(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}
