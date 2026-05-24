/**
 * `@expo98/app` — the CLI SHELL + composition root (S12) of the Effect-TS
 * rebuild of `expo98`.
 *
 * Public surface:
 *   - global flags → `CliGlobals` + the AC-015/016 pre-parse usage guard (N2),
 *   - the output envelope (json / plain / ndjson) with redaction + truncation,
 *   - the command registry + the node-backed Layer stack (composition root),
 *   - the runnable program (`runProgram` testable, `main` for the bins).
 *
 * The pure spine (`@expo98/core`) and the platform-agnostic ports
 * (`@expo98/domain` `Fs`, `@expo98/protocols` Metro/CDP) are discharged here
 * against `@effect/platform-node` — this is the ONLY package that names it.
 */

// Global flags + the AC-015/016 pre-parse guard (architecture finding N2).
export { assertUsage, type CliGlobals, globalOptions, VALUE_FLAGS, type ValueFlag } from "./globals.js"

// Output envelope (AC-003/012 redaction + AC-041 truncation at the boundary).
export { formatJson, formatPlain, type JsonEnvelope, ndjsonEnvelope, type OutputMode, selectMode } from "./envelope.js"

// Command registry + composition wiring.
export {
  type CommandContext,
  type CommandRegistration,
  eraseRegistration,
  registration,
  registerCommands,
  type Registry,
  runRegistered,
} from "./registry.js"

// The proof READ commands wired end-to-end through dispatch.
export { CLI_VERSION, coreReadCommands } from "./commands.js"

// The full handler / integration command surface registered into the shell.
export { handlerCommands } from "./all-commands.js"

// Effective-policy resolution from globals + --action-policy.
export { resolvePolicy } from "./policy-resolve.js"

// The node-backed Layer stack (composition root).
export { AppLayer, MetroHttpClientLayer, NodeFsLayer, NodeSubprocessLayer, PlatformLayer } from "./layers.js"

// The runnable program.
export { CLI_NAME, main, runProgram } from "./main.js"
