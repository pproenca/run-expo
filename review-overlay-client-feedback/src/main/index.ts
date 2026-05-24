export interface ReviewPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface SourceLocation {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

export interface InspectedElement {
  frame: unknown;
  name: string | null;
  label: string | null;
  testID: string | null;
  role: string | null;
  source: SourceLocation | null;
  componentStack: string | null;
  hierarchy: Array<{ name: string | null; selected: boolean }>;
}

export interface ReviewEvent {
  screenName: string;
  viewport: Viewport;
  point: { x: number; y: number };
  element?: InspectedElement | null;
  text: string;
}

export interface InspectorHierarchyItem {
  name?: string | null;
  getInspectorData?: (findNodeHandle: unknown) => { props?: Record<string, unknown> } | null | undefined;
}

export interface InspectorViewData {
  frame?: unknown;
  hierarchy?: InspectorHierarchyItem[];
  selectedIndex?: number;
  props?: Record<string, unknown>;
  componentStack?: string | null;
}

export interface FetchLikeResponse {
  ok: boolean;
}

export type FetchLike = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<FetchLikeResponse> | FetchLikeResponse;

export function pointFromNativeEvent(event: { pageX: number; pageY: number }, viewport: Viewport): ReviewPoint {
  return pointFromCoordinates(event.pageX, event.pageY, viewport);
}

export function pointFromPointerEvent(event: unknown, viewport: Viewport): ReviewPoint {
  const nativeEvent = (event as { nativeEvent?: { pageX?: number; pageY?: number; x?: number; y?: number; locationX?: number; locationY?: number } })?.nativeEvent || {};
  return pointFromCoordinates(
    nativeEvent.pageX ?? nativeEvent.x ?? nativeEvent.locationX ?? 0,
    nativeEvent.pageY ?? nativeEvent.y ?? nativeEvent.locationY ?? 0,
    viewport,
  );
}

export function pointFromCoordinates(pageX: number, pageY: number, viewport: Viewport): ReviewPoint {
  const x = Math.max(0, Math.min(viewport.width, pageX));
  const y = Math.max(0, Math.min(viewport.height, pageY));
  return { x, y, nx: x / viewport.width, ny: y / viewport.height };
}

export function pointerEndpointFrom(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    url.pathname = "/pointer";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "http://127.0.0.1:17655/pointer";
  }
}

export function copyEndpointFrom(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    url.pathname = "/copy";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "http://127.0.0.1:17655/copy";
  }
}

export async function copyFeedbackToClipboard(endpoint: string, text: string, fetcher: FetchLike): Promise<boolean> {
  try {
    const response = await fetcher(copyEndpointFrom(endpoint), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function inspectElementAtPoint(
  inspectedView: unknown,
  point: ReviewPoint,
  callback: (element: InspectedElement | undefined) => void,
  getInspectorDataForViewAtPoint?: (
    inspectedView: unknown,
    x: number,
    y: number,
    callback: (viewData: InspectorViewData | null | undefined) => boolean,
  ) => void,
): void {
  if (!getInspectorDataForViewAtPoint || !inspectedView) {
    callback(undefined);
    return;
  }
  try {
    getInspectorDataForViewAtPoint(inspectedView, point.x, point.y, (viewData) => {
      callback(normalizeInspectorData(viewData));
      return true;
    });
  } catch {
    callback(undefined);
  }
}

export function normalizeInspectorData(
  viewData: InspectorViewData | null | undefined,
  findNodeHandle: unknown = null,
): InspectedElement | undefined {
  if (!viewData?.frame) return undefined;
  const hierarchy = Array.isArray(viewData.hierarchy) ? viewData.hierarchy : [];
  const selectedIndex = typeof viewData.selectedIndex === "number" ? viewData.selectedIndex : hierarchy.length - 1;
  const selected = hierarchy[selectedIndex];
  const selectedData = selected?.getInspectorData ? selected.getInspectorData(findNodeHandle) : null;
  const props = selectedData?.props || viewData.props || {};
  const componentStack = viewData.componentStack || null;
  return {
    frame: viewData.frame,
    name: selected?.name || null,
    label: primitiveString(props.accessibilityLabel) || primitiveString(props.children),
    testID: primitiveString(props.testID),
    role: primitiveString(props.accessibilityRole),
    source: parseSourceFromComponentStack(componentStack),
    componentStack,
    hierarchy: hierarchy.map((item, index) => ({ name: item.name || null, selected: index === selectedIndex })),
  };
}

export function primitiveString(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

export function parseSourceFromComponentStack(stack: string | null): SourceLocation | null {
  if (!stack) return null;
  const lines = stack.split("\n");
  for (const line of lines) {
    const match = /\(([^()]+):(\d+):(\d+)\)/.exec(line) || /at\s+([^\s()]+):(\d+):(\d+)/.exec(line);
    if (!match) continue;
    const fileName = match[1] ?? "";
    if (/node_modules/.test(fileName)) continue;
    return {
      fileName,
      lineNumber: Number(match[2]),
      columnNumber: Number(match[3]),
    };
  }
  return null;
}

export function formatElementLink(element: InspectedElement): string {
  const source = element.source;
  const name = element.name || "Element";
  if (!source) return `${name} - source unavailable`;
  return `${name} - ${source.fileName}${source.lineNumber ? `:${source.lineNumber}` : ""}`;
}

export function formatFeedbackMarkdown(event: ReviewEvent): string {
  const viewport = `${Math.round(event.viewport.width)}x${Math.round(event.viewport.height)}`;
  const elementName = event.element?.label || event.element?.name || "Selected element";
  const location = event.element ? formatElementLocation(event.element) : `x ${Math.round(event.point.x)}, y ${Math.round(event.point.y)}`;
  const source = event.element ? formatElementSource(event.element) : "source unavailable";
  return [
    `## Page Feedback: ${event.screenName}`,
    `**Viewport:** ${viewport}`,
    "",
    `### 1. \\"${escapeMarkdown(elementName)}.\\"`,
    `**Location:** ${location}`,
    `**Source:** ${source}`,
    `**Feedback:** ${event.text}`,
    "",
  ].join("\n");
}

export function formatElementLocation(element: InspectedElement): string {
  const names = element.hierarchy
    .map((item) => item.name)
    .filter((name): name is string => typeof name === "string" && Boolean(name) && !isNoisyHierarchyName(name));
  if (names.length > 0) return names.join(" > ");
  return element.name || "Element";
}

export function formatElementSource(element: InspectedElement): string {
  if (element.source) return formatSource(element.source);
  const stackSource = firstComponentStackSource(element.componentStack);
  return stackSource || "source unavailable";
}

export function formatSource(source: SourceLocation): string {
  return `${source.fileName}${source.lineNumber ? `:${source.lineNumber}` : ""}${source.columnNumber ? `:${source.columnNumber}` : ""}`;
}

export function firstComponentStackSource(stack: string | null): string | null {
  if (!stack) return null;
  for (const line of stack.split("\n")) {
    const match = /^\s*at\s+(.*?)\s+\((https?:\/\/.*):(\d+):(\d+)\)$/.exec(line);
    if (!match) continue;
    const name = (match[1] ?? "").trim();
    if (!name || isNoisyHierarchyName(name)) continue;
    return `${name} @ ${match[2]}:${match[3]}:${match[4]}`;
  }
  return null;
}

export function isNoisyHierarchyName(name: string): boolean {
  return /^(withDevTools\(App\)|App|ExpoRoot|ContextNavigator|Content|SceneView|Route\(\)|WrappedScreenComponent|RootLayout|ForwardRef|NativeStackNavigator|StaticContainer|EnsureSingleNavigator|NavigationProvider|NavigationContent|NavigationContainerInner|PreventRemoveProvider|NavigationStateListenerProvider|SafeAreaProvider|SafeAreaProviderCompat|FrameSizeProvider|ThemeProvider|RCTView|RCTScrollView|RCTScrollContentView|ScrollView|RNSScreen|Screen|ScreenStack|ScreenStackItem|DebugContainer|Suspender|Suspense|Freeze|DelayedFreeze|InnerScreen|Animated\(Anonymous\)|anonymous)$/.test(name);
}

export function escapeMarkdown(value: string): string {
  return value.replace(/"/g, '\\"').trim();
}
