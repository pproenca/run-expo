import { FileSystem } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import {
  DEFAULT_MAX_BUFFER,
  DEFAULT_TIMEOUT_MS,
  DeviceCapability,
  type DeviceCapabilityService,
  IdDefault,
  type RunOptions,
  type RunResult,
  RuntimeEvalCapability,
  type RuntimeEvalCapabilityService,
  SourceWriteCapability,
  type SourceWriteCapabilityService,
  Subprocess,
  SubprocessFailed,
  type SubprocessService,
  SubprocessTimeout,
  PathEscape,
  ToolNotFound,
} from "@expo98/core"
import { Fs, type FsPort, StorageFailure } from "@expo98/domain"
import {
  HermesEvidenceLayer,
  HermesRuntimeEval,
  HermesRuntimeEvalLayer,
  HttpTransportError,
  MetroHttpClient,
  type MetroHttpResponse,
  MetroProbeLayer,
  WsCdpSocketFactoryLayer,
} from "@expo98/protocols"
import { Effect, Layer } from "effect"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { dirname } from "node:path"

/**
 * The node-backed Layer stack — the COMPOSITION ROOT (S12).
 *
 * This is where the pure spine (`core`) and the platform-agnostic ports
 * (`domain.Fs`, `protocols.MetroHttpClient`, `protocols.CdpSocketFactory`) are
 * discharged against the REAL `@effect/platform-node` implementations
 * (FileSystem, Path, Command/CommandExecutor, sockets).
 *
 * Each adapter is small and is the ONLY place `@effect/platform-node` is named —
 * the rest of the system stays dependency-agnostic and test-mockable.
 *
 * NOTE: the capability services are constructed here but are NEVER provided
 * directly to a handler — the dispatcher (`core`) provides them into a handler's
 * `R` ONLY on the gate-pass branch (capability withholding). This module merely
 * makes the concrete services available for the dispatcher to inject.
 */

// ── domain.Fs adapter — delegates to @effect/platform FileSystem + Path. ─────
const makeNodeFs = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const fail =
    (op: StorageFailure["op"], p: string) =>
    (cause: unknown): StorageFailure =>
      new StorageFailure({ op, path: p, reason: String(cause) })

  const port: FsPort = {
    readFile: (p) => fs.readFileString(p).pipe(Effect.mapError(fail("read", p))),
    writeFile: (p, contents) => fs.writeFileString(p, contents).pipe(Effect.mapError(fail("write", p))),
    writeFileAtomic: (p, contents) => {
      const slash = p.lastIndexOf("/")
      const dir = slash <= 0 ? "/" : p.slice(0, slash)
      const leaf = slash < 0 ? p : p.slice(slash + 1)
      const tmp = `${dir}/.${leaf}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
      return fs.writeFileString(tmp, contents).pipe(
        Effect.flatMap(() => fs.rename(tmp, p)),
        Effect.catchAll((cause) =>
          fs.remove(tmp).pipe(
            Effect.ignore,
            Effect.flatMap(() => Effect.fail(fail("write", p)(cause))),
          ),
        ),
      )
    },
    exists: (p) => fs.exists(p).pipe(Effect.mapError(fail("read", p))),
    mkdirp: (p) => fs.makeDirectory(p, { recursive: true }).pipe(Effect.mapError(fail("write", p))),
    readDir: (p) => fs.readDirectory(p).pipe(Effect.mapError(fail("list", p))),
    // `remove` is a no-op if the path does not exist (port contract).
    remove: (p) =>
      fs.exists(p).pipe(
        Effect.mapError(fail("remove", p)),
        Effect.flatMap((present) =>
          present ? fs.remove(p, { recursive: true }).pipe(Effect.mapError(fail("remove", p))) : Effect.void,
        ),
      ),
  }
  return port
})

/** Node-backed `Fs` Layer (requires `@effect/platform-node` `NodeContext`). */
export const NodeFsLayer = Layer.effect(Fs, makeNodeFs)

// ── core.Subprocess adapter — argv-only @effect/platform Command (no shell). ──

/**
 * The node-backed subprocess: argv-only (`spawn(tool, args)`, no shell), with
 * default timeout and max-buffer containment. A non-zero exit is surfaced as
 * `SubprocessFailed` so the device capability sees the same typed contract the
 * fake uses in tests.
 */
const makeNodeSubprocess = Effect.sync(() => {
  const run = (
    tool: string,
    args: ReadonlyArray<string>,
    options?: RunOptions,
  ): Effect.Effect<RunResult, ToolNotFound | SubprocessTimeout | SubprocessFailed> => {
    const maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

    return Effect.async<RunResult, ToolNotFound | SubprocessTimeout | SubprocessFailed>((resume) => {
      let child: ChildProcessWithoutNullStreams | undefined
      let settled = false
      let totalBytes = 0
      const stdoutChunks: Array<Buffer> = []
      const stderrChunks: Array<Buffer> = []

      const killChild = () => {
        if (child === undefined || child.killed) return
        if (process.platform !== "win32" && child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL")
            return
          } catch {
            // Fall back to killing the direct child when the process group is unavailable.
          }
        }
        child.kill("SIGKILL")
      }

      const finish = (effect: Effect.Effect<RunResult, ToolNotFound | SubprocessTimeout | SubprocessFailed>) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resume(effect)
      }

      const onData = (target: Array<Buffer>) => (chunk: Buffer) => {
        if (settled) return
        totalBytes += chunk.byteLength
        if (totalBytes > maxBuffer) {
          killChild()
          finish(
            Effect.fail(
              new SubprocessFailed({
                tool,
                exitCode: 1,
                stderr: `subprocess output exceeded maxBuffer ${maxBuffer}`,
              }),
            ),
          )
          return
        }
        target.push(chunk)
      }

      const timeout = setTimeout(() => {
        killChild()
        finish(Effect.fail(new SubprocessTimeout({ tool, timeoutMs })))
      }, timeoutMs)

      try {
        child = spawn(tool, [...args], {
          cwd: options?.cwd,
          detached: process.platform !== "win32",
          env: options?.env === undefined ? process.env : { ...process.env, ...options.env },
          shell: false,
        })
      } catch (error) {
        clearTimeout(timeout)
        const message = error instanceof Error ? error.message : String(error)
        return Effect.sync(() =>
          resume(
            Effect.fail(
              new SubprocessFailed({
                tool,
                exitCode: 1,
                stderr: message,
              }),
            ),
          ),
        )
      }

      child.stdout.on("data", onData(stdoutChunks))
      child.stderr.on("data", onData(stderrChunks))
      child.on("error", (error: NodeJS.ErrnoException) => {
        finish(
          error.code === "ENOENT"
            ? Effect.fail(new ToolNotFound({ tool }))
            : Effect.fail(
                new SubprocessFailed({
                  tool,
                  exitCode: 1,
                  stderr: error.message,
                }),
              ),
        )
      })
      child.on("close", (code) => {
        if (settled) return
        const result: RunResult = {
          tool,
          args,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          exitCode: code ?? 1,
        }
        finish(
          result.exitCode === 0
            ? Effect.succeed(result)
            : Effect.fail(
                new SubprocessFailed({
                  tool,
                  exitCode: result.exitCode,
                  stderr: result.stderr,
                }),
              ),
        )
      })

      return Effect.sync(() => {
        clearTimeout(timeout)
        killChild()
      })
    })
  }

  const service: SubprocessService = { run }
  return service
})

export const NodeSubprocessLayer = Layer.effect(Subprocess, makeNodeSubprocess)

// ── Capability adapters (constructed; injected ONLY by the gate, never here). ──

/** Device capability backed by the Subprocess service (argv-only, no shell). */
const DeviceCapabilityLayer = Layer.effect(
  DeviceCapability,
  Effect.gen(function* () {
    const subprocess = yield* Subprocess
    const service: DeviceCapabilityService = {
      invoke: (tool, args) => subprocess.run(tool, args).pipe(Effect.map((r) => r.stdout)),
    }
    return service
  }),
)

/** Runtime-eval capability backed by the protocols Hermes runtime-eval surface. */
const RuntimeEvalCapabilityLayer = Layer.effect(
  RuntimeEvalCapability,
  Effect.gen(function* () {
    const hermes = yield* HermesRuntimeEval
    const service: RuntimeEvalCapabilityService = {
      // The protocols surface enforces loopback + Origin + bounded open; the
      // dispatcher only ever provides THIS into a gate-approved runtime-eval
      // handler (AC-010/011 become a type fact). Candidate target URLs are
      // supplied by the handler in the deferred packages — here the composition
      // root proves the wiring with no candidates (returns unavailable, never
      // throws), keeping the read-path side-effect-free.
      evaluate: (expression, options) =>
        hermes
          .evaluate(expression, { attemptedUrls: [], metroPort: options?.metroPort })
          .pipe(Effect.map((result) => result as unknown)),
    }
    return service
  }),
)

/** Source-write capability backed by the node FileSystem (AC-008 gated upstream). */
const SourceWriteCapabilityLayer = Layer.effect(
  SourceWriteCapability,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const nearestExistingAncestor = (path: string): Effect.Effect<readonly [string, string] | null> =>
      Effect.suspend(() => {
        const parent = dirname(path)
        const loop = (candidate: string): Effect.Effect<readonly [string, string] | null> =>
          fs.exists(candidate).pipe(
            Effect.flatMap((present) => {
              if (present) {
                return fs.realPath(candidate).pipe(Effect.map((real) => [candidate, real] as const))
              }
              const next = dirname(candidate)
              return next === candidate ? Effect.succeed(null) : loop(next)
            }),
            Effect.catchAll(() => Effect.succeed(null)),
          )
        return loop(parent)
      })
    const rejectSymlinkAncestor = (path: string): Effect.Effect<string> =>
      nearestExistingAncestor(path).pipe(
        Effect.flatMap((ancestor) => {
          if (ancestor === null) {
            return Effect.succeed(path)
          }
          const [lexical, real] = ancestor
          return lexical === real
            ? Effect.succeed(path)
            : Effect.die(new PathEscape({ root: lexical, candidate: path, resolved: real }))
        }),
      )
    const service: SourceWriteCapabilityService = {
      writeFile: (path, contents) =>
        rejectSymlinkAncestor(path).pipe(Effect.flatMap((confined) => fs.writeFileString(confined, contents)), Effect.orDie),
      deleteFile: (path) =>
        rejectSymlinkAncestor(path).pipe(Effect.flatMap((confined) => fs.remove(confined, { recursive: true })), Effect.orDie),
    }
    return service
  }),
)

// ── protocols.MetroHttpClient adapter — loopback HTTP via @effect/platform. ──
const makeMetroHttpClient = Effect.sync(
  (): MetroHttpClient => ({
    // INTEGRATION SEAM: the full `@effect/platform` `HttpClient` adapter
    // (per-fetch AbortController timeout, status + text) is wired with the
    // network/metro handler packages. The proof READ commands do not probe
    // Metro; this adapter returns a transport failure so an accidental probe
    // fails closed (loopback semantics preserved — never reaches a non-loopback
    // host).
    request: (req): Effect.Effect<MetroHttpResponse, HttpTransportError> =>
      Effect.fail(new HttpTransportError({ url: req.url, cause: "metro-http-not-wired" })),
  }),
)

export const MetroHttpClientLayer = Layer.effect(MetroHttpClient, makeMetroHttpClient)

/**
 * The full node platform foundation: `@effect/platform-node` `NodeContext`
 * (FileSystem, Path, CommandExecutor, Terminal — also satisfies the
 * `@effect/cli` `CliApp.Environment`).
 */
export const PlatformLayer = NodeContext.layer

/** The leaf port adapters resting directly on the platform foundation. */
const AdapterLayer = Layer.mergeAll(NodeSubprocessLayer, MetroHttpClientLayer, WsCdpSocketFactoryLayer)

/**
 * The protocols layer: Metro probe + the two Hermes CDP surfaces, each with the
 * `CdpSocketFactory`/`MetroHttpClient` ports DISCHARGED. `provide` (not merge)
 * supplies the adapters to the protocol layers so the socket factory does not
 * leak as an outstanding requirement of the whole stack.
 */
const ProtocolsLayer = Layer.mergeAll(MetroProbeLayer, HermesEvidenceLayer, HermesRuntimeEvalLayer).pipe(
  Layer.provide(AdapterLayer),
)

/**
 * The complete composition-root Layer providing every service the dispatcher
 * needs to run a command end-to-end on Node:
 *   - the three dangerous capabilities (constructed; injected only by the gate),
 *   - the domain `Fs` port (node-backed),
 *   - the protocols Metro probe + Hermes CDP (loopback + Origin + bounded),
 *   - the Id service (collision-resistant ids, AC-034),
 * all resting on the `@effect/platform-node` foundation.
 *
 * The capability layers depend on `Subprocess`/`HermesRuntimeEval`, so the
 * adapter + protocols layers are provided beneath them.
 */
export const AppLayer = Layer.mergeAll(
  DeviceCapabilityLayer,
  RuntimeEvalCapabilityLayer,
  SourceWriteCapabilityLayer,
  NodeFsLayer,
  IdDefault,
).pipe(
  // The capabilities depend on Subprocess (device) and HermesRuntimeEval
  // (runtime-eval); provide BOTH the protocols and the leaf adapters beneath,
  // re-exporting them so the rest of the system can also reach Metro/Hermes.
  Layer.provideMerge(Layer.mergeAll(ProtocolsLayer, AdapterLayer)),
  Layer.provideMerge(PlatformLayer),
)
