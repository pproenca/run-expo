/**
 * On-disk layout (entities.md §1 / REIMAGINED_ARCHITECTURE §5 step 1).
 * The legacy directory layout is preserved VERBATIM so existing artifacts stay
 * readable with zero conversion. All joins are POSIX `/`.
 */

const join = (...parts: ReadonlyArray<string>): string =>
  parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .filter((p) => p.length > 0)
    .join("/")

/** A resolved state root, e.g. `<cwd>/.scratch/expo98` or `--state-dir`. */
export interface Layout {
  readonly stateRoot: string
}

export const makeLayout = (stateRoot: string): Layout => ({ stateRoot })

export const sessionsDir = (l: Layout): string => join(l.stateRoot, "sessions")

export const sessionDir = (l: Layout, sessionId: string): string => join(sessionsDir(l), sessionId)

export const sessionFile = (l: Layout, sessionId: string): string => join(sessionDir(l, sessionId), "session.json")

export const targetFile = (l: Layout, sessionId: string): string => join(sessionDir(l, sessionId), "target.json")

export const refsFile = (l: Layout, sessionId: string): string => join(sessionDir(l, sessionId), "refs.json")

export const snapshotsDir = (l: Layout, sessionId: string): string => join(sessionDir(l, sessionId), "snapshots")

export const snapshotFile = (l: Layout, sessionId: string, snapshotId: string): string =>
  join(snapshotsDir(l, sessionId), `${snapshotId}.json`)

/** Per-session artifact namespace (`session new` creates this, AC-024). */
export const artifactsDir = (l: Layout, sessionId: string): string => join(sessionDir(l, sessionId), "artifacts")

/**
 * Run records are keyed at `<stateDir>/<runId>.json`, sibling to (not inside)
 * sessions (entities.md: RunRecord aggregate). The legacy `runs`-parent quirk
 * is DROPPED — `--state-dir` is treated literally.
 */
export const runRecordFile = (stateDir: string, runId: string): string => join(stateDir, `${runId}.json`)

export { join as joinPath }
