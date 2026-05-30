import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { type CliGlobals, mergeGlobals } from "run-expo"

/**
 * `mergeGlobals` folds the ROOT-scope globals (flags written BEFORE the
 * subcommand) with the SUBCOMMAND-scope globals (flags written AFTER it) so every
 * global flag is honoured in either textual position.
 *
 * The regression it pins: `@effect/cli` binds a flag to whichever scope it sits
 * in, and the shell used to read only the subcommand scope — so `--action-policy`
 * in the DOCUMENTED pre-verb position was silently dropped and the gate
 * fail-closed DENIED an action the policy file actually granted.
 */
const base: CliGlobals = {
  json: false,
  plain: false,
  ndjson: false,
  quiet: false,
  root: Option.none<string>(),
  stateDir: Option.none<string>(),
  actionPolicy: Option.none<string>(),
  maxOutput: Option.none<number>(),
  allowRuntimeEval: false,
  confirmActions: [],
  record: false,
  contentBoundaries: false,
  debug: false,
  noColor: false,
  noInput: false,
}

describe("mergeGlobals — position-independent global flags", () => {
  it("lifts --action-policy from the ROOT scope when the subcommand scope omits it", () => {
    const root: CliGlobals = { ...base, actionPolicy: Option.some("/p.json") }
    expect(mergeGlobals(root, base).actionPolicy).toStrictEqual(Option.some("/p.json"))
  })

  it("lifts --action-policy from the SUBCOMMAND scope when the root scope omits it", () => {
    const sub: CliGlobals = { ...base, actionPolicy: Option.some("/p.json") }
    expect(mergeGlobals(base, sub).actionPolicy).toStrictEqual(Option.some("/p.json"))
  })

  it("prefers the subcommand scope (closer to the verb) for a value flag set in both", () => {
    const root: CliGlobals = { ...base, actionPolicy: Option.some("/root.json") }
    const sub: CliGlobals = { ...base, actionPolicy: Option.some("/sub.json") }
    expect(mergeGlobals(root, sub).actionPolicy).toStrictEqual(Option.some("/sub.json"))
  })

  it("ORs booleans and de-dupes concatenated list flags across scopes", () => {
    const root: CliGlobals = { ...base, json: true, allowRuntimeEval: true, confirmActions: ["bridge-install"] }
    const sub: CliGlobals = { ...base, quiet: true, confirmActions: ["bridge-install", "screenshot"] }
    const merged = mergeGlobals(root, sub)
    expect(merged.json).toBe(true)
    expect(merged.quiet).toBe(true)
    expect(merged.allowRuntimeEval).toBe(true)
    expect(merged.confirmActions).toEqual(["bridge-install", "screenshot"])
  })
})
