import type {
  NormalizedAccessibilityNode,
  RefRecord,
  ScreenBox,
  SnapshotFilters,
  SnapshotNode,
  SourceLocation,
} from "./domain.js";
import { redactValue } from "./redaction.js";

type AnyRecord = Record<string, unknown>;

export function flattenAccessibilityNodes(
  tree: unknown,
  filters: SnapshotFilters,
): NormalizedAccessibilityNode[] {
  const roots = Array.isArray(tree) ? tree : [tree];
  const nodes: NormalizedAccessibilityNode[] = [];

  const visit = (node: unknown, depth: number): void => {
    if (!isRecord(node)) {
      return;
    }
    if (filters.depth !== null && depth > filters.depth) {
      return;
    }

    const normalized = normalizeAccessibilityNode(node);
    if (
      (!filters.interactiveOnly || normalized.actions.length > 0) &&
      (!filters.compact || normalized.label || normalized.text || normalized.actions.length > 0)
    ) {
      nodes.push(normalized);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      visit(child, depth + 1);
    }
  };

  for (const root of roots) {
    visit(root, 0);
  }
  return nodes;
}

export function normalizeAccessibilityRole(role: unknown): string | null {
  const text = String(role ?? "")
    .replace(/^AX/, "")
    .toLowerCase();
  if (text === "statictext") return "text";
  if (text === "button") return "button";
  if (text === "textfield" || text === "textbox") return "textbox";
  if (text === "switch") return "switch";
  if (text === "link") return "link";
  return text || null;
}

export function normalizeFrame(frame: unknown): ScreenBox | null {
  if (!isRecord(frame)) {
    return null;
  }
  const x = Number(frame.x ?? frame.left);
  const y = Number(frame.y ?? frame.top);
  const width = Number(frame.width);
  const height = Number(frame.height);
  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }
  return { x, y, width, height };
}

export function actionsForAccessibilityRole(role: string | null): string[] {
  if (role === "button" || role === "link") return ["tap", "inspect"];
  if (role === "textbox") return ["tap", "fill", "focus", "inspect"];
  if (role === "switch") return ["tap", "inspect"];
  return [];
}

export function normalizeSource(source: unknown): SourceLocation | null {
  if (!isRecord(source)) {
    return null;
  }
  const line = Number(source.line ?? source.lineNumber);
  const column = Number(source.column ?? source.columnNumber);
  return {
    file: stringOrNull(source.file ?? source.fileName),
    line: Number.isFinite(line) ? line : null,
    column: Number.isFinite(column) ? column : null,
  };
}

export function refRecordFromNode(
  node: NormalizedAccessibilityNode,
  index: number,
  snapshotId: string,
  targetId: string,
  filters: SnapshotFilters,
): RefRecord {
  return {
    ref: `@e${index}`,
    snapshotId,
    targetId,
    stale: false,
    role: node.role,
    label: node.label,
    text: node.text,
    placeholder: node.placeholder,
    testID: node.testID,
    nativeID: node.nativeID,
    component: node.component,
    source: filters.includeSource ? normalizeSource(node.source) : null,
    box: filters.includeBounds ? node.box : null,
    actions: node.actions,
  };
}

export function snapshotNodeFromAccessibility(
  node: NormalizedAccessibilityNode,
  ref: string,
  filters: SnapshotFilters,
): SnapshotNode {
  return {
    ref,
    role: node.role,
    label: node.label,
    text: node.text,
    testID: node.testID,
    source: filters.includeSource ? normalizeSource(node.source) : null,
    box: filters.includeBounds ? node.box : null,
    actions: node.actions,
  };
}

export function normalizeSemanticBridgeRefs(
  refs: unknown,
  filters: SnapshotFilters,
): Array<Omit<RefRecord, "ref" | "snapshotId" | "targetId" | "stale">> {
  if (!Array.isArray(refs)) {
    return [];
  }

  return refs
    .filter(isRecord)
    .map((item) => {
      const role = normalizeAccessibilityRole(item.role ?? item.type ?? null);
      const actions = Array.isArray(item.actions)
        ? item.actions.map(String)
        : actionsForAccessibilityRole(role);
      return {
        role,
        label: nullableField(item.label ?? item.name),
        text: nullableField(item.text ?? item.value),
        placeholder: nullableField(item.placeholder),
        testID: nullableField(item.testID ?? item.testId ?? item.nativeID),
        nativeID: nullableField(item.nativeID),
        component: nullableField(item.component),
        source: filters.includeSource ? (item.source ?? null) : null,
        box: filters.includeBounds ? normalizeFrame(item.box ?? item.frame) : null,
        actions,
        disabled: item.disabled === true,
        raw: redactValue(item.raw ?? item),
      } satisfies Omit<RefRecord, "ref" | "snapshotId" | "targetId" | "stale">;
    })
    .filter((record) => {
      if (filters.interactiveOnly && record.actions.length === 0) return false;
      if (filters.compact && !record.label && !record.text && record.actions.length === 0)
        return false;
      return true;
    });
}

function normalizeAccessibilityNode(node: AnyRecord): NormalizedAccessibilityNode {
  const role = normalizeAccessibilityRole(node.role_description ?? node.role ?? node.type ?? null);
  const label = nullableField(node.AXLabel ?? node.label ?? node.title);
  return {
    role,
    label,
    text: nullableField(node.AXValue ?? node.value ?? (role === "text" ? label : null)),
    placeholder: nullableField(node.placeholder),
    testID: nullableField(node.testID ?? node.testId ?? node.nativeID),
    nativeID: nullableField(node.nativeID),
    component: nullableField(node.component ?? node.name),
    source: node.source ?? null,
    box: normalizeFrame(node.frame),
    actions: actionsForAccessibilityRole(role),
    raw: node,
  };
}

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object";
}

function nullableField(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function stringOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}
