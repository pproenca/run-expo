/**
 * AC-020 — Expo ↔ React Native compatibility classification from the DATA FILE.
 *
 * Proves every class (missing / declared-unresolved / unknown / compatible /
 * mismatched), the first-`\d+\.\d+(\.\d+)?` version parse, AND data-file
 * extensibility: adding an Expo 55 row to a manifest object re-classifies a
 * formerly-`unknown` pair as `compatible` with NO code change.
 */
import { describe, expect, it } from "@effect/vitest"
import {
  classifyCompat,
  type CompatMap,
  DEFAULT_COMPAT_MAP,
  parseVersion
} from "@expo98/expo-integration"

describe("AC-020 Expo↔RN compat classification (data-file map)", () => {
  it("AC-020 missing — either side absent or blank", () => {
    expect(classifyCompat({ expo: undefined, reactNative: "0.81.0" }).classification).toBe(
      "missing"
    )
    expect(classifyCompat({ expo: "54.0.0", reactNative: null }).classification).toBe(
      "missing"
    )
    expect(classifyCompat({ expo: "   ", reactNative: "0.81" }).classification).toBe(
      "missing"
    )
  })

  it("AC-020 declared-unresolved — manifest pointer prefixes", () => {
    for (const prefix of ["catalog:", "workspace:", "file:", "link:", "portal:"]) {
      expect(
        classifyCompat({ expo: `${prefix}expo`, reactNative: "0.81.0" }).classification
      ).toBe("declared-unresolved")
      expect(
        classifyCompat({ expo: "54.0.0", reactNative: `${prefix}rn` }).classification
      ).toBe("declared-unresolved")
    }
  })

  it("AC-020 unknown — Expo major not in the table", () => {
    // 99 is not a key in the bundled data file.
    expect(classifyCompat({ expo: "99.0.0", reactNative: "0.99" }).classification).toBe(
      "unknown"
    )
  })

  it("AC-020 compatible — RN major.minor matches the expected for the Expo major", () => {
    const r = classifyCompat({ expo: "54.0.0", reactNative: "0.81.5" })
    expect(r.classification).toBe("compatible")
    expect(r.expoMajor).toBe(54)
    expect(r.reactNativeMinor).toBe("0.81")
    expect(r.expectedReactNativeMinor).toBe("0.81")
  })

  it("AC-020 mismatched — RN major.minor differs from the expected", () => {
    const r = classifyCompat({ expo: "54.0.0", reactNative: "0.79.0" })
    expect(r.classification).toBe("mismatched")
    expect(r.expectedReactNativeMinor).toBe("0.81")
    expect(r.reactNativeMinor).toBe("0.79")
  })

  it("AC-020 covers every bundled row", () => {
    const expected: Record<string, string> = {
      "54": "0.81",
      "53": "0.79",
      "52": "0.76",
      "51": "0.74",
      "50": "0.73"
    }
    for (const [expo, rn] of Object.entries(expected)) {
      expect(
        classifyCompat({ expo: `${expo}.0.0`, reactNative: `${rn}.3` }).classification
      ).toBe("compatible")
    }
  })

  it("AC-020 version parse takes the FIRST \\d+.\\d+(.\\d+)? run", () => {
    expect(parseVersion("^54.0.0")?.minorString).toBe("54.0")
    expect(parseVersion("~0.81.5-rc.1")?.minorString).toBe("0.81")
    expect(parseVersion(">=52.1 <53")?.minorString).toBe("52.1")
    expect(parseVersion("no-version-here")).toBeNull()
    // A leading caret/tilde is skipped to the first numeric run.
    const r = classifyCompat({ expo: "^54.0.0", reactNative: "~0.81.5" })
    expect(r.classification).toBe("compatible")
  })

  it("AC-020 data-file extensibility — an Expo 55 manifest row classifies WITHOUT a code change", () => {
    // Before: Expo 55 is unknown against the bundled data file.
    expect(
      classifyCompat({ expo: "55.0.0", reactNative: "0.82.0" }).classification
    ).toBe("unknown")

    // Add an Expo 55 row to a manifest object (simulating the fetched/updated
    // data file) and re-classify — now `compatible`, no code edit required.
    const updatedMap: CompatMap = {
      version: DEFAULT_COMPAT_MAP.version + 1,
      expoToReactNative: { ...DEFAULT_COMPAT_MAP.expoToReactNative, "55": "0.82" }
    }
    const after = classifyCompat({ expo: "55.0.0", reactNative: "0.82.0" }, updatedMap)
    expect(after.classification).toBe("compatible")
    expect(after.expectedReactNativeMinor).toBe("0.82")
    expect(after.mapVersion).toBe(DEFAULT_COMPAT_MAP.version + 1)
  })
})
