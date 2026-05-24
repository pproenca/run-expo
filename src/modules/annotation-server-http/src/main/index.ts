export interface AnnotationServerArgs {
  dir?: unknown;
  port?: unknown;
}

export interface HttpPayload {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function annotationServer(args: AnnotationServerArgs = {}): Promise<Record<string, unknown>> {
  return annotationServerDeprecationPayload(args);
}

export function annotationServerDeprecationPayload(args: AnnotationServerArgs = {}): Record<string, unknown> {
  return {
    available: false,
    action: "annotation-server",
    code: "external-annotation-server-removed",
    reason: "The external annotation server has been removed. Use the in-app annotation overlay instead.",
    requested: {
      dir: typeof args.dir === "string" ? args.dir : null,
      port: args.port ?? null,
    },
    replacement: {
      prepare: "annotate-screen prepare --serve true",
      server: "annotate-screen server",
      read: "annotate-screen read",
      scaffold: "annotate-screen scaffold --confirm-actions annotate-overlay-scaffold",
    },
    limitations: [
      "Annotation UI must be mounted inside the Expo/React Native app.",
      "This compatibility command does not serve external annotation boards.",
    ],
  };
}

export async function handleAnnotationRequest(): Promise<HttpPayload> {
  return sendJsonPayload(annotationServerDeprecationPayload(), 410);
}

export function sendJsonPayload(payload: unknown, status = 200): HttpPayload {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: `${JSON.stringify(payload, null, 2)}\n`,
  };
}
