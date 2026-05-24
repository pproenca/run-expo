import { mkdir as fsMkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { resolveExpoStateRoot } from "./common.js";
import { writeJsonFile } from "./dependencies.js";
import type { PerfDependencies } from "./types.js";

export async function writePerfArtifact(args: Record<string, any>, action: string, payload: Record<string, any>, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const timestamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const artifactPath = resolve(args.outputPath ?? join(resolveExpoStateRoot(args), "artifacts", "perf", `${action}-${timestamp}.json`));
  await (deps.mkdir ?? fsMkdir)(dirname(artifactPath), { recursive: true });
  const withArtifact = { ...payload, artifacts: [...(payload.artifacts ?? []), artifactPath] };
  await writeJsonFile(artifactPath, withArtifact, deps);
  return withArtifact;
}

export async function parseNativeSampleArtifact(file: string, deps: Pick<PerfDependencies, "readJsonFile"> = {}): Promise<Record<string, any>> {
  const text = await readFile(file, "utf8").catch(() => null);
  if (!text) return { available: false, artifact: file, reason: "Native sample artifact was not found or unreadable." };
  const physicalFootprintMb = numberFromMatch(text, /Physical footprint:\s+([0-9.]+)M/);
  const peakFootprintMb = numberFromMatch(text, /Physical footprint \(peak\):\s+([0-9.]+)M/);
  const mainThreadSamples = numberFromMatch(text, /Call graph:\s*\n\s+(\d+)\s+Thread_[^:\n]+:\s+Main Thread/s);
  const idleSamples = countSampleBucket(text, [/mach_msg/i, /CFRunLoopServiceMachPort/i]);
  const buckets = {
    hermes: countSampleBucket(text, [/hermes/i]),
    yoga: countSampleBucket(text, [/yoga/i]),
    mounting: countSampleBucket(text, [/RCTMountingManager/i, /RCTPerformMountInstructions/i]),
    coreAnimation: countSampleBucket(text, [/QuartzCore/i, /CA::Layer/i, /CoreAnimation/i]),
    uiKit: countSampleBucket(text, [/UIKitCore/i]),
  };
  const topSymbols = [...text.matchAll(/^\s*([0-9]+)\s+(.+?)\s+\(in\s+(.+?)\)/gm)]
    .slice(0, 30)
    .map((match) => ({ samples: Number(match[1]), symbol: match[2].trim(), library: match[3].trim() }));
  return {
    available: Boolean(physicalFootprintMb || peakFootprintMb || topSymbols.length),
    artifact: file,
    bytes: Buffer.byteLength(text),
    physicalFootprintMb,
    peakFootprintMb,
    mainThreadSamples,
    estimatedMainThreadIdleSamples: idleSamples,
    estimatedMainThreadBusySamples: mainThreadSamples == null ? null : Math.max(0, mainThreadSamples - idleSamples),
    buckets,
    topSymbols,
  };
}

function numberFromMatch(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : null;
}

function countSampleBucket(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!patterns.some((pattern) => pattern.test(line))) continue;
    const match = /^\s*[+!:| ]*\s*(\d+)\s+/.exec(line);
    count += match ? Number(match[1]) : 1;
  }
  return count;
}
