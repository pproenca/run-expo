export interface HermesRuntimeDiagnosticsOptions {
  target?: unknown;
  includeComponents?: boolean;
  [key: string]: unknown;
}

export interface HermesCdpClientLike {
  connect(options: { timeoutMs: number }): Promise<void> | void;
  call(method: string, params?: Record<string, unknown>, options?: { timeoutMs: number }): Promise<Record<string, any>> | Record<string, any>;
  events(method: string): Array<{ params?: Record<string, any> }>;
  diagnostics(): unknown;
  close(): void;
}

export interface HermesRuntimeDiagnosticsDependencies {
  webSocketAvailable?: boolean;
  createClient: (webSocketDebuggerUrl: string, options?: { target?: unknown }) => HermesCdpClientLike;
  wait?: (ms: number) => Promise<void> | void;
  componentHierarchyExpression?: (options: HermesRuntimeDiagnosticsOptions) => string;
  formatError?: (error: unknown) => string;
}

export async function inspectHermesRuntime(
  webSocketDebuggerUrl: string | null | undefined,
  deps: HermesRuntimeDiagnosticsDependencies,
  options: HermesRuntimeDiagnosticsOptions = {},
): Promise<Record<string, any>> {
  if (!webSocketDebuggerUrl) return { available: false, reason: "No Metro inspector target." };
  if (deps.webSocketAvailable === false) {
    return { available: false, reason: "This Node runtime does not expose a WebSocket client." };
  }
  const client = deps.createClient(webSocketDebuggerUrl, { target: options.target });

  try {
    await client.connect({ timeoutMs: 2500 });
    const results: Record<string, any> = {};
    results.runtimeEnable = await client.call("Runtime.enable", {}, { timeoutMs: 2500 });
    results.debuggerEnable = await client.call("Debugger.enable", {}, { timeoutMs: 2500 });
    await (deps.wait ?? (() => undefined))(350);
    const concurrentCalls = [
      client.call("Runtime.getHeapUsage", {}, { timeoutMs: 2500 }),
      client.call("Runtime.evaluate", {
        expression: runtimeGlobalsExpression(),
        returnByValue: true,
      }, { timeoutMs: 2500 }),
      options.includeComponents === false
        ? Promise.resolve({ method: "Runtime.evaluate", result: { result: { value: { skipped: true, reason: "includeComponents is false" } } } })
        : client.call("Runtime.evaluate", {
          expression: (deps.componentHierarchyExpression ?? defaultComponentHierarchyExpression)(options),
          returnByValue: true,
        }, { timeoutMs: 3000 }),
    ];
    [results.heap, results.globals, results.componentHierarchy] = await Promise.all(concurrentCalls);

    return {
      available: true,
      webSocketDebuggerUrl,
      heap: results.heap?.result ?? null,
      globals: results.globals?.result?.result?.value ?? null,
      componentHierarchy: results.componentHierarchy?.result?.result?.value ?? null,
      unsupportedOrErrors: Object.values(results).filter((value) => value?.error).map((value) => value.error),
      loadedAppScripts: summarizeScripts(client.events("Debugger.scriptParsed").map((event) => event.params)),
      cdp: client.diagnostics(),
    };
  } catch (error) {
    return { available: false, webSocketDebuggerUrl, error: formatError(error, deps), cdp: client.diagnostics() };
  } finally {
    client.close();
  }
}

export async function evaluateHermesExpression(
  webSocketDebuggerUrl: string,
  expression: string,
  deps: HermesRuntimeDiagnosticsDependencies,
  { timeoutMs = 3000 }: { timeoutMs?: number } = {},
): Promise<Record<string, any>> {
  if (deps.webSocketAvailable === false) {
    return { error: "This Node runtime does not expose a WebSocket client." };
  }
  const client = deps.createClient(webSocketDebuggerUrl);

  try {
    await client.connect({ timeoutMs: 2500 });
    const enable = await client.call("Runtime.enable", {}, { timeoutMs: 1500 });
    if (enable.error) return { error: enable.error, diagnostics: client.diagnostics() };
    const result = await client.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }, { timeoutMs });
    return { ...result, diagnostics: client.diagnostics() };
  } catch (error) {
    return { error: formatError(error, deps), diagnostics: client.diagnostics() };
  } finally {
    client.close();
  }
}

export function responseShape(value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value !== "object") return { type: typeof value };
  const record = value as Record<string, any>;
  const keys = Object.keys(record).slice(0, 20);
  const shape: Record<string, unknown> = { type: "object", keys };
  if (typeof record.type === "string") shape.resultType = record.type;
  if (record.result && typeof record.result === "object") shape.result = responseShape(record.result);
  return shape;
}

export function normalizeProtocolError(error: unknown): { message: string; code: unknown; data?: string } {
  if (!error || typeof error !== "object") return { message: shortDiagnostic(error), code: "protocol-error" };
  const record = error as Record<string, unknown>;
  return {
    message: shortDiagnostic(record.message ?? record.description ?? error),
    code: record.code ?? "protocol-error",
    data: record.data == null ? undefined : shortDiagnostic(typeof record.data === "string" ? record.data : JSON.stringify(record.data), 500),
  };
}

export function protocolErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return shortDiagnostic(error);
  const record = error as Record<string, unknown>;
  const code = record.code == null ? "" : ` (${record.code})`;
  return `${record.message ?? record.description ?? "CDP protocol error"}${code}`;
}

export function shortDiagnostic(value: unknown, max = 240): string {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function summarizeScripts(scripts: Array<Record<string, any> | undefined>): Record<string, any> {
  const appScripts = scripts
    .filter((script): script is Record<string, any> => {
      if (!script) return false;
      return /\/apps\/mobile\/app\/|\/app\//.test(script.url ?? script.sourceMapURL ?? "");
    })
    .map((script) => ({
      scriptId: script.scriptId,
      url: script.url || null,
      sourceMapURL: script.sourceMapURL || null,
    }));
  const sourceOwners = [...new Set(appScripts.flatMap((script) => {
    const values = [script.url, script.sourceMapURL].filter((value): value is string => Boolean(value));
    return values
      .map((value) => decodeURIComponent(String(value)))
      .map((value) => value.split("?")[0] ?? "")
      .map((value) => value.replace(/^https?:\/\/[^/]+/, ""))
      .filter((value) => /\/apps\/mobile\/app\//.test(value));
  }))].slice(0, 40);
  return {
    totalScriptsObserved: scripts.length,
    appScriptCount: appScripts.length,
    appScripts: appScripts.slice(0, 40),
    sourceOwners,
  };
}

export function runtimeGlobalsExpression(): string {
  return `(() => ({
          dev: typeof __DEV__ !== 'undefined' ? __DEV__ : null,
          hermes: !!globalThis.HermesInternal,
          fabric: !!globalThis.nativeFabricUIManager,
          navigatorProduct: typeof navigator !== 'undefined' ? navigator.product : null,
          location: typeof location !== 'undefined' ? String(location.href) : null,
          performanceNow: typeof performance !== 'undefined' && performance.now ? Math.round(performance.now()) : null,
          globals: Object.keys(globalThis).filter((key) => /Expo|React|Metro|Hermes|native|performance|location|__r/.test(key)).sort().slice(0, 80)
        }))()`;
}

function defaultComponentHierarchyExpression(): string {
  return "(() => ({ skipped: true, reason: \"component hierarchy expression dependency is not configured\" }))()";
}

function formatError(error: unknown, deps: HermesRuntimeDiagnosticsDependencies): string {
  if (deps.formatError) return deps.formatError(error);
  return error instanceof Error ? error.message : String(error);
}
