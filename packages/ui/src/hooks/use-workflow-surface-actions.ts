import type { ProjectTargetRef } from "@/api/client.js";
import { getIsoNow } from "@/api/workflow-domain-helpers.js";
import type { ItemDto, ItemKind, ItemStatus, ResourceLinkType } from "@/api/workflow-dto-types.js";
import {
  generateWorkflowRequestId,
  useAbandonWorkflowSession,
  useCreateWorkflowItem,
  useCreateWorkflowNote,
  useCreateWorkflowSession,
  useEndWorkflowSession,
  useLinkWorkflowResource,
  usePatchWorkflowItem,
  useUnlinkWorkflowResource,
} from "@/api/workflow-queries.js";

export function useWorkflowSurfaceActions(effectiveTarget: ProjectTargetRef) {
  const createItem = useCreateWorkflowItem();
  const patchItem = usePatchWorkflowItem();
  const createNote = useCreateWorkflowNote();
  const createSession = useCreateWorkflowSession();
  const endSession = useEndWorkflowSession();
  const abandonSession = useAbandonWorkflowSession();
  const linkResource = useLinkWorkflowResource();
  const unlinkResource = useUnlinkWorkflowResource();

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
      updatedAt: getIsoNow(),
      status,
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
    handleEndSession,
    handleAbandonSession,
    handleLinkResource,
    handleUnlinkResource,
  };
}
