import WebSocket from "ws";

export interface HermesEvaluationResult {
  result?: { result?: { value?: unknown } };
  error?: string;
  diagnostics?: Record<string, unknown>;
  cdp?: unknown;
}

export async function evaluateHermesExpression(
  webSocketDebuggerUrl: string,
  expression: string,
  options: { timeoutMs: number },
): Promise<HermesEvaluationResult> {
  return cdpCall(webSocketDebuggerUrl, [
    { method: "Runtime.enable", params: {} },
    { method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } },
  ], options.timeoutMs);
}

export async function cdpCall(
  webSocketDebuggerUrl: string,
  calls: Array<{ method: string; params: Record<string, unknown> }>,
  timeoutMs: number,
): Promise<HermesEvaluationResult> {
  const candidates = loopbackWebSocketCandidates(webSocketDebuggerUrl);
  const errors: string[] = [];

  for (const candidate of candidates) {
    const origin = metroOriginForWebSocket(candidate);
    const ws = new WebSocket(candidate, { headers: { Origin: origin } });
    try {
      await waitForOpen(ws, Math.min(timeoutMs, 2500));
      let id = 0;
      let last: Record<string, unknown> | null = null;
      for (const call of calls) {
        id += 1;
        ws.send(JSON.stringify({ id, method: call.method, params: call.params }));
        last = await waitForMessage(ws, id, timeoutMs);
      }
      const cdpError = last && typeof last.error === "string" ? last.error : null;
      return {
        ...(last ?? {}),
        ...(cdpError ? { error: cdpError } : {}),
        cdp: last,
        diagnostics: {
          webSocketDebuggerUrl,
          connectedUrl: candidate,
          origin,
          attempts: candidates.length,
        },
      };
    } catch (error) {
      errors.push(`${candidate}: ${formatError(error)}`);
      try {
        ws.close();
      } catch {
        // ignored
      }
    } finally {
      try {
        ws.close();
      } catch {
        // ignored
      }
    }
  }

  return {
    error: errors.length > 0 ? errors.join("; ") : "Hermes websocket connection failed.",
    diagnostics: {
      webSocketDebuggerUrl,
      attemptedUrls: candidates,
    },
  };
}

export function loopbackWebSocketCandidates(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }

  const candidates: string[] = [];
  const add = (candidate: string) => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };
  add(parsed.toString());

  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
  if (loopbackHosts.has(parsed.hostname)) {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      const candidate = new URL(parsed.toString());
      candidate.hostname = host;
      add(candidate.toString());
    }
  }

  return candidates;
}

export function metroOriginForWebSocket(url: string): string {
  try {
    const parsed = new URL(url);
    const port = parsed.port ? `:${parsed.port}` : "";
    return `http://127.0.0.1${port}`;
  } catch {
    return "http://127.0.0.1";
  }
}

function waitForOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening WebSocket.")), timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error("WebSocket connection failed."));
    });
  });
}

function waitForMessage(ws: WebSocket, id: number, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for CDP response."));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!isRecord(parsed) || parsed.id !== id) return;
      cleanup();
      resolve(parsed.error ? { error: parsed.error } : parsed);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.once("error", onError);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  const record = isRecord(error) ? error : null;
  return typeof record?.message === "string" ? record.message : String(error);
}
