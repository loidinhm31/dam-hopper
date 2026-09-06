import type { ProjectTargetRef } from "@/api/client.js";
import { getIsoNow } from "@/api/workflow-domain-helpers.js";
import type { ItemDto, ItemKind, ItemStatus, NoteDto, ResourceLinkType } from "@/api/workflow-dto-types.js";
import {
  generateWorkflowRequestId,
  useAbandonWorkflowSession,
  useCreateWorkflowItem,
  useCreateWorkflowNote,
  useCreateWorkflowSession,
  useDeleteWorkflowItem,
  useDeleteWorkflowNote,
  useEndWorkflowSession,
  useLinkWorkflowResource,
  usePatchWorkflowItem,
  useUnlinkWorkflowResource,
} from "@/api/workflow-queries.js";

export interface WorkflowSurfaceActions {
  handleCreateItem: (item: {
    target: ProjectTargetRef;
    kind: ItemKind;
    title: string;
    summary?: string;
    status: ItemStatus;
    parentId?: string | null;
    startSessionImmediately?: boolean;
  }) => Promise<void>;
  handleStatusChange: (item: ItemDto, status: ItemStatus) => Promise<unknown>;
  handleAddNote: (itemId: string, body: string) => Promise<unknown>;
  handleStartSession: (startedAt: string, itemId?: string | null) => Promise<unknown>;
  handleEndSession: (sessionId: string, endedAt: string) => Promise<unknown>;
  handleAbandonSession: (sessionId: string) => Promise<unknown>;
  handleLinkResource: (
    sessionId: string,
    req: {
      resourceType: ResourceLinkType;
      externalId: string;
      harnessLabel?: string;
      runId?: string;
    },
  ) => Promise<unknown>;
  handleUnlinkResource: (
    sessionId: string,
    resourceType: ResourceLinkType,
    externalId: string,
  ) => Promise<unknown>;
  handleDeleteItem: (item: ItemDto) => Promise<unknown>;
  handleUpdateItem: (
    item: ItemDto,
    updates: { title?: string; summary?: string | null },
  ) => Promise<unknown>;
  handleDeleteNote: (note: NoteDto) => Promise<unknown>;
}
export function useWorkflowSurfaceActions(effectiveTarget: ProjectTargetRef): WorkflowSurfaceActions {
  const createItem = useCreateWorkflowItem();
  const patchItem = usePatchWorkflowItem();
  const createNote = useCreateWorkflowNote();
  const createSession = useCreateWorkflowSession();
  const endSession = useEndWorkflowSession();
  const abandonSession = useAbandonWorkflowSession();
  const linkResource = useLinkWorkflowResource();
  const unlinkResource = useUnlinkWorkflowResource();
  const deleteItem = useDeleteWorkflowItem();
  const deleteNote = useDeleteWorkflowNote();

  const handleCreateItem = async (item: {
    target: ProjectTargetRef;
    kind: ItemKind;
    title: string;
    summary?: string;
    status: ItemStatus;
    parentId?: string | null;
    startSessionImmediately?: boolean;
  }) => {
    const res = await createItem.mutateAsync({
      requestId: generateWorkflowRequestId(),
      target: item.target,
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      status: item.status,
      parentId: item.parentId,
    });
    if (item.startSessionImmediately && res.resource) {
      await createSession.mutateAsync({
        requestId: generateWorkflowRequestId(),
        target: item.target,
        itemId: res.resource.id,
        startedAt: getIsoNow(),
      });
    }
  };

  const handleStatusChange = (item: ItemDto, status: ItemStatus) =>
    patchItem.mutateAsync({
      id: item.id,
      requestId: generateWorkflowRequestId(),
      updatedAt: item.updatedAt,
      status,
    });
  const handleDeleteItem = (item: ItemDto) =>
    deleteItem.mutateAsync({
      id: item.id,
      requestId: generateWorkflowRequestId(),
      updatedAt: item.updatedAt,
    });

  const handleUpdateItem = (
    item: ItemDto,
    updates: { title?: string; summary?: string | null },
  ) =>
    patchItem.mutateAsync({
      id: item.id,
      requestId: generateWorkflowRequestId(),
      updatedAt: item.updatedAt,
      ...updates,
    });

  const handleDeleteNote = (note: NoteDto) =>
    deleteNote.mutateAsync({
      id: note.id,
      requestId: generateWorkflowRequestId(),
      updatedAt: note.updatedAt,
    });

  const handleAddNote = (itemId: string, body: string) =>
    createNote.mutateAsync({
      requestId: generateWorkflowRequestId(),
      itemId,
      body,
    });

  const handleStartSession = (startedAt: string, itemId?: string | null) =>
    createSession.mutateAsync({
      requestId: generateWorkflowRequestId(),
      target: effectiveTarget,
      itemId,
      startedAt,
    });

  const handleEndSession = (sessionId: string, endedAt: string) =>
    endSession.mutateAsync({
      id: sessionId,
      requestId: generateWorkflowRequestId(),
      endedAt,
    });

  const handleAbandonSession = (sessionId: string) =>
    abandonSession.mutateAsync({
      id: sessionId,
      requestId: generateWorkflowRequestId(),
    });

  const handleLinkResource = (
    sessionId: string,
    req: {
      resourceType: ResourceLinkType;
      externalId: string;
      harnessLabel?: string;
      runId?: string;
    },
  ) =>
    linkResource.mutateAsync({
      sessionId,
      requestId: generateWorkflowRequestId(),
      ...req,
    });

  const handleUnlinkResource = (
    sessionId: string,
    resourceType: ResourceLinkType,
    externalId: string,
  ) =>
    unlinkResource.mutateAsync({
      sessionId,
      requestId: generateWorkflowRequestId(),
      updatedAt: getIsoNow(),
      resourceType,
      externalId,
    });

  return {
    handleCreateItem,
    handleStatusChange,
    handleAddNote,
    handleStartSession,
    handleDeleteItem,
    handleUpdateItem,
    handleDeleteNote,
    handleEndSession,
    handleAbandonSession,
    handleLinkResource,
    handleUnlinkResource,
  };
}
