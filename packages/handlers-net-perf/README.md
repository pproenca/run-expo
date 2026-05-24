# `@expo98/handlers-net-perf`

D11 network-evidence + performance command handlers for the Effect-TS rebuild of
`expo98`: `network` (`requests`/`waterfall`/`har`) and `perf`
(`summary`/`interaction`/`report`/`action`/`bundle`/`compare`/`budget`/`memgraph`).

Everything in this package is **PURE post-processing** of an already-harvested
evidence payload. It is tested directly and exhaustively against literal inputs —
**no sockets are opened here**.

## The CDP capability seam (read-eval) — documented, not implemented here

Live `network`/`perf` evidence is harvested over CDP by evaluating a **FIXED,
package-controlled read-only expression** through `@expo98/protocols`'
`HermesEvidence.evaluateReadOnly` (the read-eval surface a `read`-classed handler
legitimately uses). This package **never** imports `HermesRuntimeEval` (the
withheld arbitrary-JS mutation surface). The harvest itself is the documented
capability seam; the derivations below take the harvested payload as a plain
value, so they are unit-testable without a running Hermes.

The single HAR file write goes through core's `confinePath` (AC-013) before any
`mkdir`/write — no other I/O happens in this package.

## AC → source → test map

| AC | What | Source | Test |
|---|---|---|---|
| **AC-045** | network waterfall (numeric `durationMs`, sort desc, top 50, `slowThresholdMs=500`, `slowRequestCount`=ranked≥500); duplicates by `<method> <origin><path\|url>` keep >1; HAR `version "1.2"`, `time=durationMs??0`, query+cookies emptied, inferred `endedAt`; `status`/`ok`/`responseBytes` fallback chain, `retryCount??0` | `network.ts` | `test/network.test.ts` |
| **AC-013** | HAR `--output-path` confined under the artifacts root (FIX); `../`/absolute/sibling-prefix escapes rejected | `network.ts` (`confineHarOutputPath` → core `confinePath`) | `test/network.test.ts` |
| **AC-022** | network shape validation REUSED from `@expo98/protocols` (not re-implemented); re-exported | `@expo98/protocols` | `test/network.test.ts` |
| **AC-046** | finding thresholds: network slow≥500 (high≥1000), render worst commit≥16.7 (high≥50), frames `droppedFrameCount ?? count(deltaMs>33.4)` flagged>0 (high≥5) | `perf-report.ts` | `test/perf-thresholds.test.ts` |
| **AC-047** | `avgFps=round((1000/mean(deltaMs))*10)/10`, `droppedFrameCount=count(delta>FRAME_2)`, `longFrameCount=count(delta>FRAME_1)`, `worstFrameMs=max`, stats over last 300, retain 1000, `deltaMs=round((ts−lastTs)*10)/10` | `perf-frames.ts` | `test/perf-thresholds.test.ts` |
| **AC-048** | confidence rollup: empty→low, any high→high, else any medium→medium else low; `lowerConfidence(a,b)` | `perf-confidence.ts` | `test/perf-thresholds.test.ts` |
| **AC-049** | direction-aware compare (FIX): `delta=candidate−baseline`, `confidence=lowerConfidence`, `improved` per metric DIRECTION | `perf-compare.ts` | `test/perf-compare-budget-memory.test.ts` |
| **AC-050** | budget fail-closed: `passed = value is number && (max===undefined\|\|value≤max) && (min===undefined\|\|value≥min)`; missing metric→null→fail; overall `every` | `perf-budget.ts` | `test/perf-compare-budget-memory.test.ts` |
| **AC-051** | memory-leak claim: `samples=clamp(args.samples??1,1,100)`; confidence medium iff samples≥2 OR native artifact else low; `leakClaim.allowed = samples≥2 \|\| Boolean(nativeArtifact)` | `perf-memory.ts` | `test/perf-compare-budget-memory.test.ts` |
| **AC-052** | native macOS `sample` parse (PRESERVE): footprint/peak/main-thread/idle/busy, hermes/yoga/mounting/coreAnimation/uiKit buckets, top 30 symbols, available iff any footprint/symbols | `native-sample.ts` | `test/native-sample.test.ts` |

## AC-047 — the frame-budget CORRECTION (Q#18)

The legacy frame budgets `16.7` / `33.4` are **not** exact 60fps multiples.
Per the committee decision (MODERNIZATION_BRIEF §6, Q#18, 2026-05-24) the
greenfield FPS calc (`perf-frames.ts`) uses the **EXACT** budgets:

- `FRAME_1 = 16.67` (one 60fps frame) → `longFrameCount`
- `FRAME_2 = 33.33` (two 60fps frames) → `droppedFrameCount`

The legacy `16.7`/`33.4` are noted in a code comment for traceability. The test
pins the divergence: a `33.34ms` frame **is** counted as dropped at `>33.33` (the
legacy `>33.4` would have missed it).

> Note: the **AC-046 finding triggers** (`perf-report.ts`) keep the legacy
> `16.7`/`33.4` values — those are the "is this worth flagging" gates and were
> **not** in the Q#18 correction set, so they remain PRESERVED as the AC-046 spec.
> Only the AC-047 FPS-calc budgets were corrected.

## AC-049 — direction-aware comparison (the FIX)

The legacy hardcoded `improved = candidate ≤ baseline` for **every** metric, so
an **FPS gain was marked NOT improved**. The greenfield branches on each metric's
direction (`perf-compare.ts`):

- **higher-is-better** (improved iff candidate > baseline): the Q#15 set —
  `avgFps`, throughput / req-per-sec, counts-of-good (matched by exact name and
  by well-known shape, e.g. `interaction.avgFps`, `network.throughput`).
- **lower-is-better** (improved iff candidate < baseline): everything else
  (latency, dropped/long-frame counts, footprint, …).

The test asserts the FIX directly: an FPS gain (45 → 60) is `improved:true`, and
it also computes the legacy buggy result (`60 ≤ 45 → false`) and asserts our
result diverges from it. A latency drop (800 → 300) is `improved:true`. "No
change" is `improved:false` (also corrects the legacy `≤`, which counted equality
as improved).

## AC-052 — assumed `sample` version (PRESERVE)

The parser is a deliberately brittle regex parse, PRESERVED. The assumed format
is pinned in `native-sample.ts`: the macOS command-line `/usr/bin/sample` (not
the Instruments.app GUI export), macOS Sonoma 14.x / Xcode 15.x Command Line
Tools (Instruments 15.x toolchain).

## Skipped (require a live device)

- `test/network.test.ts` — `it.skip("AC-045 live network capture against a
  running Hermes …")` — needs a running Metro + Hermes; harvest is the read-eval
  CDP seam. All derivation logic is fully covered.
- `test/perf-compare-budget-memory.test.ts` — `it.skip("AC-046/047/049 live perf
  capture …")` — same reason; all calc is fully covered.

## Boundary rule

This package depends on `@expo98/core` (`confinePath`, `PathEscape`) and
`@expo98/protocols` (`validateNetworkEvidence`, `clamp`, `resolveMetroPort`). It
**never** reaches a runtime-eval / device capability — every export is a pure
calculation or the single confined HAR path.
