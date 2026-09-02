import type { ProjectTargetRef } from "./client.js";

// ── Enums & String Unions ───────────────────────────────────────────────────

export type ItemKind = "plan" | "phase" | "task";

export type ItemStatus =
  | "backlog"
  | "next"
  | "in_progress"
  | "blocked"
  | "done"
  | "canceled";

export type SessionStatus = "running" | "ended" | "abandoned";

export type ResourceLinkType = "terminal" | "agent";

export type ResourceObservedState =
  | "attached"
  | "exited"
  | "stale"
  | "detached"
  | "crashed"
  | "unknown";

export type WorkflowSource =
  | "manual"
  | "terminal"
  | "git"
  | "agent"
  | "system";

export type WorkflowEventType =
  | "item_created"
  | "item_updated"
  | "item_status_changed"
  | "item_deleted"
  | "session_started"
  | "session_ended"
  | "session_abandoned"
  | "session_updated"
  | "resource_linked"
  | "resource_unlinked"
  | "resource_observed"
  | "note_added"
  | "note_deleted"
  | "workspace_purged";

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface TargetDto {
  project: string;
  worktreePath?: string | null;
}

export interface ItemDto {
  id: string;
  target: TargetDto;
  parentId?: string | null;
  kind: ItemKind;
  title: string;
  summary?: string | null;
  status: ItemStatus;
  sortOrder: number;
  source: WorkflowSource;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface SessionDto {
  id: string;
  target: TargetDto;
  itemId?: string | null;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string | null;
  source: WorkflowSource;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDto {
  id: string;
  itemId?: string | null;
  sessionId?: string | null;
  body: string;
  source: WorkflowSource;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface LinkDto {
  id: string;
  sessionId: string;
  resourceType: ResourceLinkType;
  externalId: string;
  incarnation?: number | null;
  harnessLabel?: string | null;
  runId?: string | null;
  observedState: ResourceObservedState;
  suggestedEndTime?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  linkSource: WorkflowSource;
  createdAt: string;
  updatedAt: string;
}

export interface EventDto {
  id: string;
  eventType: WorkflowEventType;
  source: WorkflowSource;
  target?: TargetDto | null;
  itemId?: string | null;
  sessionId?: string | null;
  occurredAt: string;
  recordedAt: string;
}

export interface ProjectDto {
  project: string;
  target?: TargetDto | null;
  planCount: number;
  taskCount: number;
  runningSessionCount: number;
  lastActivityAt?: string | null;
}

export interface ItemProgressDto {
  totalTrackedTasks: number;
  completedTrackedTasks: number;
}

export interface ItemOverviewNodeDto {
  item: ItemDto;
  progress?: ItemProgressDto | null;
  notes: NoteDto[];
  activeSessions: SessionDto[];
  children: ItemOverviewNodeDto[];
}

export interface WorkspaceDto {
  id: string;
  name: string;
}

export interface OverviewDto {
  workspace: WorkspaceDto;
  serverTime: string;
  projects: ProjectDto[];
  plans: ItemOverviewNodeDto[];
  standaloneTasks: ItemOverviewNodeDto[];
  runningSessions: SessionDto[];
  recentEvents: EventDto[];
  truncated: boolean;
}

export interface EventsDto {
  events: EventDto[];
  nextCursor?: string | null;
}

export interface PurgeDto {
  eventsDeleted: number;
  notesDeleted: number;
}

export interface MutationDto<T> {
  resource: T;
  replayed: boolean;
  eventId: string;
}

export interface TombstoneDto {
  resourceType: string;
  id: string;
  deletedAt: string;
  parentId?: string | null;
}

// ── API Request Payloads ────────────────────────────────────────────────────

export interface EventsQuery {
  cursor?: string | null;
  limit?: number | null;
}

export interface CreateItemRequest {
  requestId: string;
  target: ProjectTargetRef;
  parentId?: string | null;
  kind: ItemKind;
  title: string;
  summary?: string | null;
  status?: ItemStatus | null;
  sortOrder?: number | null;
}

export interface PatchItemRequest {
  requestId: string;
  updatedAt: string;
  title?: string | null;
  summary?: string | null;
  status?: ItemStatus | null;
  sortOrder?: number | null;
  target?: ProjectTargetRef | null;
}

export interface DeleteItemRequest {
  requestId: string;
  updatedAt: string;
}

export interface CreateSessionRequest {
  requestId: string;
  target: ProjectTargetRef;
  itemId?: string | null;
  startedAt: string;
}

export interface EndSessionRequest {
  requestId: string;
  endedAt: string;
}

export interface AbandonSessionRequest {
  requestId: string;
}

export interface LinkResourceRequest {
  requestId: string;
  resourceType: ResourceLinkType;
  externalId: string;
  incarnation?: number | null;
  harnessLabel?: string | null;
  runId?: string | null;
}

export interface UnlinkResourceRequest {
  requestId: string;
  updatedAt: string;
  resourceType: ResourceLinkType;
  externalId: string;
}

export interface CreateNoteRequest {
  requestId: string;
  itemId?: string | null;
  sessionId?: string | null;
  body: string;
}

export interface DeleteNoteRequest {
  requestId: string;
  updatedAt: string;
}

export interface PurgeHistoryRequest {
  requestId?: string | null;
  before: string;
}
