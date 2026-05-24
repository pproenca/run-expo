/**
 * THE structural guarantee at THIS package's boundary (AC-004 / AC-005).
 *
 * The D6/D7 handlers are `device`-classed (lifecycle, interaction) or, for
 * `wait.fn`, `runtime-eval`-classed. This file proves at the type level that a
 * `device`-classed (or `read`-classed) handler CANNOT name the runtime-eval
 * capability, and a `read`-classed handler cannot name the device capability.
 *
 * The `@ts-expect-error` lines below MUST fail to type-check — if the withholding
 * ever regressed they would start compiling and `tsc --noEmit` would error on the
 * unused directive, which is the regression alarm. `tsc` passing confirms the
 * spine holds at this boundary too.
 *
 * This file is type-only; it is never executed.
 */
import { command, DeviceCapability, RuntimeEvalCapability } from "@expo98/core"
import { Effect } from "effect"
import { descriptor } from "../src/support.js"

// An effect that REQUIRES the runtime-eval capability in its R channel.
const evalEffect = RuntimeEvalCapability.pipe(
  Effect.flatMap((e) => e.evaluate("Boolean(globalThis.ready)"))
)
// An effect that REQUIRES the device capability in its R channel.
const deviceEffect = DeviceCapability.pipe(
  Effect.flatMap((d) => d.invoke("xcrun", ["simctl", "boot", "booted"]))
)

// ── POSITIVE: a device-classed lifecycle/interaction handler MAY pair with a
//    device-requiring handler (exactly what `lifecycleCommand`/`tapCommand` do). ──
const lifecycleLikeOk = command(descriptor("launch-app", "device"), deviceEffect)
void lifecycleLikeOk

// POSITIVE: the wait.fn handler is runtime-eval-classed, so it MAY name eval.
const waitFnLikeOk = command(descriptor("wait.fn", "runtime-eval"), evalEffect)
void waitFnLikeOk

// ── NEGATIVE: a device-classed handler CANNOT smuggle the runtime-eval
//    capability — the AC-004 structural fix (no device verb can inject JS). ──
const deviceCannotEval = command(
  descriptor("launch-app", "device"),
  // @ts-expect-error device-classed handler cannot require RuntimeEvalCapability
  evalEffect
)
void deviceCannotEval

// ── NEGATIVE: a read-classed handler's R is `never` — it cannot name the eval
//    capability (AC-004: a non-fn wait stays a pure read). ──
const readCannotEval = command(
  descriptor("wait", "read"),
  // @ts-expect-error read-classed handler cannot require RuntimeEvalCapability
  evalEffect
)
void readCannotEval

// ── NEGATIVE: a read-classed handler likewise cannot reach the device. ──
const readCannotDevice = command(
  descriptor("wait", "read"),
  // @ts-expect-error read-classed handler cannot require DeviceCapability
  deviceEffect
)
void readCannotDevice
