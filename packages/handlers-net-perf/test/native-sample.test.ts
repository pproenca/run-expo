/**
 * AC-052 — native macOS `sample` text parse (PRESERVE). PURE.
 *
 * Parses a representative `/usr/bin/sample` text fixture (assumed Instruments /
 * `sample` version pinned in `native-sample.ts`) and asserts the footprint,
 * main-thread / idle / busy sample math, the symbol buckets, and the top-symbol
 * extraction. AC-052 is PRESERVE — these assertions lock in the legacy behaviour.
 */
import { describe, expect, it } from "@effect/vitest"
import { parseNativeSample } from "@expo98/handlers-net-perf"

/**
 * A representative `sample` artifact. Two idle frames (mach_msg +
 * CFRunLoopServiceMachPort = 200 + 150 = 350 idle), plus hermes / yoga /
 * mounting / coreAnimation / uiKit busy frames. Main Thread reports 1000 samples.
 */
const FIXTURE = `Analysis of sampling MyApp (pid 4242) every 1 millisecond
Process:         MyApp [4242]
Path:            /Applications/MyApp.app/MyApp

Call graph:
    1000 Thread_55123: Main Thread  0x1
      200 mach_msg_trap  (in libsystem_kernel.dylib) + 8
      150 __CFRunLoopServiceMachPort  (in CoreFoundation) + 220
      120 facebook::hermes::HermesRuntime::evaluate  (in MyApp) + 44
       80 facebook::yoga::calculateLayoutInternal  (in MyApp) + 12
       60 -[RCTMountingManager performMount]  (in MyApp) + 90
       40 CA::Layer::commit  (in QuartzCore) + 30
       30 -[UIView layoutSubviews]  (in UIKitCore) + 16

Total number in stack (recursive counted multiple, when >=5):

Physical footprint:        184.5M
Physical footprint (peak): 222.0M
`

describe("AC-052 native sample parse (PRESERVE)", () => {
  const summary = parseNativeSample(FIXTURE)

  it("AC-052 available when footprint/symbols found", () => {
    expect(summary.available).toBe(true)
    expect(summary.bytes).toBeGreaterThan(0)
  })

  it("AC-052 physical + peak footprint Mb", () => {
    expect(summary.physicalFootprintMb).toBe(184.5)
    expect(summary.peakFootprintMb).toBe(222.0)
  })

  it("AC-052 mainThreadSamples from the Main Thread call-graph header", () => {
    expect(summary.mainThreadSamples).toBe(1000)
  })

  it("AC-052 idleSamples = Σ counts on mach_msg | CFRunLoopServiceMachPort lines", () => {
    expect(summary.estimatedMainThreadIdleSamples).toBe(350) // 200 + 150
  })

  it("AC-052 estimatedMainThreadBusySamples = max(0, main − idle)", () => {
    expect(summary.estimatedMainThreadBusySamples).toBe(650) // 1000 − 350
  })

  it("AC-052 buckets: hermes / yoga / mounting / coreAnimation / uiKit", () => {
    expect(summary.buckets.hermes).toBe(120)
    expect(summary.buckets.yoga).toBe(80)
    expect(summary.buckets.mounting).toBe(60)
    expect(summary.buckets.coreAnimation).toBe(40)
    expect(summary.buckets.uiKit).toBe(30)
  })

  it("AC-052 top symbols parsed `<count> <symbol> (in <library>)`", () => {
    // All seven frames match the `(in <lib>)` shape.
    expect(summary.topSymbols.length).toBe(7)
    const top = summary.topSymbols[0]
    expect(top?.samples).toBe(200)
    expect(top?.symbol).toBe("mach_msg_trap")
    expect(top?.library).toBe("libsystem_kernel.dylib")
    const hermes = summary.topSymbols.find((s) => s.symbol.includes("HermesRuntime"))
    expect(hermes?.library).toBe("MyApp")
  })

  it("AC-052 top symbols capped at 30", () => {
    const manyFrames = Array.from(
      { length: 40 },
      (_, i) => `      ${i + 1} symbol_${i}  (in Lib) + 4`
    ).join("\n")
    const text = `Call graph:\n    900 Thread_1: Main Thread\n${manyFrames}\nPhysical footprint:        10.0M\n`
    expect(parseNativeSample(text).topSymbols.length).toBe(30)
  })

  it("AC-052 unreadable / empty text → unavailable", () => {
    const none = parseNativeSample(null)
    expect(none.available).toBe(false)
    expect(none.physicalFootprintMb).toBeNull()
    expect(none.mainThreadSamples).toBeNull()
    expect(none.estimatedMainThreadBusySamples).toBeNull()
    expect(none.bytes).toBe(0)
    expect(parseNativeSample("").available).toBe(false)
  })

  it("AC-052 busy clamps to 0 when idle exceeds main-thread samples", () => {
    const text = `Call graph:\n    100 Thread_1: Main Thread\n      500 mach_msg  (in libsystem_kernel.dylib)\nPhysical footprint:        5.0M\n`
    const s = parseNativeSample(text)
    expect(s.mainThreadSamples).toBe(100)
    expect(s.estimatedMainThreadIdleSamples).toBe(500)
    expect(s.estimatedMainThreadBusySamples).toBe(0) // max(0, 100 − 500)
  })
})
