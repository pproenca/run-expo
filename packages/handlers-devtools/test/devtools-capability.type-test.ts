/**
 * THE structural guarantee at THIS package's boundary (AC-010/AC-011).
 *
 * Reinforces core's compile-time withholding: a devtools handler CANNOT name the
 * runtime-eval (or device) capability unless the descriptor it is paired with via
 * `command(...)` declares the matching `sideEffect` class. The `@ts-expect-error`
 * lines below MUST fail to type-check — if the withholding ever regressed they
 * would start compiling and `tsc --noEmit` would error on the unused directive,
 * which is the regression alarm. `tsc` passing confirms the spine holds here too.
 *
 * This file is type-only; it is never executed.
 */
import {
  command,
  DeviceCapability,
  RuntimeEvalCapability
} from "@expo98/core"
import { descriptor } from "../src/support.js"
import { Effect } from "effect"

// An effect that REQUIRES the runtime-eval capability in its R channel.
const evalEffect = RuntimeEvalCapability.pipe(
  Effect.flatMap((e) => e.evaluate("globalThis.__EXPO98_TRACE__.start(200)"))
)
const deviceEffect = DeviceCapability.pipe(
  Effect.flatMap((d) => d.invoke("xcrun", ["simctl", "ui", "dev-menu"]))
)

// ── POSITIVE: a runtime-eval-classed devtools descriptor MAY pair with an
//    eval-requiring handler (this is exactly what `traceCommand` does). ──
const traceLikeOk = command(descriptor("trace.start", "runtime-eval"), evalEffect)
void traceLikeOk

// ── NEGATIVE: a read-classed devtools handler's R is `never` — it CANNOT name
//    the runtime-eval capability. This is the AC-010/AC-011 structural fix:
//    the legacy ungated `trace`/`inspector` path is now a COMPILE error. ──
const readCannotEval = command(
  descriptor("inspector.probe", "read"),
  // @ts-expect-error read-classed devtools handler cannot require RuntimeEvalCapability
  evalEffect
)
void readCannotEval

// A read-classed handler likewise cannot reach the device capability.
const readCannotDevice = command(
  descriptor("navigation.state", "read"),
  // @ts-expect-error read-classed devtools handler cannot require DeviceCapability
  deviceEffect
)
void readCannotDevice

// A device-classed handler (e.g. inspector open-dev-menu / navigation back)
// cannot smuggle the runtime-eval capability — only the device one.
const deviceCannotEval = command(
  descriptor("inspector.open-dev-menu", "device"),
  // @ts-expect-error device-classed devtools handler cannot require RuntimeEvalCapability
  evalEffect
)
void deviceCannotEval
