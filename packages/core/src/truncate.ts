/**
 * AC-041 — Output truncation. ONE canonical budget + ONE overflow marker.
 *
 * Resolves the legacy's ≥4 competing limits / 2 markers into a single budget.
 * The subprocess `maxBuffer` (S1) is set WELL ABOVE this so capture never clips
 * legitimate tool output before redaction/truncation can run.
 */

/** The one canonical payload budget (chars). */
export const OUTPUT_BUDGET = 40_000

/** The one canonical overflow marker; `N` = number of chars dropped. */
export const overflowMarker = (dropped: number): string => `[truncated ${dropped} characters]`

/**
 * Truncate a single string to `budget` chars, appending the marker when it
 * overflows. The marker is appended AFTER the leading content (so the returned
 * string may exceed `budget` by the marker length — the budget governs payload
 * content, not the annotation).
 */
export const truncate = (input: string, budget: number = OUTPUT_BUDGET): string => {
  if (input.length <= budget) {
    return input
  }
  const dropped = input.length - budget
  return input.slice(0, budget) + overflowMarker(dropped)
}

/**
 * Running-total truncation for streams (AC-041, finding M2).
 *
 * The 40,000-char budget is a SINGLE running total ACROSS the whole stream, not
 * a per-event cap. Each event is admitted whole while budget remains; once the
 * budget is crossed, exactly ONE terminal overflow marker is emitted and all
 * subsequent content is dropped. This keeps the single-redactor/single-budget
 * invariant intact under streaming.
 */
export class RunningTruncator {
  private used = 0
  private overflowed = false

  constructor(private readonly budget: number = OUTPUT_BUDGET) {}

  /**
   * Offer the next chunk. Returns the admitted text (possibly empty) followed,
   * exactly once, by the terminal overflow marker at the moment the budget is
   * first exceeded. After overflow, always returns `""`.
   */
  push(chunk: string): string {
    if (this.overflowed) {
      return ""
    }
    const remaining = this.budget - this.used
    if (chunk.length <= remaining) {
      this.used += chunk.length
      return chunk
    }
    // Crossing the budget on this chunk: admit what fits, then mark + seal.
    this.overflowed = true
    const admitted = chunk.slice(0, remaining)
    const dropped = chunk.length - remaining
    this.used = this.budget
    return admitted + overflowMarker(dropped)
  }

  get isOverflowed(): boolean {
    return this.overflowed
  }

  get usedChars(): number {
    return this.used
  }
}
