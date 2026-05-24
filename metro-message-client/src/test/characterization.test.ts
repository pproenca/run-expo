import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ExpoMessageClient,
  broadcastMetroMessage,
  clampNumber,
  formatError,
  openDevClientForMessageSocket,
  truncate,
} from "../main/index.js";
import type {
  ExpoMessageClientDependencies,
  WebSocketLike,
} from "../main/index.js";

class FakeWebSocket implements WebSocketLike {
  onopen?: (() => void) | null;
  onerror?: ((error: unknown) => void) | null;
  onmessage?: ((event: { data: unknown }) => void) | null;
  readonly sent: string[] = [];
  closed = false;

  constructor(private readonly peers: Record<string, unknown> | { error: string }) {
    queueMicrotask(() => this.onopen?.());
  }

  send(data: string): void {
    this.sent.push(data);
    const message = JSON.parse(data);
    if (message.method === "getpeers" && message.id) {
      queueMicrotask(() => this.onmessage?.({
        data: JSON.stringify("error" in this.peers ? { id: message.id, error: this.peers.error } : { id: message.id, result: this.peers }),
      }));
    }
  }

  close(): void {
    this.closed = true;
  }
}

function deps(overrides: Partial<ExpoMessageClientDependencies> = {}): ExpoMessageClientDependencies {
  let now = 1000;
  return {
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    withTimeout: async (promise) => promise,
    execFile: async () => ({ stdout: "ok", stderr: "", error: null }),
    crashEvidence: async () => ({}),
    ...overrides,
  };
}

describe("metro-message-client legacy characterization", () => {
  it("reports unavailable when no WebSocket client exists", async () => {
    assert.deepEqual(await new ExpoMessageClient(8081, deps({ createWebSocket: undefined })).broadcast("devMenu"), {
      available: false,
      transport: "metro-message-socket",
      metroPort: 8081,
      reason: "This Node runtime does not expose a WebSocket client.",
    });
  });

  it("discovers peers through getpeers, sends requested method, waits briefly, and closes the socket", async () => {
    const sockets: FakeWebSocket[] = [];
    const client = new ExpoMessageClient(8081, deps({
      createWebSocket: (url) => {
        assert.equal(url, "ws://127.0.0.1:8081/message");
        const socket = new FakeWebSocket({ app: { id: "peer-1" } });
        sockets.push(socket);
        return socket;
      },
      now: () => 12345,
    }));

    assert.deepEqual(await client.broadcast("devMenu", { target: "app" }), {
      available: true,
      transport: "metro-message-socket",
      metroPort: 8081,
      url: "ws://127.0.0.1:8081/message",
      method: "devMenu",
      connectedPeerCount: 1,
    });
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0]?.closed, true);
    assert.deepEqual(sockets[0]?.sent.map((item) => JSON.parse(item)), [
      { method: "getpeers", target: "server", id: "expo-ios-12345-1", version: 2 },
      { method: "devMenu", params: { target: "app" }, version: 2 },
    ]);
  });

  it("does not send a broadcast payload when discoverPeers calls broadcast with null method", async () => {
    const socket = new FakeWebSocket({ app: true });
    const client = new ExpoMessageClient(3000, deps({ createWebSocket: () => socket, now: () => 99 }));

    assert.deepEqual(await client.discoverPeers(), {
      available: true,
      transport: "metro-message-socket",
      metroPort: 3000,
      url: "ws://127.0.0.1:3000/message",
      method: null,
      connectedPeerCount: 1,
    });
    assert.deepEqual(socket.sent.map((item) => JSON.parse(item)), [
      { method: "getpeers", target: "server", id: "expo-ios-99-1", version: 2 },
    ]);
  });

  it("returns unavailable for getpeers errors, empty peers, malformed messages, and websocket errors", async () => {
    assert.deepEqual(await new ExpoMessageClient(8081, deps({
      createWebSocket: () => new FakeWebSocket({ error: "Metro message websocket getpeers timed out." }),
    })).broadcast("devMenu"), {
      available: false,
      transport: "metro-message-socket",
      metroPort: 8081,
      url: "ws://127.0.0.1:8081/message",
      reason: "Metro message websocket getpeers timed out.",
    });

    assert.deepEqual(await new ExpoMessageClient(8081, deps({
      createWebSocket: () => new FakeWebSocket({}),
    })).broadcast("devMenu"), {
      available: false,
      transport: "metro-message-socket",
      metroPort: 8081,
      url: "ws://127.0.0.1:8081/message",
      reason: "No connected app peers on Metro /message websocket.",
      connectedPeerCount: 0,
    });

    const errorSocket: WebSocketLike = {
      send: () => {},
      close: () => {},
    };
    queueMicrotask(() => errorSocket.onerror?.(new Error("open failed")));
    assert.deepEqual(await new ExpoMessageClient(8081, deps({
      createWebSocket: () => errorSocket,
    })).broadcast("devMenu"), {
      available: false,
      transport: "metro-message-socket",
      metroPort: 8081,
      url: "ws://127.0.0.1:8081/message",
      reason: "open failed",
    });
  });

  it("falls back when the getpeers request times out", async () => {
    const socket: WebSocketLike = {
      send: () => {},
      close: () => {},
    };
    queueMicrotask(() => socket.onopen?.());

    assert.deepEqual(await new ExpoMessageClient(8081, deps({
      createWebSocket: () => socket,
      withTimeout: async (_promise, _ms, fallback) => fallback,
    })).broadcast("devMenu"), {
      available: false,
      transport: "metro-message-socket",
      metroPort: 8081,
      url: "ws://127.0.0.1:8081/message",
      reason: "Metro message websocket getpeers timed out.",
    });
  });

  it("opens a dev client URL, optionally terminates first, loops until peers connect, and appends crash evidence", async () => {
    let now = 1000;
    const execCalls: Array<{ command: string; args: string[] }> = [];
    let discoverCalls = 0;
    const client = new ExpoMessageClient(8081, deps({
      now: () => now,
      wait: async (ms) => {
        now += ms;
      },
      env: { EXPO_IOS_DEV_CLIENT_RECONNECT_TIMEOUT_MS: "2500" },
      execFile: async (command, args) => {
        execCalls.push({ command, args });
        return { stdout: `${args[1]} ok`, stderr: "", error: null };
      },
      crashEvidence: async (args) => ({ crashArgs: args, crashReports: [] }),
    }));
    client.discoverPeers = async () => {
      discoverCalls += 1;
      return discoverCalls === 1
        ? { available: false, connectedPeerCount: 0 }
        : { available: true, connectedPeerCount: 1 };
    };

    assert.deepEqual(await client.openDevClient({
      device: { udid: "SIM-1" },
      bundleId: "com.example.app",
      devClientUrl: "myapp:///",
      restartDevClient: true,
      crashCheckMs: 123,
    }), {
      available: true,
      transport: "simctl-openurl",
      metroPort: 8081,
      actions: [
        {
          action: "terminate",
          bundleId: "com.example.app",
          stdout: "terminate ok",
          stderr: "",
          error: null,
        },
        {
          action: "openurl",
          devClientUrl: "myapp:///",
          stdout: "openurl ok",
          stderr: "",
          error: null,
        },
      ],
      reconnectTimeoutMs: 2500,
      peerProbe: { available: true, connectedPeerCount: 1 },
      crashArgs: {
        bundleId: "com.example.app",
        sinceMs: 1000,
        waitMs: 123,
        action: "open-dev-client",
      },
      crashReports: [],
    });
    assert.deepEqual(execCalls, [
      { command: "xcrun", args: ["simctl", "terminate", "SIM-1", "com.example.app"] },
      { command: "xcrun", args: ["simctl", "openurl", "SIM-1", "myapp:///"] },
    ]);
  });

  it("skips terminate without restart or bundle id and reports unavailable when reconnect deadline passes", async () => {
    let now = 0;
    const execCalls: string[][] = [];
    const client = new ExpoMessageClient(8081, deps({
      now: () => now,
      wait: async (ms) => {
        now += ms;
      },
      env: { EXPO_IOS_DEV_CLIENT_RECONNECT_TIMEOUT_MS: "100" },
      execFile: async (_command, args) => {
        execCalls.push(args);
        return { stdout: "x".repeat(5), stderr: "bad", error: { code: 1 } };
      },
      truncate: (value) => String(value).slice(0, 2),
    }));
    client.discoverPeers = async () => ({ available: false, connectedPeerCount: 0 });

    assert.deepEqual(await client.openDevClient({
      device: { udid: "SIM-2" },
      devClientUrl: "myapp:///",
      restartDevClient: true,
    }), {
      available: false,
      transport: "simctl-openurl",
      metroPort: 8081,
      actions: [
        {
          action: "openurl",
          devClientUrl: "myapp:///",
          stdout: "xx",
          stderr: "ba",
          error: { code: 1 },
        },
      ],
      reconnectTimeoutMs: 100,
      peerProbe: { available: false, connectedPeerCount: 0 },
    });
    assert.deepEqual(execCalls, [["simctl", "openurl", "SIM-2", "myapp:///"]]);
  });

  it("exports wrapper helpers and shared formatting utilities", async () => {
    const socket = new FakeWebSocket({ app: true });
    assert.deepEqual(await broadcastMetroMessage(9000, null, undefined, deps({ createWebSocket: () => socket, now: () => 7 })), {
      available: true,
      transport: "metro-message-socket",
      metroPort: 9000,
      url: "ws://127.0.0.1:9000/message",
      method: null,
      connectedPeerCount: 1,
    });

    const clientPayload = await openDevClientForMessageSocket(9000, {
      device: { udid: "SIM-9" },
      devClientUrl: "myapp:///",
    }, deps({ env: { EXPO_IOS_DEV_CLIENT_RECONNECT_TIMEOUT_MS: "100" } }));
    assert.equal(clientPayload.transport, "simctl-openurl");
    assert.equal(clientPayload.metroPort, 9000);

    assert.equal(clampNumber(0, 100, 30000), 100);
    assert.equal(clampNumber(50000, 100, 30000), 30000);
    assert.throws(() => clampNumber("no", 1, 2), /Expected a finite number, got no\./);
    assert.equal(truncate("abcdef", 3), "abc\n[truncated 3 characters]");
    assert.equal(formatError(Object.assign(new Error("failed"), { stdout: "out", stderr: "err" })), "failed\n\nstdout:\nout\n\nstderr:\nerr");
  });
});

