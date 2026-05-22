import type { ArtifactRef, Availability, JsonValue } from "../contracts/primitives.js";
import type { TargetRecord } from "../contracts/records.js";

export interface InspectorAdapter {
  probe(target: TargetRecord): Promise<InspectorProbeResult>;
  toggle(target: TargetRecord): Promise<Availability>;
  installCommentMenu(target: TargetRecord, options: CommentMenuOptions): Promise<Availability>;
  openDevMenu(target: TargetRecord): Promise<Availability>;
  readComments(target: TargetRecord, options: ReadCommentsOptions): Promise<ReviewComment[]>;
  clearComments(target: TargetRecord): Promise<Availability>;
}

export type InspectorProbeResult = {
  available: boolean;
  targetId: string | null;
  hooks: {
    nativeDevSettings: boolean;
    devSettingsMenu: boolean;
    alertPrompt: boolean;
    reactDevToolsHook: boolean;
  };
  limitations: string[];
};

export type CommentMenuOptions = {
  title: string;
  maxComments: number;
};

export type ReadCommentsOptions = {
  maxComments: number;
  symbolicate: boolean;
};

export type ReviewComment = {
  commentId: string;
  text: string;
  createdAt: string;
  source: "inspector" | "overlay" | "annotation-board";
  coordinates?: { x: number; y: number };
  element?: JsonValue;
};

export interface TraceAdapter {
  start(target: TargetRecord, options: TraceOptions): Promise<TraceResult>;
  read(target: TargetRecord, options: TraceReadOptions): Promise<TraceResult>;
  stop(target: TargetRecord): Promise<TraceResult>;
  clear(target: TargetRecord): Promise<TraceResult>;
}

export type TraceOptions = {
  componentFilter?: string;
  maxEvents: number;
  includeEvents: boolean;
};

export type TraceReadOptions = {
  maxEvents: number;
  includeEvents: boolean;
};

export type TraceResult = {
  available: boolean;
  action: "start" | "read" | "stop" | "clear";
  artifact: ArtifactRef | null;
  summary: JsonValue;
  limitations: string[];
};

export interface AnnotationAdapter {
  create(options: AnnotationOptions): Promise<AnnotationBoard>;
  serve(board: AnnotationBoard, options: AnnotationServeOptions): Promise<AnnotationBoard>;
  read(boardDir: string): Promise<ReviewComment[]>;
}

export type AnnotationOptions = {
  screenshotPath: string;
  outputDir: string;
  title?: string;
  context?: JsonValue;
};

export type AnnotationServeOptions = {
  port?: number;
};

export type AnnotationBoard = {
  boardId: string;
  outputDir: string;
  html: ArtifactRef;
  annotations: ArtifactRef;
  context: ArtifactRef;
  screenshot: ArtifactRef;
  serverUrl: string | null;
};

export interface ReviewOverlayAdapter {
  scaffold(options: ReviewOverlayScaffoldOptions): Promise<ReviewOverlayResult>;
  prepare(options: ReviewOverlayPrepareOptions): Promise<ReviewOverlayResult>;
  read(options: ReviewOverlayReadOptions): Promise<ReviewOverlayReadResult>;
  clear(options: ReviewOverlayClearOptions): Promise<Availability>;
}

export type ReviewOverlayScaffoldOptions = {
  cwd: string;
  overlayDir: string;
  force: boolean;
};

export type ReviewOverlayPrepareOptions = {
  cwd: string;
  outputDir: string;
  endpointPath: string;
  port?: number;
  serve: boolean;
};

export type ReviewOverlayReadOptions = {
  cwd: string;
  outputDir: string;
  metroPort?: number;
};

export type ReviewOverlayClearOptions = {
  outputDir: string;
};

export type ReviewOverlayResult = {
  available: boolean;
  artifacts: ArtifactRef[];
  endpointUrl: string | null;
  instructions: string[];
};

export type ReviewOverlayReadResult = {
  comments: ReviewComment[];
  artifacts: ArtifactRef[];
  limitations: string[];
};

export interface ReviewGuidanceAdapter {
  nextStep(args: ReviewGuidanceArgs): Promise<ReviewNextResult>;
}

export type ReviewGuidanceArgs = {
  surface: "calendar" | "timeline" | "form" | "list" | "navigation" | "editor" | "generic";
  stage: "intake" | "pre-patch" | "post-patch" | "verifier-failed" | "interaction" | "handoff";
  issue?: string;
  flags: Record<string, boolean | string | number | null>;
};

export type ReviewNextResult = {
  constraint: JsonValue;
  nextStep: string;
  requiredFlows: JsonValue;
  suggestedCommands: string[];
  stopConditions: string[];
};

export interface ReviewReportAdapter {
  report(options: ReviewReportOptions): Promise<ReviewReportResult>;
  matrix(options: ReviewMatrixOptions): Promise<ReviewReportResult>;
}

export type ReviewReportOptions = {
  sessionId?: string;
  outputPath?: string;
};

export type ReviewMatrixOptions = {
  sessionId?: string;
  acceptancePath?: string;
  outputPath?: string;
};

export type ReviewReportResult = {
  reportId: string;
  artifact: ArtifactRef;
  evidence: ArtifactRef[];
  limitations: string[];
};
