export function createSnapshotId(now: Date, randomSuffix: string): string {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
    .replace("T", "-")
    .toLowerCase();
  return `snapshot-${timestamp}-${randomSuffix}`;
}
