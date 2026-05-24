/**
 * `install-state` — bridge install-state classifier (AC-027, a `read`).
 *
 * Reads project files via the domain `Fs` port (no source-write capability — this
 * is observational). Determines, for a project root:
 *
 *   1. no `expo` dependency                         → incompatible(missing-expo)
 *   2. metadata XOR source present                  → stale(partial-install)
 *   3. both present, version != 1.0.0 || schema != 1 → stale(version-mismatch)
 *   4. both, versions match, developmentOnly !== true → incompatible(not-development-only)
 *   5. both, versions match, dev-only               → present
 *   6. expo present but NEITHER file                → absent
 *
 * `// SEAM (Expo SDK)`: detecting the `expo` dependency for REAL would consult the
 * target's resolved dependency graph (`expo config` / `@expo/config-plugins`).
 * Here it is a `package.json` read over the same `Fs` port — sufficient for the
 * install-state decision and swappable for the SDK probe later.
 */
import { Fs } from "@expo98/domain"
import { Effect } from "effect"
import {
  BRIDGE_SCHEMA_VERSION,
  bridgeFilePaths,
  EXPO98_BRIDGE_VERSION
} from "./bridge-files.js"

export type InstallStatus = "absent" | "present" | "stale" | "incompatible"

export type InstallIssue =
  | "missing-expo"
  | "partial-install"
  | "version-mismatch"
  | "not-development-only"

export interface InstallStateResult {
  readonly status: InstallStatus
  /** The reason code when not `present`/`absent`; `null` otherwise. */
  readonly issue: InstallIssue | null
  readonly expoPresent: boolean
  readonly metadataPresent: boolean
  readonly sourcePresent: boolean
  /** Parsed metadata fields (best-effort), when the metadata file is present. */
  readonly bridgeVersion: string | null
  readonly schemaVersion: number | null
  readonly developmentOnly: boolean | null
}

/** A loosely-parsed metadata file (we classify rather than schema-decode). */
interface RawMetadata {
  readonly bridgeVersion: string | null
  readonly schemaVersion: number | null
  readonly developmentOnly: boolean | null
}

const EMPTY_META: RawMetadata = {
  bridgeVersion: null,
  schemaVersion: null,
  developmentOnly: null
}

/** Read a file's JSON, returning `undefined` on any read/parse failure. */
const readJson = (path: string): Effect.Effect<unknown, never, Fs> =>
  Fs.pipe(
    Effect.flatMap((fs) => fs.readFile(path)),
    Effect.map((text): unknown => {
      try {
        return JSON.parse(text) as unknown
      } catch {
        return undefined
      }
    }),
    Effect.orElseSucceed(() => undefined)
  )

/** Does the project declare an `expo` dependency? (package.json read seam.) */
const detectExpo = (root: string): Effect.Effect<boolean, never, Fs> =>
  readJson(`${root.replace(/\/+$/, "")}/package.json`).pipe(
    Effect.map((pkg) => {
      if (typeof pkg !== "object" || pkg === null) {
        return false
      }
      const record = pkg as Record<string, unknown>
      const deps = record["dependencies"]
      const devDeps = record["devDependencies"]
      const hasExpo = (block: unknown): boolean =>
        typeof block === "object" &&
        block !== null &&
        Object.prototype.hasOwnProperty.call(block, "expo")
      return hasExpo(deps) || hasExpo(devDeps)
    })
  )

const parseMetadata = (raw: unknown): RawMetadata => {
  if (typeof raw !== "object" || raw === null) {
    return EMPTY_META
  }
  const record = raw as Record<string, unknown>
  const bridgeVersion =
    typeof record["bridgeVersion"] === "string" ? record["bridgeVersion"] : null
  const schemaVersion =
    typeof record["schemaVersion"] === "number" ? record["schemaVersion"] : null
  const developmentOnly =
    typeof record["developmentOnly"] === "boolean"
      ? record["developmentOnly"]
      : null
  return { bridgeVersion, schemaVersion, developmentOnly }
}

const result = (
  status: InstallStatus,
  issue: InstallIssue | null,
  fields: {
    readonly expoPresent: boolean
    readonly metadataPresent: boolean
    readonly sourcePresent: boolean
    readonly meta: RawMetadata
  }
): InstallStateResult => ({
  status,
  issue,
  expoPresent: fields.expoPresent,
  metadataPresent: fields.metadataPresent,
  sourcePresent: fields.sourcePresent,
  bridgeVersion: fields.meta.bridgeVersion,
  schemaVersion: fields.meta.schemaVersion,
  developmentOnly: fields.meta.developmentOnly
})

/**
 * Classify the bridge install state for `root`. A pure `read` over the `Fs` port.
 */
export const readInstallState = (
  root: string
): Effect.Effect<InstallStateResult, never, Fs> =>
  Effect.gen(function* () {
    const fs = yield* Fs
    const paths = bridgeFilePaths(root)

    const expoPresent = yield* detectExpo(root)

    // metadata may be in `.expo98/bridge.json` or the legacy `.expo-ios/bridge.json`.
    const metaExists = yield* fs
      .exists(paths.metadata)
      .pipe(Effect.orElseSucceed(() => false))
    const legacyMetaExists = metaExists
      ? Effect.succeed(false)
      : fs.exists(paths.legacyMetadata).pipe(Effect.orElseSucceed(() => false))
    const metadataPresent = metaExists || (yield* legacyMetaExists)

    const sourcePresent = yield* fs
      .exists(paths.source)
      .pipe(Effect.orElseSucceed(() => false))

    const metaPath = metaExists ? paths.metadata : paths.legacyMetadata
    const meta = metadataPresent
      ? parseMetadata(yield* readJson(metaPath))
      : EMPTY_META

    const fields = { expoPresent, metadataPresent, sourcePresent, meta }

    // 1. No expo dependency → incompatible(missing-expo).
    if (!expoPresent) {
      return result("incompatible", "missing-expo", fields)
    }

    // 6. Expo present, neither file → absent.
    if (!metadataPresent && !sourcePresent) {
      return result("absent", null, fields)
    }

    // 2. metadata XOR source → stale(partial-install).
    if (metadataPresent !== sourcePresent) {
      return result("stale", "partial-install", fields)
    }

    // 3. both present, version/schema mismatch → stale(version-mismatch).
    if (
      meta.bridgeVersion !== EXPO98_BRIDGE_VERSION ||
      meta.schemaVersion !== BRIDGE_SCHEMA_VERSION
    ) {
      return result("stale", "version-mismatch", fields)
    }

    // 4. versions match, not dev-only → incompatible(not-development-only).
    if (meta.developmentOnly !== true) {
      return result("incompatible", "not-development-only", fields)
    }

    // 5. both, match, dev-only → present.
    return result("present", null, fields)
  })
