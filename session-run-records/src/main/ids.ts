import type { Clock, RandomSuffix } from "./domain.js";

export const systemClock: Clock = () => new Date();

export const randomBase36Suffix: RandomSuffix = () => Math.random().toString(36).slice(2, 8);

/**
 * RULE-018: session IDs use a normalized name, a lower-cased timestamp without
 * milliseconds or trailing Z, and a six-character random base36 suffix.
 */
export function createSessionId(name: string, at: Date, randomSuffix: RandomSuffix = randomBase36Suffix): string {
  const timestamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-").toLowerCase();
  return `${name}-${timestamp}-${randomSuffix()}`;
}

/**
 * RULE-018: run IDs preserve the trailing Z after removing milliseconds.
 */
export function createRunId(at: Date, randomSuffix: RandomSuffix = randomBase36Suffix): string {
  const timestamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");
  return `${timestamp}-${randomSuffix()}`;
}
