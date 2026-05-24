export interface DeviceRecord {
  udid: string;
  [key: string]: unknown;
}

export interface ExecResult {
  stdout?: unknown;
  stderr?: unknown;
  error?: unknown;
}

export interface WebSocketLike {
  onopen?: (() => void) | null;
  onerror?: ((error: unknown) => void) | null;
  onmessage?: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface ExpoMessageClientDependencies {
  createWebSocket?: (url: string) => WebSocketLike;
  execFile?: (command: string, args: string[], options: { timeout: number; rejectOnError: false }) => Promise<ExecResult>;
  crashEvidence?: (args: { bundleId: unknown; sinceMs: number; waitMs: unknown; action: string }) => Promise<Record<string, unknown>>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  withTimeout?: <T>(promise: Promise<T>, ms: number, fallback: T) => Promise<T>;
  env?: Record<string, unknown>;
  truncate?: (value: unknown) => string;
  formatError?: (error: unknown) => string;
}

export interface OpenDevClientArgs {
  device: DeviceRecord;
  bundleId?: unknown;
  devClientUrl: string;
  restartDevClient?: boolean;
  crashCheckMs?: unknown;
}

export class ExpoMessageClient {
  readonly metroPort: number;
  readonly url: string;
  private readonly deps: RequiredExpoMessageClientDependencies;

  constructor(metroPort: number, deps: ExpoMessageClientDependencies = {}) {
    this.metroPort = metroPort;
    this.url = `ws://127.0.0.1:${metroPort}/message`;
    this.deps = normalizeDeps(deps);
  }

  async openDevClient(args: OpenDevClientArgs): Promise<Record<string, unknown>> {
    const actions: Array<Record<string, unknown>> = [];
    const startedAt = this.deps.now();

    if (args.restartDevClient && args.bundleId) {
      const terminate = await this.deps.execFile("xcrun", ["simctl", "terminate", args.device.udid, String(args.bundleId)], {
        timeout: 10_000,
        rejectOnError: false,
      });
      actions.push({
        action: "terminate",
        bundleId: args.bundleId,
        stdout: this.deps.truncate(terminate.stdout),
        stderr: this.deps.truncate(terminate.stderr),
        error: terminate.error,
      });
    }

    const open = await this.deps.execFile("xcrun", ["simctl", "openurl", args.device.udid, args.devClientUrl], {
      timeout: 10_000,
      rejectOnError: false,
    });
    actions.push({
      action: "openurl",
      devClientUrl: args.devClientUrl,
      stdout: this.deps.truncate(open.stdout),
      stderr: this.deps.truncate(open.stderr),
      error: open.error,
    });

    const reconnectTimeoutMs = clampNumber(this.deps.env.EXPO_IOS_DEV_CLIENT_RECONNECT_TIMEOUT_MS ?? 30_000, 100, 30_000);
    const deadline = this.deps.now() + reconnectTimeoutMs;
    let peerProbe: Record<string, unknown> | null = null;
    while (this.deps.now() < deadline) {
      await this.deps.wait(1000);
      peerProbe = await this.discoverPeers();
      if (peerProbe.available || Number(peerProbe.connectedPeerCount ?? 0) > 0) break;
    }

    return {
      available: peerProbe?.available === true || Number(peerProbe?.connectedPeerCount ?? 0) > 0,
      transport: "simctl-openurl",
      metroPort: this.metroPort,
      actions,
      reconnectTimeoutMs,
      peerProbe,
      ...(await this.deps.crashEvidence({
        bundleId: args.bundleId,
        sinceMs: startedAt,
        waitMs: args.crashCheckMs,
        action: "open-dev-client",
      })),
    };
  }

  async discoverPeers(): Promise<Record<string, unknown>> {
    return this.broadcast(null);
  }

  async broadcast(method: string | null, params: unknown = undefined): Promise<Record<string, unknown>> {
    if (!this.deps.createWebSocket) {
      return {
        available: false,
        transport: "metro-message-socket",
        metroPort: this.metroPort,
        reason: "This Node runtime does not expose a WebSocket client.",
      };
    }

    const ws = this.deps.createWebSocket(this.url);
    const pending = new Map<string, (value: unknown) => void>();
    let nextId = 1;
    const sendRequest = (message: Record<string, unknown>): Promise<unknown> => {
      const id = `expo-ios-${this.deps.now()}-${nextId++}`;
      ws.send(JSON.stringify({ ...message, id, version: 2 }));
      return new Promise((resolve) => pending.set(id, resolve));
    };

    ws.onmessage = (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const id = asRecord(message)?.id;
      if (typeof id === "string" && pending.has(id)) {
        const resolve = pending.get(id);
        pending.delete(id);
        resolve?.(message);
      }
    };

    try {
      await openWebSocket(ws);
      const peersResponse = asRecord(await this.deps.withTimeout(
        sendRequest({ method: "getpeers", target: "server" }),
        1500,
        { error: "Metro message websocket getpeers timed out." },
      ));
      if (peersResponse?.error) {
        return {
          available: false,
          transport: "metro-message-socket",
          metroPort: this.metroPort,
          url: this.url,
          reason: peersResponse.error,
        };
      }

      const peers = asRecord(peersResponse?.result) ?? {};
      const connectedPeerCount = Object.keys(peers).length;
      if (connectedPeerCount < 1) {
        return {
          available: false,
          transport: "metro-message-socket",
          metroPort: this.metroPort,
          url: this.url,
          reason: "No connected app peers on Metro /message websocket.",
          connectedPeerCount,
        };
      }

      if (method) {
        ws.send(JSON.stringify(params === undefined ? { method, version: 2 } : { method, params, version: 2 }));
        await this.deps.wait(100);
      }

      return {
        available: true,
        transport: "metro-message-socket",
        metroPort: this.metroPort,
        url: this.url,
        method: method ?? null,
        connectedPeerCount,
      };
    } catch (error) {
      return {
        available: false,
        transport: "metro-message-socket",
        metroPort: this.metroPort,
        url: this.url,
        reason: this.deps.formatError(error),
      };
    } finally {
      try {
        ws.close();
      } catch {
        // ignored
      }
    }
  }
}

export async function broadcastMetroMessage(
  metroPort: number,
  method: string | null,
  params: unknown = undefined,
  deps: ExpoMessageClientDependencies = {},
): Promise<Record<string, unknown>> {
  return new ExpoMessageClient(metroPort, deps).broadcast(method, params);
}

export async function openDevClientForMessageSocket(
  metroPort: number,
  args: OpenDevClientArgs,
  deps: ExpoMessageClientDependencies = {},
): Promise<Record<string, unknown>> {
  return new ExpoMessageClient(metroPort, deps).openDevClient(args);
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}

export function truncate(value: unknown, limit = 40_000): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

export function formatError(error: unknown): string {
  if (!error) return "Unknown error";
  const record = asRecord(error);
  const parts = [record?.message ?? String(error)];
  if (record?.stdout) parts.push(`stdout:\n${truncate(record.stdout)}`);
  if (record?.stderr) parts.push(`stderr:\n${truncate(record.stderr)}`);
  return parts.join("\n\n");
}

interface RequiredExpoMessageClientDependencies {
  createWebSocket?: (url: string) => WebSocketLike;
  execFile: (command: string, args: string[], options: { timeout: number; rejectOnError: false }) => Promise<ExecResult>;
  crashEvidence: (args: { bundleId: unknown; sinceMs: number; waitMs: unknown; action: string }) => Promise<Record<string, unknown>>;
  now: () => number;
  wait: (ms: number) => Promise<void>;
  withTimeout: <T>(promise: Promise<T>, ms: number, fallback: T) => Promise<T>;
  env: Record<string, unknown>;
  truncate: (value: unknown) => string;
  formatError: (error: unknown) => string;
}

function normalizeDeps(deps: ExpoMessageClientDependencies): RequiredExpoMessageClientDependencies {
  return {
    createWebSocket: Object.prototype.hasOwnProperty.call(deps, "createWebSocket")
      ? deps.createWebSocket
      : defaultWebSocketFactory(),
    execFile: deps.execFile ?? (async () => ({ stdout: "", stderr: "", error: null })),
    crashEvidence: deps.crashEvidence ?? (async () => ({})),
    now: deps.now ?? (() => Date.now()),
    wait: deps.wait ?? defaultWait,
    withTimeout: deps.withTimeout ?? defaultWithTimeout,
    env: deps.env ?? {},
    truncate: deps.truncate ?? truncate,
    formatError: deps.formatError ?? formatError,
  };
}

function defaultWebSocketFactory(): ((url: string) => WebSocketLike) | undefined {
  const WebSocketCtor = (globalThis as unknown as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  return typeof WebSocketCtor === "function" ? (url) => new WebSocketCtor(url) : undefined;
}

function openWebSocket(ws: WebSocketLike): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Metro message websocket open timed out.")), 1500);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = (error) => {
      clearTimeout(timer);
      reject(error);
    };
  });
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultWithTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
