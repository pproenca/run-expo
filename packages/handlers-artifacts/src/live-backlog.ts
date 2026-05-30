/**
 * `live-backlog` — D12 source-derived command matrix (AC-057, AC-058).
 *
 * The legacy runner baked developer-specific fixtures into the matrix
 * (`com.maddie.console`, `exp+maddie://…127.0.0.1%3A8081`, `booted`) and ran them
 * verbatim. This rebuild makes those REQUIRED PROJECT INPUTS (AC-058 / brief Q#14):
 * the substitution resolver fails closed with a clear error if a required input
 * is missing — it NEVER falls back to a baked fixture. `__METRO_PORT__` is the one
 * placeholder with a documented default (`metroPort ?? 8081`, AC-038).
 *
 * Each matrix row, after execution, is classified from its EVIDENCE (AC-057):
 * exit code + runtime requirements + a live-evidence signal supplied through a
 * DOCUMENTED SEAM (`LiveEvidenceProbe`), so the classifier stays pure and the real
 * "is the app live?" detection (WS URLs / CDP calls / running packager / non-empty
 * targets) is injectable and testable with a fake.
 *
 * All three verbs (`generate`/`matrix`/`run`) are `read` (handler R = never): they
 * read the source-derived backlog, substitute project inputs, and classify rows.
 * The actual command execution for `run` against a live environment is the one
 * SKIPPED acceptance test (it needs a running Metro/Hermes/simulator).
 */
import { command, type Command } from "@expo98/core"
import { DEFAULT_METRO_PORT, clamp, MAX_PORT, MIN_PORT } from "@expo98/protocols"
import { Effect } from "effect"
import { summarizeBacklogPayload } from "./summary.js"
import { descriptor } from "./support.js"

// ──────────────────────────────────────────────────────────────────────────
// AC-058 — backlog substitutions are PROJECT INPUTS, never baked fixtures.
// ──────────────────────────────────────────────────────────────────────────

/** The matrix placeholders the runner substitutes (AC-058). */
export type BacklogPlaceholder = "__METRO_PORT__" | "__BUNDLE_ID__" | "__DEVICE__" | "__DEV_CLIENT_URL__"

export const BACKLOG_PLACEHOLDERS: ReadonlyArray<BacklogPlaceholder> = [
  "__METRO_PORT__",
  "__BUNDLE_ID__",
  "__DEVICE__",
  "__DEV_CLIENT_URL__",
]

/**
 * Project-supplied backlog inputs (AC-058). `metroPort` is optional (defaults to
 * 8081 via AC-038). The other three are REQUIRED to substitute their placeholder
 * — a missing one is a usage error, NOT a baked default.
 */
export interface BacklogInputs {
  /** `__METRO_PORT__` → `clamp(metroPort ?? 8081, 1, 65535)`. */
  readonly metroPort?: number
  /** `__BUNDLE_ID__` — REQUIRED project config (legacy baked `com.maddie.console`). */
  readonly bundleId?: string
  /** `__DEVICE__` — REQUIRED project config (legacy baked `booted`). */
  readonly device?: string
  /** `__DEV_CLIENT_URL__` — REQUIRED project config (legacy baked `exp+maddie://…`). */
  readonly devClientUrl?: string
}

/** A clear, typed failure when a required substitution input is missing (AC-058). */
export class MissingBacklogInput extends Error {
  readonly _tag = "MissingBacklogInput" as const
  readonly placeholder: BacklogPlaceholder
  readonly inputName: "bundleId" | "device" | "devClientUrl"
  constructor(placeholder: BacklogPlaceholder, inputName: "bundleId" | "device" | "devClientUrl") {
    super(
      `Live-backlog placeholder ${placeholder} requires the project input "${inputName}". ` +
        `Provide it via project config — there is no baked default.`,
    )
    this.placeholder = placeholder
    this.inputName = inputName
    this.name = "MissingBacklogInput"
  }
}

/** AC-058: resolve `__METRO_PORT__` → `clamp(metroPort ?? 8081, 1, 65535)`. */
export const resolveMetroPort = (metroPort: number | undefined): number =>
  clamp(metroPort ?? DEFAULT_METRO_PORT, MIN_PORT, MAX_PORT)

/**
 * Resolve a single placeholder against project inputs (AC-058).
 *
 * `__METRO_PORT__` resolves to the clamped port; the other three resolve ONLY
 * from required inputs. A missing required input throws `MissingBacklogInput` —
 * the rebuild NEVER substitutes a developer fixture. The result is an `Either`
 * encoded as a tagged union so callers can collect every missing input.
 */
export type ResolvedSubstitution =
  | { readonly _tag: "resolved"; readonly placeholder: BacklogPlaceholder; readonly value: string }
  | { readonly _tag: "missing"; readonly error: MissingBacklogInput }

export const resolveSubstitution = (placeholder: BacklogPlaceholder, inputs: BacklogInputs): ResolvedSubstitution => {
  switch (placeholder) {
    case "__METRO_PORT__":
      return {
        _tag: "resolved",
        placeholder,
        value: String(resolveMetroPort(inputs.metroPort)),
      }
    case "__BUNDLE_ID__":
      return inputs.bundleId === undefined || inputs.bundleId === ""
        ? { _tag: "missing", error: new MissingBacklogInput(placeholder, "bundleId") }
        : { _tag: "resolved", placeholder, value: inputs.bundleId }
    case "__DEVICE__":
      return inputs.device === undefined || inputs.device === ""
        ? { _tag: "missing", error: new MissingBacklogInput(placeholder, "device") }
        : { _tag: "resolved", placeholder, value: inputs.device }
    case "__DEV_CLIENT_URL__":
      return inputs.devClientUrl === undefined || inputs.devClientUrl === ""
        ? { _tag: "missing", error: new MissingBacklogInput(placeholder, "devClientUrl") }
        : { _tag: "resolved", placeholder, value: inputs.devClientUrl }
  }
}

/**
 * Build the full substitution map from project inputs (AC-058). All four
 * placeholders are resolved; every missing required input is collected and
 * surfaced together so the caller sees the complete set of what to supply.
 */
export interface SubstitutionMap {
  readonly values: Readonly<Record<BacklogPlaceholder, string>>
}

export type SubstitutionResolution =
  | { readonly _tag: "ok"; readonly map: SubstitutionMap }
  | { readonly _tag: "missing"; readonly errors: ReadonlyArray<MissingBacklogInput> }

export const resolveSubstitutions = (inputs: BacklogInputs): SubstitutionResolution => {
  const values: Partial<Record<BacklogPlaceholder, string>> = {}
  const errors: Array<MissingBacklogInput> = []
  for (const placeholder of BACKLOG_PLACEHOLDERS) {
    const resolved = resolveSubstitution(placeholder, inputs)
    if (resolved._tag === "resolved") {
      values[placeholder] = resolved.value
    } else {
      errors.push(resolved.error)
    }
  }
  if (errors.length > 0) {
    return { _tag: "missing", errors }
  }
  return { _tag: "ok", map: { values: values as Record<BacklogPlaceholder, string> } }
}

/**
 * Apply a resolved substitution map to a single template argv token. Every
 * occurrence of every placeholder is replaced; non-placeholder text is untouched.
 */
export const applySubstitutions = (token: string, map: SubstitutionMap): string => {
  let out = token
  for (const placeholder of BACKLOG_PLACEHOLDERS) {
    out = out.split(placeholder).join(map.values[placeholder])
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────────
// AC-057 — classify each command row from its evidence.
// ──────────────────────────────────────────────────────────────────────────

/** The runtime requirements a row can declare (AC-057 requirement set). */
export type RuntimeRequirement = "metro" | "metro-message" | "hermes-target" | "app-bridge"

export const RUNTIME_REQUIREMENTS: ReadonlyArray<RuntimeRequirement> = [
  "metro",
  "metro-message",
  "hermes-target",
  "app-bridge",
]

/** The AC-057 classification labels. */
export type RowClassification =
  | "expected-usage-error"
  | "environment-blocked"
  | "designed-unavailable"
  | "defect"
  | "live-pass"
  | "static-pass"

/**
 * The DOCUMENTED LIVE-EVIDENCE SEAM (AC-057 parameters).
 *
 * Live-evidence detection requires WS URLs / CDP calls / a running packager /
 * non-empty targets. Rather than re-implement that probe inline (it needs a live
 * environment), this is a pure signal the runner injects — the real probe lives
 * behind `@expo98/protocols` (Metro `/json/list` non-empty, CDP `webSocketDebuggerUrl`,
 * a Hermes evaluate round-trip). Tests pass a fake signal; the live `run` path
 * (skipped) wires the real probe.
 */
export interface LiveEvidenceSignal {
  /** A non-empty Hermes/Metro target list was observed. */
  readonly hasTargets: boolean
  /** ≥1 CDP `Runtime.evaluate` round-trip succeeded. */
  readonly hasCdpCalls: boolean
  /** A `webSocketDebuggerUrl` was observed (live debugger). */
  readonly hasWsUrls: boolean
  /** A running Metro packager responded. */
  readonly hasRunningPackager: boolean
}

/** Does the signal indicate ANY live evidence? (AC-057 parameter set.) */
export const hasLiveEvidence = (signal: LiveEvidenceSignal): boolean =>
  signal.hasTargets || signal.hasCdpCalls || signal.hasWsUrls || signal.hasRunningPackager

/** The evidence a single executed backlog row produces. */
export interface RowEvidence {
  /** The process exit code of the command (0 success, 2 usage error, etc.). */
  readonly exitCode: number
  /** The runtime requirements this row's command depends on. */
  readonly requirements: ReadonlyArray<RuntimeRequirement>
  /** Whether the command's payload reported `available:false` (designed-unavailable). */
  readonly availableFalse: boolean
  /**
   * For an `available:false` row, the stable unavailable `code` (e.g.
   * `no-runtime-target`, `policy-denied`) — used to refine the classification.
   */
  readonly unavailableCode?: string
  /** The injected live-evidence signal (the documented seam). */
  readonly liveEvidence: LiveEvidenceSignal
}

/** Codes whose `available:false` is a designed, environment-independent outcome. */
const DESIGNED_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "policy-denied",
  "external-annotation-server-removed",
  "designed-unavailable",
])

/** Codes whose `available:false` reflects a missing live environment. */
const ENVIRONMENT_CODES: ReadonlySet<string> = new Set([
  "no-runtime-target",
  "transport-failure",
  "missing-bridge",
  "stale-bridge",
  "incompatible-project",
  "unavailable-bridge",
  "version-mismatch",
  "missing-domain",
])

/**
 * AC-057 — classify a backlog row from its evidence. PURE.
 *
 * Order of the branches mirrors the rule:
 *   1. exit 2                                   → `expected-usage-error`
 *   2. `available:false`                        → designed-unavailable / environment-blocked /
 *                                                 expected-usage-error (by code + requirements)
 *   3. non-zero exit (other than 2)             → environment-blocked (if requirements) else defect
 *   4. exit 0 WITH a runtime requirement but NO
 *      live evidence                            → environment-blocked
 *   5. else                                     → live-pass (had requirements + live evidence)
 *                                                 / static-pass (no requirements)
 */
export const classifyRow = (evidence: RowEvidence): RowClassification => {
  const hasRequirements = evidence.requirements.length > 0
  const live = hasLiveEvidence(evidence.liveEvidence)

  // 1. A usage error (exit 2) is always an expected-usage-error.
  if (evidence.exitCode === 2) {
    return "expected-usage-error"
  }

  // 2. available:false splits by the unavailable code + whether the row has
  //    runtime requirements.
  if (evidence.availableFalse) {
    const code = evidence.unavailableCode
    if (code !== undefined && DESIGNED_UNAVAILABLE_CODES.has(code)) {
      return "designed-unavailable"
    }
    if (code !== undefined && ENVIRONMENT_CODES.has(code)) {
      return "environment-blocked"
    }
    // Unknown code: a row with runtime requirements is environment-blocked;
    // otherwise it is a designed-unavailable usage outcome.
    return hasRequirements ? "environment-blocked" : "expected-usage-error"
  }

  // 3. A non-zero, non-usage exit: blocked by environment if the row needs one,
  //    otherwise a genuine defect.
  if (evidence.exitCode !== 0) {
    return hasRequirements ? "environment-blocked" : "defect"
  }

  // 4. exit 0 but the row needs a live runtime and produced no live evidence:
  //    it only "passed" because nothing was there to exercise.
  if (hasRequirements && !live) {
    return "environment-blocked"
  }

  // 5. A real pass: live evidence present (live-pass) or no runtime needed
  //    (static-pass).
  return hasRequirements ? "live-pass" : "static-pass"
}

// ──────────────────────────────────────────────────────────────────────────
// The source-derived matrix template (placeholders, NOT fixtures).
// ──────────────────────────────────────────────────────────────────────────

/** A single backlog matrix template row: command + argv carrying placeholders. */
export interface BacklogTemplateRow {
  readonly id: string
  readonly command: string
  /** argv tokens; may contain `__METRO_PORT__`/`__BUNDLE_ID__`/… placeholders. */
  readonly argv: ReadonlyArray<string>
  readonly requirements: ReadonlyArray<RuntimeRequirement>
}

/**
 * The source-derived matrix template. Placeholders are LITERAL placeholder
 * tokens — NOT `com.maddie.console` / `exp+maddie://` / `booted`. They are
 * substituted from project inputs at `run` time (AC-058).
 */
export const BACKLOG_TEMPLATE: ReadonlyArray<BacklogTemplateRow> = [
  {
    id: "metro-status",
    command: "metro",
    argv: ["status", "--metro-port", "__METRO_PORT__"],
    requirements: ["metro"],
  },
  {
    id: "launch-app",
    command: "launch-app",
    argv: ["--bundle-id", "__BUNDLE_ID__", "--device", "__DEVICE__", "--crash-check-ms", "1000"],
    requirements: ["app-bridge"],
  },
  {
    id: "open-route",
    command: "open-route",
    argv: ["--dev-client-url", "__DEV_CLIENT_URL__"],
    requirements: ["metro-message"],
  },
  {
    id: "routes",
    command: "routes",
    argv: ["--cwd", "."],
    requirements: [],
  },
  {
    id: "console",
    command: "console",
    argv: ["--metro-port", "__METRO_PORT__"],
    requirements: ["hermes-target"],
  },
]

/** A fully-substituted matrix row, ready to execute. */
export interface BacklogMatrixRow {
  readonly id: string
  readonly command: string
  readonly argv: ReadonlyArray<string>
  readonly requirements: ReadonlyArray<RuntimeRequirement>
}

/**
 * Build the substituted matrix from project inputs (AC-058). Returns the missing
 * inputs (collected) when any required substitution is absent — never a fixture.
 */
export type BacklogMatrixResult =
  | { readonly _tag: "ok"; readonly rows: ReadonlyArray<BacklogMatrixRow> }
  | { readonly _tag: "missing"; readonly errors: ReadonlyArray<MissingBacklogInput> }

export const buildMatrix = (inputs: BacklogInputs): BacklogMatrixResult => {
  const resolution = resolveSubstitutions(inputs)
  if (resolution._tag === "missing") {
    return { _tag: "missing", errors: resolution.errors }
  }
  const map = resolution.map
  const rows = BACKLOG_TEMPLATE.map(
    (row): BacklogMatrixRow => ({
      id: row.id,
      command: row.command,
      argv: row.argv.map((token) => applySubstitutions(token, map)),
      requirements: row.requirements,
    }),
  )
  return { _tag: "ok", rows }
}

// ──────────────────────────────────────────────────────────────────────────
// The three read command verbs.
// ──────────────────────────────────────────────────────────────────────────

export type LiveBacklogVerb = "generate" | "matrix" | "run"

export interface LiveBacklogArgs extends BacklogInputs {
  readonly verb: LiveBacklogVerb
}

/** `generate` result: the source-derived template (placeholders, no fixtures). */
export interface BacklogGenerateResult {
  readonly action: "live-backlog.generate"
  readonly verb: "generate"
  readonly template: ReadonlyArray<BacklogTemplateRow>
  readonly placeholders: ReadonlyArray<BacklogPlaceholder>
}

/** `matrix` result: the substituted matrix, or the missing required inputs. */
export interface BacklogMatrixCommandResult {
  readonly action: "live-backlog.matrix"
  readonly verb: "matrix"
  readonly available: boolean
  readonly rows: ReadonlyArray<BacklogMatrixRow>
  readonly missing: ReadonlyArray<string>
  readonly reason?: string
}

/**
 * `run` result: the substituted matrix + classified rows + the AC-042 backlog
 * summary. The `rows` evidence here is supplied by the caller (the live executor
 * lives in the skipped UAT); the classification + summary are pure and fully
 * tested.
 */
export interface BacklogRunRowResult {
  readonly id: string
  readonly command: string
  readonly argv: ReadonlyArray<string>
  readonly classification: RowClassification
  readonly exitCode: number | null
}

export interface BacklogRunResult {
  readonly action: "live-backlog.run"
  readonly verb: "run"
  readonly available: boolean
  readonly rows: ReadonlyArray<BacklogRunRowResult>
  readonly missing: ReadonlyArray<string>
  readonly reason?: string
  /** AC-042 backlog summary (`keys.slice(0,20)` + classification rollups). */
  readonly summary: ReturnType<typeof summarizeBacklogPayload>
}

/**
 * `live-backlog generate` — emit the source-derived template (read). No project
 * inputs needed: the template carries placeholders, not values.
 */
export const liveBacklogGenerateCommand = (): Command<"read", BacklogGenerateResult> =>
  command(
    descriptor("live-backlog.generate", "read"),
    Effect.succeed<BacklogGenerateResult>({
      action: "live-backlog.generate",
      verb: "generate",
      template: BACKLOG_TEMPLATE,
      placeholders: BACKLOG_PLACEHOLDERS,
    }),
  )

/**
 * `live-backlog matrix` — substitute project inputs into the template (read,
 * AC-058). A missing required input yields `available:false` with the list of
 * missing inputs — never a baked fixture.
 */
export const liveBacklogMatrixCommand = (inputs: BacklogInputs): Command<"read", BacklogMatrixCommandResult> =>
  command(
    descriptor("live-backlog.matrix", "read"),
    Effect.sync<BacklogMatrixCommandResult>(() => {
      const result = buildMatrix(inputs)
      if (result._tag === "missing") {
        return {
          action: "live-backlog.matrix",
          verb: "matrix",
          available: false,
          rows: [],
          missing: result.errors.map((e) => e.inputName),
          reason: result.errors.map((e) => e.message).join(" "),
        }
      }
      return {
        action: "live-backlog.matrix",
        verb: "matrix",
        available: true,
        rows: result.rows,
        missing: [],
      }
    }),
  )

/**
 * The per-row evidence the `run` executor produces, keyed by row id. In tests
 * this is a fake map; in the live (skipped) path it comes from dispatching each
 * matrix row and probing the live-evidence seam.
 */
export type RowEvidenceMap = Readonly<Record<string, RowEvidence>>

/**
 * `live-backlog run` — substitute, (the live executor runs each row), then
 * classify each row from its evidence and roll up the AC-042 backlog summary
 * (read). The evidence map is injected so the pure classification + summary are
 * fully testable without a live device.
 */
export const liveBacklogRunCommand = (
  inputs: BacklogInputs,
  evidence: RowEvidenceMap,
): Command<"read", BacklogRunResult> =>
  command(
    descriptor("live-backlog.run", "read"),
    Effect.sync<BacklogRunResult>(() => {
      const result = buildMatrix(inputs)
      if (result._tag === "missing") {
        const empty = { action: "live-backlog.run", verb: "run" as const, rows: [] }
        return {
          action: "live-backlog.run",
          verb: "run",
          available: false,
          rows: [],
          missing: result.errors.map((e) => e.inputName),
          reason: result.errors.map((e) => e.message).join(" "),
          summary: summarizeBacklogPayload(empty),
        }
      }
      const rows = result.rows.map((row): BacklogRunRowResult => {
        const rowEvidence = evidence[row.id]
        // A row with no captured evidence is treated as environment-blocked if it
        // had requirements, else a static pass — never a silent success.
        const classification =
          rowEvidence === undefined
            ? row.requirements.length > 0
              ? ("environment-blocked" as const)
              : ("static-pass" as const)
            : classifyRow(rowEvidence)
        return {
          id: row.id,
          command: row.command,
          argv: row.argv,
          classification,
          exitCode: rowEvidence?.exitCode ?? null,
        }
      })
      const payload = { action: "live-backlog.run", verb: "run" as const, rows }
      return {
        action: "live-backlog.run",
        verb: "run",
        available: true,
        rows,
        missing: [],
        summary: summarizeBacklogPayload(payload),
      }
    }),
  )
