import type {
  RefRecord,
  SemanticBridgeSnapshot,
  SessionRecord,
  SnapshotFilters,
  SnapshotPersistenceDependencies,
  SnapshotResult,
} from "./domain.js";
import { flattenAccessibilityNodes, refRecordFromNode, snapshotNodeFromAccessibility } from "./accessibility.js";
import { createSnapshotId } from "./ids.js";

const NATIVE_LIMITATIONS = [
  "Native accessibility snapshots expose semantic UI where available; React component props and private fiber details are not included.",
];

export async function persistNativeSnapshot(input: {
  stateRoot: string;
  session: SessionRecord;
  filters: SnapshotFilters;
  semanticBridge: unknown;
  accessibilityTree: unknown;
}, deps: SnapshotPersistenceDependencies): Promise<SnapshotResult> {
  const snapshotId = createSnapshotId(deps.now(), deps.randomSuffix());
  const targetId = input.session.activeTargetId ?? "";
  const nodes = flattenAccessibilityNodes(input.accessibilityTree, input.filters);
  const refs = nodes.map((node, index) => refRecordFromNode(node, index + 1, snapshotId, targetId, input.filters));
  const snapshotPath = snapshotJsonPath(input.stateRoot, input.session.sessionId, snapshotId);
  const generatedAt = deps.now().toISOString();
  const snapshot: SnapshotResult = {
    snapshotId,
    targetId,
    routeHint: null,
    source: ["native-accessibility"],
    semanticBridge: input.semanticBridge,
    generatedAt,
    filters: input.filters,
    refs,
    tree: nodes.map((node, index) => snapshotNodeFromAccessibility(node, `@e${index + 1}`, input.filters)),
    artifacts: {
      json: snapshotPath,
      screenshot: null,
      annotatedScreenshot: null,
    },
    limitations: NATIVE_LIMITATIONS,
  };

  await persistSnapshotArtifacts(input.stateRoot, input.session, snapshot, input.semanticBridge, deps);
  return snapshot;
}

export async function persistSemanticSnapshot(input: {
  stateRoot: string;
  session: SessionRecord;
  filters: SnapshotFilters;
  semanticBridge: SemanticBridgeSnapshot;
}, deps: SnapshotPersistenceDependencies): Promise<SnapshotResult> {
  const snapshotId = createSnapshotId(deps.now(), deps.randomSuffix());
  const targetId = input.session.activeTargetId ?? "";
  const refs: RefRecord[] = input.semanticBridge.refs.map((record, index) => ({
    ...record,
    ref: `@e${index + 1}`,
    snapshotId,
    targetId,
    stale: false,
    role: record.role ?? null,
    label: record.label ?? null,
    text: record.text ?? null,
    placeholder: record.placeholder ?? null,
    testID: record.testID ?? null,
    nativeID: record.nativeID ?? null,
    component: record.component ?? null,
    source: record.source ?? null,
    box: record.box ?? null,
    actions: record.actions ?? [],
  }));
  const snapshotPath = snapshotJsonPath(input.stateRoot, input.session.sessionId, snapshotId);
  const generatedAt = deps.now().toISOString();
  const snapshot: SnapshotResult = {
    snapshotId,
    targetId,
    routeHint: input.semanticBridge.routeHint,
    source: [input.semanticBridge.source],
    semanticBridge: input.semanticBridge,
    generatedAt,
    filters: input.filters,
    refs,
    tree: refs.map((record) => ({
      ref: record.ref,
      role: record.role,
      label: record.label,
      text: record.text,
      testID: record.testID,
      source: input.filters.includeSource ? record.source : null,
      box: input.filters.includeBounds ? record.box : null,
      actions: record.actions,
    })),
    artifacts: {
      json: snapshotPath,
      screenshot: null,
      annotatedScreenshot: null,
    },
    limitations: input.semanticBridge.limitations,
  };

  await persistSnapshotArtifacts(input.stateRoot, input.session, snapshot, input.semanticBridge, deps);
  return snapshot;
}

function snapshotDirectory(stateRoot: string, sessionId: string): string {
  return `${stateRoot}/sessions/${sessionId}/snapshots`;
}

function snapshotJsonPath(stateRoot: string, sessionId: string, snapshotId: string): string {
  return `${snapshotDirectory(stateRoot, sessionId)}/${snapshotId}.json`;
}

async function persistSnapshotArtifacts(
  stateRoot: string,
  session: SessionRecord,
  snapshot: SnapshotResult,
  semanticBridge: unknown,
  deps: SnapshotPersistenceDependencies,
): Promise<void> {
  await deps.ensureDirectory(snapshotDirectory(stateRoot, session.sessionId));
  await deps.writeJsonFile(snapshot.artifacts.json, snapshot);
  await deps.writeJsonFile(`${stateRoot}/sessions/${session.sessionId}/refs.json`, {
    snapshotId: snapshot.snapshotId,
    targetId: snapshot.targetId,
    source: snapshot.source,
    semanticBridge,
    refs: snapshot.refs,
  });
  await deps.updateSessionRecord(stateRoot, {
    ...session,
    lastSnapshotId: snapshot.snapshotId,
    updatedAt: snapshot.generatedAt,
  });
}
