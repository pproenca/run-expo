import { CliRuntimeError, command, gate, redact } from "@expo98/core"
import { Effect } from "effect"
import {
  type CommandContext,
  type CommandRegistration,
  registration
} from "./registry.js"

/**
 * The proof READ commands wired end-to-end THROUGH core's dispatch (S12).
 *
 * These five `read`-classed commands prove the composition root: argv → globals
 * → policy → typed core command → dispatch (classify → gate → redact+truncate) →
 * envelope. Their handlers' `R` is `never` (read class) — they cannot name a
 * dangerous capability, by type. The remaining ~68 commands are owned by the
 * deferred `handlers-*` packages (see the SEAM in `registry.ts`).
 *
 * Wired this round: `policy show`, `redact <file>`, `doctor`, `skills list`,
 * `version`.
 */

/** The CLI version reported by `version` and `--version`. */
export const CLI_VERSION = "0.0.0"

// ── policy show — render the effective PolicyDecision for an action (AC-001). ─
const policyShow = registration({
  path: "policy show",
  summary: "Show the effective policy decision for an action.",
  sideEffect: "read",
  build: (ctx: CommandContext) =>
    command(
      { action: "policy", sideEffect: "read" } as const,
      Effect.sync(() => {
        // `policy show [action]` — evaluate the gate for the named action as a
        // `device`-classed action (the representative gated class), revealing the
        // effective decision under the resolved policy. Reads always allow.
        const action = ctx.positionals[0] ?? "policy"
        const decision = gate({ action, sideEffect: "device" }, ctx.policy)
        return {
          available: true,
          action,
          policy: ctx.policy,
          decision: decision._tag,
          denied: decision._tag === "deny",
          reason: decision._tag === "deny" ? decision.payload.reason : null
        }
      })
    )
})

// ── redact <file> — read a file and emit its redacted contents (AC-003/012). ─
const redactFile = registration({
  path: "redact",
  summary: "Read a file and emit its redacted contents.",
  sideEffect: "read",
  build: (ctx: CommandContext) =>
    command(
      { action: "redact", sideEffect: "read" } as const,
      Effect.gen(function* () {
        const file = ctx.positionals[0]
        if (file === undefined) {
          return yield* Effect.fail(
            new CliRuntimeError({ message: "redact requires a <file> argument." })
          )
        }
        // `redact` is a `read` command, so its `R` stays `never` (cannot name a
        // dangerous capability). It uses the benign `Fs` port via the context —
        // not the capability `R` channel — so the withholding contract holds.
        const raw = yield* ctx.fs.readFile(file).pipe(
          Effect.mapError(
            (e) => new CliRuntimeError({ message: `Cannot read ${file}: ${e.reason}` })
          )
        )
        // Redact at the value boundary; dispatch redacts again (idempotent).
        const parsed = tryParseJson(raw)
        return {
          available: true,
          file,
          redacted: redact(parsed)
        }
      })
    )
})

// ── doctor — capability/environment readiness summary (read). ────────────────
const doctor = registration({
  path: "doctor",
  summary: "Report tool/capability readiness.",
  sideEffect: "read",
  build: () =>
    command(
      { action: "doctor", sideEffect: "read" } as const,
      Effect.succeed({
        available: true,
        node: process.version,
        platform: process.platform,
        // INTEGRATION SEAM: real xcrun/simctl/axe/idb capability probes live in
        // the deferred `handlers-*` packages (via the Subprocess service). The
        // shell proves the read envelope path; capabilities default to unknown.
        capabilities: {
          xcrun: "unknown",
          simctl: "unknown",
          axe: "unknown",
          idb: "unknown"
        }
      })
    )
})

// ── skills list — list bundled skill ids (static read). ──────────────────────
const skillsList = registration({
  path: "skills list",
  summary: "List bundled skill guidance ids.",
  sideEffect: "read",
  build: () =>
    command(
      { action: "skills", sideEffect: "read" } as const,
      Effect.succeed({
        available: true,
        // INTEGRATION SEAM: the bundled skill catalog is owned by the deferred
        // discovery handler package; the shell proves the read envelope.
        skills: [] as ReadonlyArray<string>
      })
    )
})

// ── version — report the CLI version (read). ─────────────────────────────────
const version = registration({
  path: "version",
  summary: "Report the expo98 CLI version.",
  sideEffect: "read",
  build: () =>
    command(
      { action: "version", sideEffect: "read" } as const,
      Effect.succeed({ available: true, version: CLI_VERSION })
    )
})

/** The core READ proof-commands, in a stable order. */
export const coreReadCommands: ReadonlyArray<CommandRegistration> = [
  doctor,
  policyShow,
  redactFile,
  skillsList,
  version
]

/** Best-effort JSON parse; falls back to the raw string for non-JSON files. */
const tryParseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
