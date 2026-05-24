/**
 * Native macOS `sample`/Instruments text artifact parser (AC-052 — PRESERVE). PURE.
 *
 * Re-spec of the legacy `parseNativeSampleArtifact`, behaviour-faithful. This is
 * a deliberately BRITTLE regex parse of the `sample(1)` textual output; AC-052's
 * verdict is PRESERVE (reproduce the legacy behaviour exactly), so the patterns
 * and the bucket set are ported verbatim — do NOT "improve" them.
 *
 * ASSUMED FORMAT (pinned per Q#15/AC-052, MODERNIZATION_BRIEF §6 — committee
 * 2026-05-24, "preserve the macOS `sample` parser with the assumed Instruments
 * version pinned in a comment"):
 *
 *   Tool:            /usr/bin/sample (macOS command-line `sample`, NOT the
 *                    Instruments.app GUI export).
 *   macOS / Xcode:   macOS Sonoma 14.x, Xcode 15.x Command Line Tools
 *                    (Instruments 15.x toolchain). This is the assumed version
 *                    whose text layout these regexes target.
 *   Expected lines:  "Physical footprint:        NNN.NM"
 *                    "Physical footprint (peak): NNN.NM"
 *                    "Call graph:\n   <count> Thread_<id>: Main Thread …"
 *                    indented "  <count>  <symbol> (in <library>)" frames.
 *
 * Output contract (AC-052):
 *   - `physicalFootprintMb` / `peakFootprintMb` (numbers or null).
 *   - `mainThreadSamples` (number or null).
 *   - `idleSamples` = Σ counts on lines matching `mach_msg | CFRunLoopServiceMachPort`.
 *   - bucket counts: hermes / yoga / mounting / coreAnimation / uiKit.
 *   - `estimatedMainThreadBusySamples = max(0, mainThreadSamples − idleSamples)`
 *     (null when `mainThreadSamples` is null).
 *   - `topSymbols`: the first 30 `<count> <symbol> (in <library>)` frames.
 *   - `available` if ANY footprint OR ≥1 top symbol was found.
 */

export interface NativeSampleSymbol {
  readonly samples: number
  readonly symbol: string
  readonly library: string
}

export interface NativeSampleBuckets {
  readonly hermes: number
  readonly yoga: number
  readonly mounting: number
  readonly coreAnimation: number
  readonly uiKit: number
}

export interface NativeSampleSummary {
  readonly available: boolean
  readonly bytes: number
  readonly physicalFootprintMb: number | null
  readonly peakFootprintMb: number | null
  readonly mainThreadSamples: number | null
  readonly estimatedMainThreadIdleSamples: number
  readonly estimatedMainThreadBusySamples: number | null
  readonly buckets: NativeSampleBuckets
  readonly topSymbols: ReadonlyArray<NativeSampleSymbol>
}

/** First capture group of `pattern` as a number, else null. PURE. */
const numberFromMatch = (text: string, pattern: RegExp): number | null => {
  const match = pattern.exec(text)
  return match && match[1] !== undefined ? Number(match[1]) : null
}

/**
 * Σ leading sample counts on lines matching ANY pattern; a matching line with no
 * leading count contributes 1 (legacy semantics). PURE.
 */
const countSampleBucket = (text: string, patterns: ReadonlyArray<RegExp>): number => {
  let count = 0
  for (const line of text.split(/\r?\n/)) {
    if (!patterns.some((pattern) => pattern.test(line))) {
      continue
    }
    const match = /^\s*[+!:| ]*\s*(\d+)\s+/.exec(line)
    count += match && match[1] !== undefined ? Number(match[1]) : 1
  }
  return count
}

/**
 * Parse macOS `sample` text into a {@link NativeSampleSummary} (AC-052). PURE —
 * the caller is responsible for reading the file (the live capture is the
 * documented read seam). Pass the raw text; `null`/empty → unavailable.
 */
export const parseNativeSample = (text: string | null): NativeSampleSummary => {
  if (text === null || text.length === 0) {
    return {
      available: false,
      bytes: 0,
      physicalFootprintMb: null,
      peakFootprintMb: null,
      mainThreadSamples: null,
      estimatedMainThreadIdleSamples: 0,
      estimatedMainThreadBusySamples: null,
      buckets: { hermes: 0, yoga: 0, mounting: 0, coreAnimation: 0, uiKit: 0 },
      topSymbols: []
    }
  }

  const physicalFootprintMb = numberFromMatch(text, /Physical footprint:\s+([0-9.]+)M/)
  const peakFootprintMb = numberFromMatch(text, /Physical footprint \(peak\):\s+([0-9.]+)M/)
  const mainThreadSamples = numberFromMatch(
    text,
    /Call graph:\s*\n\s+(\d+)\s+Thread_[^:\n]+:\s+Main Thread/s
  )
  const idleSamples = countSampleBucket(text, [/mach_msg/i, /CFRunLoopServiceMachPort/i])
  const buckets: NativeSampleBuckets = {
    hermes: countSampleBucket(text, [/hermes/i]),
    yoga: countSampleBucket(text, [/yoga/i]),
    mounting: countSampleBucket(text, [/RCTMountingManager/i, /RCTPerformMountInstructions/i]),
    coreAnimation: countSampleBucket(text, [/QuartzCore/i, /CA::Layer/i, /CoreAnimation/i]),
    uiKit: countSampleBucket(text, [/UIKitCore/i])
  }
  const topSymbols: Array<NativeSampleSymbol> = [
    ...text.matchAll(/^\s*([0-9]+)\s+(.+?)\s+\(in\s+(.+?)\)/gm)
  ]
    .slice(0, 30)
    .map((match) => ({
      samples: Number(match[1]),
      symbol: (match[2] ?? "").trim(),
      library: (match[3] ?? "").trim()
    }))

  return {
    available: Boolean(physicalFootprintMb || peakFootprintMb || topSymbols.length),
    bytes: byteLength(text),
    physicalFootprintMb,
    peakFootprintMb,
    mainThreadSamples,
    estimatedMainThreadIdleSamples: idleSamples,
    estimatedMainThreadBusySamples:
      mainThreadSamples === null ? null : Math.max(0, mainThreadSamples - idleSamples),
    buckets,
    topSymbols
  }
}

/** UTF-8 byte length without depending on Node's `Buffer` type at the surface. PURE. */
const byteLength = (text: string): number => new TextEncoder().encode(text).length
