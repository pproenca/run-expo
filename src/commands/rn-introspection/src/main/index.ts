import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { bridgeDomainCommand } from "../../../bridge-domain-actions/src/main/index.ts";
import { realValidation } from "../../../../core/real-validation/src/main/index.ts";

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface RefCache {
  snapshotId?: string | null;
  targetId?: string | null;
  refs?: Array<Record<string, any>>;
}

export interface StateRootArgs extends Record<string, unknown> {
  stateDir?: string | null;
  root?: string | null;
  cwd?: string | null;
}

export interface RnBridgeRequest {
  args: Record<string, unknown>;
  domain: "rn";
  action: string;
  expression: string;
  policy: {
    checked: true;
    action: string;
    sideEffect: "read";
    allowed: true;
    reason: string;
  };
}

export interface RnIntrospectionDependencies {
  readLatestRefCache?: (args: Record<string, unknown>) => Promise<RefCache | null> | RefCache | null;
  bridgeDomainCommand?: (request: RnBridgeRequest) => Promise<Record<string, any>> | Record<string, any>;
}

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

export async function rnCommand(
  args: Record<string, unknown> = {},
  deps: RnIntrospectionDependencies = defaultRnDependencies,
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "tree", "action");
  if (!["tree", "inspect", "renders", "fiber"].includes(action)) throw new Error(`Unknown React Native action: ${action}`);
  if (action === "inspect") return toolJson(await rnInspectPayload(args, deps));

  const subaction = action === "renders" ? requireString(args.subaction ?? positionals[1] ?? "read", "subaction") : null;
  if (subaction && !["start", "stop", "read"].includes(subaction)) throw new Error(`Unknown React Native renders action: ${subaction}`);
  const bridgeAction = action === "renders" ? `renders-${subaction}` : action;
  const bridgePayload = await deps.bridgeDomainCommand({
    args,
    domain: "rn",
    action: bridgeAction,
    expression: rnExpression({ action: bridgeAction, ref: args.ref, depth: args.depth, limit: args.limit }),
    policy: {
      checked: true,
      action: `rn.${bridgeAction}`,
      sideEffect: "read",
      allowed: true,
      reason: "React Native introspection is read-only.",
    },
  });
  const outputPayload = action === "tree" && !wantsRawOutput(args)
    ? summarizeRnTreePayload(bridgePayload)
    : bridgePayload;
  return toolJson({
    ...outputPayload,
    action,
    ...(subaction ? { subaction, bridgeAction } : {}),
    realValidation: rnRealValidation(outputPayload, action, subaction),
    limitations: rnLimitations(outputPayload.limitations),
  });
}

const defaultRnDependencies: RnIntrospectionDependencies = {
  bridgeDomainCommand: defaultBridgeDomainCommand,
};

async function defaultBridgeDomainCommand(request: RnBridgeRequest): Promise<Record<string, any>> {
  return bridgeDomainCommand(request);
}

export async function rnInspectPayload(
  args: Record<string, unknown> = {},
  deps: Pick<RnIntrospectionDependencies, "readLatestRefCache"> = {},
): Promise<Record<string, any>> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const ref = requireString(args.ref ?? positionals[1] ?? positionals[0], "ref");
  const cache = await readLatestRefCache(args, deps);
  if (!cache) {
    return {
      available: false,
      action: "inspect",
      ref,
      sources: ["snapshot-cache"],
      reason: "No snapshot exists for the current session.",
      limitations: rnLimitations(),
    };
  }
  const record = (cache.refs ?? []).find((item) => item.ref === ref);
  if (!record) {
    return {
      available: false,
      action: "inspect",
      ref,
      sources: ["native-accessibility", "snapshot-cache"],
      reason: "Ref not found in the latest snapshot.",
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      limitations: rnLimitations(),
    };
  }
  return {
    available: true,
    action: "inspect",
    ref,
    sources: ["native-accessibility", "snapshot-cache"],
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    record,
    limitations: rnLimitations([
      "Inspect uses cached semantic/native accessibility evidence and does not expose private fiber internals.",
    ]),
  };
}

export function rnExpression({ action, ref, depth, limit }: { action: string; ref?: unknown; depth?: unknown; limit?: unknown }): string {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const ref = ${JSON.stringify(ref ?? null)};
    const maxDepth = Math.max(1, Math.min(Number(${JSON.stringify(depth ?? 30)}) || 30, 80));
    const maxNodes = Math.max(1, Math.min(Number(${JSON.stringify(limit ?? 500)}) || 500, 2000));
    const bridge = globalThis.__EXPO_IOS_RN_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.rn);
    const bridgeTree = () => bridge && bridge.tree ? bridge.tree() : bridge ? { available: true, sources: ['runtime', 'app-instrumentation'], action, tree: bridge.tree || [] } : null;
    const isRouterShellOnly = (payload) => {
      const tree = payload && Array.isArray(payload.tree) ? payload.tree : [];
      if (tree.length !== 1) return false;
      const root = tree[0] || {};
      const children = Array.isArray(root.children) ? root.children : [];
      return String(root.name || '') === 'RootLayout' && children.length === 1 && String(children[0]?.name || '') === 'ExpoRouterStack';
    };
    const tagName = (tag) => ({
      0: 'FunctionComponent',
      1: 'ClassComponent',
      3: 'HostRoot',
      5: 'HostComponent',
      6: 'HostText',
      7: 'Fragment',
      9: 'ContextConsumer',
      10: 'ContextProvider',
      11: 'ForwardRef',
      13: 'Suspense',
      14: 'MemoComponent',
      15: 'SimpleMemoComponent',
      22: 'Offscreen',
    })[tag] || 'Fiber';
    const componentName = (fiber) => {
      const type = fiber && (fiber.elementType || fiber.type);
      if (typeof type === 'string') return type;
      if (typeof type === 'function') return type.displayName || type.name || tagName(fiber.tag);
      if (type && typeof type === 'object') {
        if (typeof type.displayName === 'string') return type.displayName;
        if (typeof type.name === 'string') return type.name;
        if (type.render) return type.render.displayName || type.render.name || 'ForwardRef';
        if (type.type) {
          const nested = type.type;
          if (typeof nested === 'function') return nested.displayName || nested.name || tagName(fiber.tag);
          if (typeof nested === 'string') return nested;
          if (nested && typeof nested.displayName === 'string') return nested.displayName;
        }
      }
      return tagName(fiber && fiber.tag);
    };
    const textFromProps = (props) => {
      if (typeof props === 'string' || typeof props === 'number') return String(props);
      if (!props || typeof props !== 'object') return null;
      const children = props.children;
      if (typeof children === 'string' || typeof children === 'number') return String(children);
      if (Array.isArray(children)) {
        const text = children.filter((item) => typeof item === 'string' || typeof item === 'number').join('');
        return text || null;
      }
      return null;
    };
    const compactProps = (fiber) => {
      const props = fiber && fiber.memoizedProps && typeof fiber.memoizedProps === 'object' ? fiber.memoizedProps : {};
      const out = {};
      for (const key of ['testID', 'testId', 'nativeID', 'accessibilityLabel', 'accessibilityRole', 'accessibilityHint', 'placeholder', 'placeholderText', 'href', 'disabled']) {
        const value = props[key];
        if (value == null) continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
      }
      const text = textFromProps(props);
      if (text) out.text = text;
      return out;
    };
    const sourceFromFiber = (fiber) => {
      const source = fiber && fiber._debugSource;
      if (!source || typeof source !== 'object') return null;
      return {
        fileName: source.fileName || null,
        lineNumber: source.lineNumber || null,
        columnNumber: source.columnNumber || null,
      };
    };
    const serializeFiberTree = () => {
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (!hook || typeof hook.getFiberRoots !== 'function' || !hook.renderers) {
        return { available: false, source: 'react-devtools-hook', reason: 'React DevTools fiber roots are not available.', action };
      }
      const roots = [];
      for (const rendererId of Array.from(hook.renderers.keys())) {
        for (const root of Array.from(hook.getFiberRoots(rendererId) || [])) roots.push({ rendererId, root });
      }
      let nodeCount = 0;
      const seen = new Set();
      const walk = (fiber, depth) => {
        if (!fiber || seen.has(fiber) || depth > maxDepth || nodeCount >= maxNodes) return null;
        seen.add(fiber);
        nodeCount += 1;
        const children = [];
        let child = fiber.child;
        while (child && nodeCount < maxNodes) {
          const serialized = walk(child, depth + 1);
          if (serialized) children.push(serialized);
          child = child.sibling;
        }
        const props = compactProps(fiber);
        const node = {
          name: componentName(fiber),
          tag: tagName(fiber.tag),
          key: fiber.key == null ? null : String(fiber.key),
          props: Object.keys(props).length ? props : undefined,
          source: sourceFromFiber(fiber),
          children,
        };
        if (!node.source) delete node.source;
        if (!node.children.length) delete node.children;
        return node;
      };
      const tree = roots.map(({ rendererId, root }) => {
        const current = root && root.current;
        const node = walk(current, 0);
        return node ? { rendererId, ...node } : null;
      }).filter(Boolean);
      return {
        available: tree.length > 0,
        action,
        source: 'react-devtools-hook',
        sources: ['runtime', 'react-devtools-hook'],
        tree,
        rootCount: roots.length,
        nodeCount,
        truncated: nodeCount >= maxNodes,
        limits: { maxDepth, maxNodes },
        bridgeTree: null,
      };
    };
    if (action === 'tree') {
      const payload = bridgeTree();
      const fiberPayload = serializeFiberTree();
      if (fiberPayload.available && (!payload || isRouterShellOnly(payload))) return { ...fiberPayload, bridgeTree: payload };
      if (payload) return payload;
      return fiberPayload;
    }
    if (!bridge) return { available: false, sources: ['runtime', 'app-instrumentation'], source: 'app-instrumentation', reason: 'React Native bridge is not installed.', action };
    if (action === 'fiber') return bridge.fiber ? bridge.fiber(ref) : { available: false, sources: ['runtime', 'app-instrumentation'], action, ref, reason: 'Fiber inspection is not exposed by the app bridge.' };
    const perfBridge = globalThis.__EXPO_IOS_PERF_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.performance);
    if (action === 'renders-start') {
      if (bridge.renders && bridge.renders.start) return bridge.renders.start();
      if (perfBridge?.renders?.start) return perfBridge.renders.start();
      return { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: true, commits: [] } };
    }
    if (action === 'renders-stop') {
      if (bridge.renders && bridge.renders.stop) return bridge.renders.stop();
      if (perfBridge?.renders?.stop) return perfBridge.renders.stop();
      return { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: false, commits: [] } };
    }
    if (action === 'renders-read') {
      if (bridge.renders && bridge.renders.read) return bridge.renders.read();
      if (perfBridge?.renders?.read) return perfBridge.renders.read();
      return { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: false, commits: [] } };
    }
    return { available: false, sources: ['runtime', 'app-instrumentation'], source: 'app-instrumentation', reason: 'Unsupported React Native bridge action.', action };
  })()`;
}

export function rnRealValidation(payload: Record<string, any>, action: string, subaction: string | null) {
  if (payload.available === false) {
    return realValidation({
      state: "unvalidated",
      evidence: [{ source: String(payload.source ?? "react-native"), command: `rn.${action}`, confidence: "low" }],
      missingEvidence: [{
        signal: "react-native-runtime-bridge",
        reason: String(payload.reason ?? "React Native runtime evidence was unavailable."),
        recommendedFix: "Launch a Hermes dev target and mount the dev-only RN bridge/profiler instrumentation.",
      }],
    });
  }
  const commits = Array.isArray(payload.renders?.commits) ? payload.renders.commits : [];
  const hasCommitDurations = commits.some((commit: any) => Number.isFinite(Number(commit.durationMs ?? commit.actualDuration)));
  if (action === "renders") {
    return realValidation({
      state: hasCommitDurations ? "validated" : "partial",
      claimsAllowed: { renderCost: hasCommitDurations },
      evidence: [{ source: String(payload.source ?? payload.sources?.[0] ?? "app-instrumentation"), command: `rn.renders.${subaction ?? "read"}`, confidence: hasCommitDurations ? "medium" : "low" }],
      missingEvidence: hasCommitDurations ? [] : [{
        signal: "react-profiler-commit-durations",
        reason: "Render bridge returned no commit duration records.",
        recommendedFix: "Mount a React Profiler wrapper in development and rerun rn renders start/read/stop.",
      }],
    });
  }
  return realValidation({
    state: "validated",
    evidence: [{ source: String(payload.source ?? payload.sources?.[0] ?? "react-native"), command: `rn.${action}`, confidence: "medium" }],
  });
}

export function rnLimitations(extra: unknown[] = []): string[] {
  return [
    ...extra.map(String),
    "private React Native hooks and fiber fields are version-dependent and may be incomplete or unavailable.",
  ];
}

export async function readLatestRefCache(
  args: Record<string, unknown> = {},
  deps: Pick<RnIntrospectionDependencies, "readLatestRefCache"> = {},
): Promise<RefCache | null> {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  if (!session?.lastSnapshotId) return null;
  return readJsonFile(join(sessionDirectory(stateRoot, String(session.sessionId)), "refs.json")).catch(() => null) as Promise<RefCache | null>;
}

export async function readLatestSession(stateRoot: string): Promise<Record<string, any> | null> {
  const sessionsRoot = join(stateRoot, "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile(join(sessionsRoot, entry.name, "session.json")).catch(() => null);
    if (record) sessions.push(record);
  }
  sessions.sort((a, b) => String(asRecord(b)?.updatedAt ?? asRecord(b)?.createdAt).localeCompare(String(asRecord(a)?.updatedAt ?? asRecord(a)?.createdAt)));
  return asRecord(sessions[0]);
}

export function resolveExpoStateRoot(args: StateRootArgs = {}): string {
  if (args.stateDir) {
    const resolved = resolve(args.stateDir);
    return basename(resolved) === "runs" ? resolve(join(resolved, "..")) : resolved;
  }
  const root = resolve(args.root ?? args.cwd ?? process.cwd());
  return join(root, ".scratch", "expo98");
}

export function sessionDirectory(stateRoot: string, sessionId: string): string {
  return join(stateRoot, "sessions", sessionId);
}

export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function wantsRawOutput(args: Record<string, unknown>): boolean {
  return args.raw === true || args.detail === "raw" || args.detail === "full";
}

export function summarizeRnTreePayload(payload: Record<string, any>): Record<string, any> {
  if (payload.available === false) return payload;
  const tree = Array.isArray(payload.tree) ? payload.tree : [];
  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const target = compactTarget(payload.target);
  const viewport = asRecord(payload.viewport);
  const structure = compactStructure(tree, elements);
  const visibleText = visibleTextRecords(elements);
  const controls = controlRecords(elements, visibleText);
  const componentPath = inferComponentPath(tree, elements);
  return {
    available: payload.available !== false,
    source: payload.source,
    sources: payload.sources,
    evidenceSource: payload.evidenceSource,
    domain: payload.domain,
    action: payload.action,
    route: payload.route ?? payload.routeHint ?? null,
    screen: {
      route: componentPath.find((name) => /^Route\(/.test(name)) ?? null,
      component: componentPath.find((name) => /Route\(|Layout|Screen|SignIn|Schedule|Console/.test(name)) ?? null,
      path: componentPath,
    },
    counts: {
      sampledElements: numberOrNull(payload.elementCount) ?? (elements.length || null),
      relevantNodes: countRelevantNodes(structure),
      visibleText: visibleText.length,
      controls: controls.length,
      rawTreeRoots: tree.length || null,
    },
    viewport: viewport ? pickDefined({
      width: viewport.width,
      height: viewport.height,
      scale: viewport.scale,
      fontScale: viewport.fontScale,
    }) : null,
    target,
    structure,
    visibleText,
    controls,
    rawAvailable: true,
    rawHint: "Rerun rn tree with --raw true for full component stacks, CDP transport, and unpruned trees.",
    limitations: [
      "Output is pruned for agent relevance; infrastructure wrappers, native host views, component stacks, and transport internals are omitted by default.",
      ...arrayOfStrings(payload.limitations),
    ],
  };
}

function compactTarget(value: unknown): Record<string, unknown> | null {
  const target = asRecord(value);
  if (!target) return null;
  return pickDefined({
    appId: target.appId,
    deviceName: target.deviceName,
    title: target.title,
  });
}

function compactStructure(tree: unknown[], elements: Record<string, any>[]): Array<Record<string, unknown>> {
  const fromTree = flattenTreeResults(tree.flatMap((node) => simplifyTreeNode(node, 0)));
  if (fromTree.length > 0) return fromTree.slice(0, 80);
  return pathTreeFromElements(elements);
}

function simplifyTreeNode(value: unknown, depth: number): Array<Record<string, unknown>> {
  if (depth > 60) return [];
  const node = asRecord(value);
  if (!node) return [];
  const name = nodeName(node);
  const element = asRecord(node.element);
  const children = Array.isArray(node.children) ? node.children.flatMap((child) => simplifyTreeNode(child, depth + 1)) : [];
  const details = elementDetails(element ?? node);
  const meaningful = isRelevantName(name) || Object.keys(details).length > 0;
  if (!meaningful) return children;
  return [pickDefined({
    component: name,
    ...details,
    children: children.length > 0 ? children : undefined,
  })];
}

function flattenTreeResults(nodes: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const compacted: Array<Record<string, unknown>> = [];
  for (const node of nodes) {
    const children = Array.isArray(node.children) ? flattenTreeResults(node.children as Array<Record<string, unknown>>) : [];
    compacted.push({ ...node, ...(children.length > 0 ? { children } : {}) });
  }
  return compacted;
}

function pathTreeFromElements(elements: Record<string, any>[]): Array<Record<string, unknown>> {
  const root: PathNode = { component: "root", children: new Map() };
  for (const element of elements) {
    const path = relevantPathFromElement(element);
    if (path.length === 0) continue;
    let cursor = root;
    for (const name of path) {
      let child = cursor.children.get(name);
      if (!child) {
        child = { component: name, children: new Map() };
        cursor.children.set(name, child);
      }
      cursor = child;
    }
    const details = elementDetails(element);
    Object.assign(cursor, details);
  }
  return [...root.children.values()].map(pathNodeToRecord);
}

interface PathNode {
  component: string;
  children: Map<string, PathNode>;
  label?: string;
  role?: string;
  testID?: string;
  box?: Record<string, number>;
}

function pathNodeToRecord(node: PathNode): Record<string, unknown> {
  const children = [...node.children.values()].map(pathNodeToRecord);
  return pickDefined({
    component: node.component,
    label: node.label,
    role: node.role,
    testID: node.testID,
    box: node.box,
    children: children.length > 0 ? children : undefined,
  });
}

function visibleTextRecords(elements: Record<string, any>[]): Array<Record<string, any>> {
  const records: Array<Record<string, any>> = [];
  const seen = new Set<string>();
  for (const element of elements) {
    const label = optionalNonemptyString(element.label ?? asRecord(element.element)?.label);
    if (!label || seen.has(label)) continue;
    const name = optionalNonemptyString(element.name ?? asRecord(element.element)?.name);
    const role = optionalNonemptyString(element.role ?? asRecord(element.element)?.role);
    const testID = optionalNonemptyString(element.testID ?? asRecord(element.element)?.testID);
    if (role || testID || name === "Text" || name === "RCTText" || label.length > 1) {
      seen.add(label);
      records.push(pickDefined({
        text: label,
        component: name,
        path: relevantPathFromElement(element),
        box: boxFromFrame(element.frame ?? asRecord(element.element)?.frame),
      }));
    }
  }
  return records.slice(0, 80);
}

function controlRecords(elements: Record<string, any>[], textRecords: Array<Record<string, any>>): Array<Record<string, any>> {
  const controls: Array<Record<string, any>> = [];
  for (const element of elements) {
    const elementRecord = asRecord(element.element) ?? element;
    const role = optionalNonemptyString(element.role ?? elementRecord.role);
    const testID = optionalNonemptyString(element.testID ?? elementRecord.testID);
    const name = optionalNonemptyString(element.name ?? elementRecord.name);
    const isInput = /TextInput|Input/i.test(String(name));
    if (!role && !testID && !isInput) continue;
    const box = boxFromFrame(element.frame ?? elementRecord.frame);
    const inferredLabel = optionalNonemptyString(element.label ?? elementRecord.label) ?? inferControlLabel(box, textRecords);
    controls.push(pickDefined({
      type: isInput ? "input" : role ?? "control",
      label: inferredLabel,
      testID,
      component: name,
      path: relevantPathFromElement(element),
      box,
    }));
  }
  return controls.slice(0, 60);
}

function inferControlLabel(box: Record<string, number> | undefined, textRecords: Array<Record<string, any>>): string | undefined {
  if (!box) return undefined;
  for (const record of textRecords) {
    const textBox = asRecord(record.box);
    if (!textBox) continue;
    const centerX = Number(textBox.x) + Number(textBox.width) / 2;
    const centerY = Number(textBox.y) + Number(textBox.height) / 2;
    if (
      centerX >= box.x &&
      centerX <= box.x + box.width &&
      centerY >= box.y &&
      centerY <= box.y + box.height
    ) {
      return String(record.text);
    }
  }
  return undefined;
}

function inferComponentPath(tree: unknown[], elements: Record<string, any>[]): string[] {
  for (const element of elements) {
    const path = relevantPathFromElement(element).filter((name) => !["Text", "View", "Pressable", "SymbolModule"].includes(name));
    if (path.length > 0) return path.slice(0, 16);
  }
  const path: string[] = [];
  let cursor = asRecord(tree[0]);
  let depth = 0;
  while (cursor && depth < 40) {
    const name = nodeName(cursor);
    if (isRelevantName(name)) path.push(name);
    const child = Array.isArray(cursor.children) ? asRecord(cursor.children[0]) : null;
    cursor = child;
    depth += 1;
  }
  return unique(path).slice(0, 16);
}

function relevantPathFromElement(element: Record<string, any>): string[] {
  const hierarchy = Array.isArray(element.hierarchy) ? element.hierarchy : [];
  const path = hierarchy
    .map((item) => nodeName(item))
    .filter((name): name is string => Boolean(name && isRelevantName(name)));
  const elementName = optionalNonemptyString(element.name);
  if (elementName && isRelevantName(elementName)) path.push(elementName);
  return unique(path).slice(0, 24);
}

function nodeName(value: unknown): string | null {
  const record = asRecord(value);
  return optionalNonemptyString(record?.name ?? record?.component);
}

function isRelevantName(name: string | null): name is string {
  if (!name) return false;
  if (/^RCT|^RNC|^RNS|ViewManagerAdapter|HostRoot|HostComponent|HostText/.test(name)) return false;
  if (WRAPPER_NAMES.has(name)) return false;
  if (/^(Screen|ScreenStack|ScreenStackItem|InnerScreen|Suspender|Freeze|DelayedFreeze)$/.test(name)) return false;
  if (/^(View|Animated\(View\)|ScrollView|Text)$/.test(name)) return false;
  return true;
}

const WRAPPER_NAMES = new Set([
  "withDevTools(App)",
  "App",
  "ExpoRoot",
  "ContextNavigator",
  "Content",
  "SceneView",
  "WrappedScreenComponent",
  "Anonymous",
  "anonymous",
  "ForwardRef",
  "StaticContainer",
  "EnsureSingleNavigator",
  "NavigationProvider",
  "PreventRemoveProvider",
  "NavigationStateListenerProvider",
  "NavigationContent",
  "BaseNavigationContainer",
  "NavigationContainerInner",
  "ThemeProvider",
  "SafeAreaProvider",
  "SafeAreaProviderCompat",
  "RNCSafeAreaProvider",
  "RNSSafeAreaView",
  "NativeStackNavigator",
  "Screen",
]);

function elementDetails(element: Record<string, any>): Record<string, unknown> {
  const label = optionalNonemptyString(element.label);
  const text = optionalNonemptyString(element.text);
  const role = optionalNonemptyString(element.role);
  const testID = optionalNonemptyString(element.testID);
  const box = boxFromFrame(element.frame ?? element.box);
  const actions = Array.isArray(element.actions) && element.actions.length > 0 ? element.actions.map(String).slice(0, 10) : undefined;
  return pickDefined({ label, text, role, testID, box, actions });
}

function boxFromFrame(value: unknown): Record<string, number> | undefined {
  const frame = asRecord(value);
  if (!frame) return undefined;
  const x = numberOrNull(frame.x ?? frame.left);
  const y = numberOrNull(frame.y ?? frame.top);
  const width = numberOrNull(frame.width);
  const height = numberOrNull(frame.height);
  if (x == null || y == null || width == null || height == null) return undefined;
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

function countRelevantNodes(nodes: Array<Record<string, unknown>>): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (Array.isArray(node.children)) count += countRelevantNodes(node.children as Array<Record<string, unknown>>);
  }
  return count;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function optionalNonemptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function pickDefined(record: Record<string, unknown>): Record<string, any> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
