import { describe, expect, it } from "@effect/vitest"
import { redact, redactSecretsInString, REDACTED } from "@expo98/core"

describe("S5 Redaction — strongest superset (AC-003, AC-012)", () => {
  it("AC-003 redacts the full strongest-superset key set", () => {
    // Every key the legacy generic redactor MISSED must be covered here.
    const input = {
      authorization: "Bearer abc",
      bearer: "xyz",
      cookie: "sid=1",
      "set-cookie": "sid=1; HttpOnly",
      token: "t",
      secret: "s",
      password: "p",
      pwd: "p2",
      "api-key": "k",
      api_key: "k2",
      apiKey: "k3",
      "x-api-key": "k4",
      client_secret: "cs",
      refresh: "r",
      credential: "c",
      session: "se",
      auth: "a",
      // a non-secret key passes through untouched
      keepMe: "visible"
    }
    const out = redact(input) as Record<string, unknown>
    for (const key of Object.keys(input)) {
      if (key === "keepMe") {
        expect(out[key]).toBe("visible")
      } else {
        expect(out[key]).toBe(REDACTED)
      }
    }
  })

  it("AC-003 redacts the WHOLE value, never wire-chunks (finding M2)", () => {
    // Even a deeply-structured value under a secret key is replaced wholesale.
    const out = redact({
      token: { nested: { reallyDeep: "leak", arr: [1, 2, 3] } }
    }) as Record<string, unknown>
    expect(out.token).toBe(REDACTED)
  })

  it("AC-003 recurses through objects and arrays", () => {
    const out = redact({
      list: [{ password: "x" }, { ok: "shown" }],
      nested: { deep: { secret: "y", fine: "z" } }
    }) as {
      list: Array<Record<string, unknown>>
      nested: { deep: Record<string, unknown> }
    }
    expect(out.list[0]?.password).toBe(REDACTED)
    expect(out.list[1]?.ok).toBe("shown")
    expect(out.nested.deep.secret).toBe(REDACTED)
    expect(out.nested.deep.fine).toBe("z")
  })

  it("AC-012 redacts secret-shaped URL query substrings", () => {
    const url = "https://api.example.com/v1?token=abc123&page=2&api_key=zzz"
    const out = redactSecretsInString(url)
    expect(out).toContain("token=[redacted]")
    expect(out).toContain("api_key=[redacted]")
    expect(out).toContain("page=2")
    expect(out).not.toContain("abc123")
    expect(out).not.toContain("zzz")
  })

  it("AC-012 redacts secret-shaped key=value and header substrings in free strings", () => {
    const blob = "authorization: Bearer SEKRET\npage_size=10\nsecret=top"
    const out = redactSecretsInString(blob)
    expect(out).toContain("authorization: [redacted]")
    expect(out).toContain("secret=[redacted]")
    expect(out).toContain("page_size=10")
    expect(out).not.toContain("SEKRET")
    expect(out).not.toContain("top")
  })

  it("AC-003 case-insensitive key matching", () => {
    const out = redact({ AUTHORIZATION: "a", ApiKey: "b" }) as Record<string, unknown>
    expect(out.AUTHORIZATION).toBe(REDACTED)
    expect(out.ApiKey).toBe(REDACTED)
  })
})
