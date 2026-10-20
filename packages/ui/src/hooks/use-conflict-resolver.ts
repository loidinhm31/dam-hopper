import { useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useSyncExternalStore,
  useCallback,
  useRef,
  useMemo,
  useState,
} from "react";
import {
  captureConnection,
  getApi,
  getConnectionSnapshot,
  isCurrentConnection,
  onConnectionInvalidated,
  useConnectionSnapshot,
} from "@/api/connections.js";
import { getProfiles, normalizeServerUrl } from "@/api/server-config.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import {
  invalidateGitProjectQueries,
  useGitExecuteOperation,
  useGitOperationStatus,
} from "@/api/queries.js";
import {
  ApiRequestError,
  normalizeProjectTarget,
  type ConnectionRef,
  type ConflictSnapshot,
  type ConflictSummaryEntry,
  type ProjectTargetInput,
} from "@/api/client.js";
import type {
  DraftOwnerScope,
  TerminalHandoffContext,
} from "@/lib/conflict-draft-types.js";
import { conflictDraftStore } from "@/lib/conflict-draft-store.js";
import { matchesOwnerScope } from "@/lib/conflict-draft-key.js";
import { tokenizeLosslessLines } from "@/lib/conflict-merge-model.js";

async function fetchConflictInventory(
  scope: DraftOwnerScope,
  owner: { profileId: string; generation: number },
): Promise<ConflictSummaryEntry[]> {
  const api = getApi(owner);
  const target = {
    profileId: scope.profileId,
    project: scope.project,
    worktreePath: scope.worktreePath ?? undefined,
  };
  const entries: ConflictSummaryEntry[] = [];
  let cursor: string | undefined;
  let restarted = false;
  for (;;) {
    try {
      const page = await api.git.conflicts(
        target,
        scope.root ?? undefined,
        cursor,
      );
      if (!isCurrentConnection(owner)) {
        throw new Error("Connection retired while reading conflict inventory");
      }
      entries.push(...page.entries);
      cursor = page.nextCursor;
      if (!cursor) return entries;
    } catch (error) {
      if (
        cursor &&
        !restarted &&
        error instanceof ApiRequestError &&
        error.code === "GIT_CONFLICT_CURSOR_STALE"
      ) {
        entries.length = 0;
        cursor = undefined;
        restarted = true;
        continue;
      }
      throw error;
    }
  }
}

function captureScopeOwner(scope: DraftOwnerScope): ConnectionRef {
  const owner = captureConnection(scope.profileId);
  const profile = getProfiles().find((item) => item.id === scope.profileId);
  const connection = getConnectionSnapshot(scope.profileId);
  if (
    owner.generation !== scope.generation ||
    !profile ||
    connection?.status !== "connected" ||
    connection.owner.generation !== scope.generation ||
    normalizeServerUrl(profile.url) !== normalizeServerUrl(scope.serverUrl) ||
    normalizeServerUrl(connection.serverUrl) !==
      normalizeServerUrl(scope.serverUrl)
  ) {
    throw new Error("Conflict owner or server binding changed");
  }
  return owner;
}
export function useConflictResolver(
  targetInput?: ProjectTargetInput,
  root?: string,
) {
  const storeState = useSyncExternalStore(
    (l) => conflictDraftStore.subscribe(l),
    () => conflictDraftStore.getSnapshot(),
    () => conflictDraftStore.getSnapshot(),
  );
  const queryClient = useQueryClient();

  const activeProfile = useServerProfile();
  const normalizedTarget = targetInput
    ? normalizeProjectTarget(targetInput)
    : null;
  const project = normalizedTarget?.project ?? "";
  const worktreePath = normalizedTarget?.worktreePath ?? undefined;

  const targetProfileId =
    normalizedTarget?.profileId ?? activeProfile?.id ?? "";
  const connection = useConnectionSnapshot(targetProfileId);
  const profileId = connection?.owner.profileId ?? targetProfileId;
  const generation = connection?.owner.generation ?? 0;
  const serverUrl = connection?.serverUrl ?? "";
  useEffect(() => {
    const owners = new Map<string, { profileId: string; generation: number }>();
    for (const draft of storeState.drafts) {
      owners.set(`${draft.scope.profileId}:${draft.scope.generation}`, {
        profileId: draft.scope.profileId,
        generation: draft.scope.generation,
      });
    }
    const unsubscribe: Array<() => void> = [];
    for (const owner of owners.values()) {
      if (!isCurrentConnection(owner)) {
        conflictDraftStore.retireScope(owner.profileId, owner.generation);
      } else {
        unsubscribe.push(
          onConnectionInvalidated(owner, () =>
            conflictDraftStore.retireScope(owner.profileId, owner.generation),
          ),
        );
      }
    }
    return () => unsubscribe.forEach((unsub) => unsub());
  }, [storeState.drafts]);

  // Window beforeunload guard for dirty drafts
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (conflictDraftStore.hasDirtyDrafts()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const operationQuery = useGitOperationStatus(normalizedTarget ?? "", root, {
    enabled: Boolean(project && connection?.status === "connected"),
  });
  const executeOperationMutation = useGitExecuteOperation(
    normalizedTarget ?? "",
  );
  const currentScope: DraftOwnerScope | null = useMemo(
    () =>
      project &&
      connection?.status === "connected" &&
      connection.owner.profileId === targetProfileId
        ? {
            profileId,
            generation,
            serverUrl,
            configuredRoot: undefined,
            project,
            worktreePath,
            root,
          }
        : null,
    [
      project,
      connection,
      targetProfileId,
      profileId,
      generation,
      serverUrl,
      worktreePath,
      root,
    ],
  );
  const currentScopeRef = useRef(currentScope);
  const loadRequestRef = useRef(0);
  currentScopeRef.current = currentScope;
  const [conflictInventory, setConflictInventory] = useState<{
    scope: DraftOwnerScope | null;
    entries: ConflictSummaryEntry[];
  }>({ scope: null, entries: [] });
  const conflictEntries =
    currentScope &&
    conflictInventory.scope &&
    matchesOwnerScope(currentScope, conflictInventory.scope)
      ? conflictInventory.entries
      : [];
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);

  const loadConflicts = useCallback(async () => {
    if (
      !currentScope ||
      currentScopeRef.current !== currentScope ||
      connection?.status !== "connected"
    ) {
      throw new Error(
        "Conflict inventory requires the current owner connection",
      );
    }
    const owner = captureScopeOwner(currentScope);
    const entries = await fetchConflictInventory(currentScope, owner);
    if (currentScopeRef.current !== currentScope) {
      throw new Error("Conflict target changed while reading inventory");
    }
    return entries;
  }, [currentScope, connection]);
  useEffect(() => {
    let cancelled = false;
    setConflictInventory({ scope: currentScope, entries: [] });
    setInventoryError(null);
    if (!currentScope) {
      setInventoryLoading(false);
      return;
    }
    setInventoryLoading(true);
    void loadConflicts()
      .then((entries) => {
        if (!cancelled && currentScopeRef.current === currentScope) {
          conflictDraftStore.markMissingConflicts(
            currentScope,
            new Set(entries.map((entry) => entry.conflictId)),
          );
          setConflictInventory({ scope: currentScope, entries });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && currentScopeRef.current === currentScope) {
          setConflictInventory({ scope: currentScope, entries: [] });
          setInventoryError(
            error instanceof Error
              ? error.message
              : "Conflict inventory failed",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setInventoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentScope, loadConflicts]);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshOwnerScope = useCallback(
    async (scope: DraftOwnerScope) => {
      const owner = captureScopeOwner(scope);
      const api = getApi(owner);
      const target = {
        profileId: scope.profileId,
        project: scope.project,
        worktreePath: scope.worktreePath ?? undefined,
      };
      const isSelectedScope =
        currentScopeRef.current !== null &&
        matchesOwnerScope(scope, currentScopeRef.current);
      const operationPromise = isSelectedScope
        ? operationQuery.refetch({ throwOnError: true }).then((result) => {
            if (!result.data) {
              throw new Error("Operation status refresh returned no data");
            }
            return result.data;
          })
        : api.git.operationStatus(target, scope.root ?? undefined);
      const [entries] = await Promise.all([
        fetchConflictInventory(scope, owner),
        operationPromise,
      ]);
      if (!isCurrentConnection(owner)) {
        throw new Error("Conflict owner retired during authoritative refresh");
      }
      conflictDraftStore.markMissingConflicts(
        scope,
        new Set(entries.map((entry) => entry.conflictId)),
      );
      if (
        currentScopeRef.current &&
        matchesOwnerScope(scope, currentScopeRef.current)
      ) {
        setConflictInventory({ scope, entries });
        setInventoryError(null);
        setRefreshError(null);
      }
      return entries;
    },
    [operationQuery.refetch],
  );
  const refreshAuthoritative = useCallback(async () => {
    const scope = currentScopeRef.current;
    if (!scope) {
      throw new Error("Conflict owner changed before authoritative refresh");
    }
    return refreshOwnerScope(scope);
  }, [refreshOwnerScope]);

  const loadConflictDraft = useCallback(
    async (
      conflictId: string,
      providedSnapshot?: ConflictSnapshot,
      requireFreshSnapshot = false,
    ) => {
      if (!currentScope || connection?.status !== "connected") {
        throw new Error(
          "Conflict snapshot requires an active owner connection",
        );
      }
      const scope = currentScope;
      const requestId = ++loadRequestRef.current;
      const owner = captureScopeOwner(scope);
      const api = getApi(owner);
      const target = {
        profileId: scope.profileId,
        project: scope.project,
        worktreePath: scope.worktreePath ?? undefined,
      };
      const assertCurrentLoad = () => {
        if (
          requestId !== loadRequestRef.current ||
          !isCurrentConnection(owner) ||
          !currentScopeRef.current ||
          !matchesOwnerScope(scope, currentScopeRef.current)
        ) {
          throw new Error("Conflict selection or owner changed while loading");
        }
        captureScopeOwner(scope);
      };

      let inventory = conflictEntries;
      if (
        requireFreshSnapshot ||
        !inventory.some((entry) => entry.conflictId === conflictId)
      ) {
        inventory = await loadConflicts();
        assertCurrentLoad();
      }
      const inventoryEntry = inventory.find(
        (entry) => entry.conflictId === conflictId,
      );
      if (!inventoryEntry) {
        throw new Error("Conflict is no longer in the current inventory");
      }
      if (providedSnapshot && providedSnapshot.conflictId !== conflictId) {
        throw new Error(
          "Provided conflict snapshot does not match the selected conflict",
        );
      }
      if (providedSnapshot && providedSnapshot.path !== inventoryEntry.path) {
        throw new Error(
          "Provided conflict snapshot path does not match the current inventory",
        );
      }
      const snapshot =
        providedSnapshot && !requireFreshSnapshot
          ? providedSnapshot
          : await api.git.conflictFile(
              target,
              conflictId,
              scope.root ?? undefined,
            );
      if (
        snapshot.conflictId !== conflictId ||
        snapshot.path !== inventoryEntry.path
      ) {
        throw new Error(
          "Conflict detail does not match the current inventory entry",
        );
      }
      assertCurrentLoad();
      const operation = await api.git.operationStatus(
        target,
        scope.root ?? undefined,
      );
      assertCurrentLoad();
      const loaded = conflictDraftStore.loadSnapshot(
        scope,
        snapshot,
        operation.stageRoleLabels,
      );
      if ("error" in loaded) throw new Error(loaded.error);
      if (requestId === loadRequestRef.current) {
        conflictDraftStore.setActiveDraft(loaded.draft.id);
        conflictDraftStore.setVisible(true);
      }
      return loaded.draft;
    },
    [currentScope, connection, conflictEntries, loadConflicts],
  );
  const importRecoveryDraft = useCallback(
    async (recoveryKey: string) => {
      const recovery = conflictDraftStore
        .getSnapshot()
        .drafts.find((draft) => draft.id === recoveryKey);
      if (!recovery?.isRecovery) {
        throw new Error("Recovery draft is unavailable");
      }
      const scope = currentScopeRef.current;
      if (!scope) {
        throw new Error(
          "Select the original server and worktree before importing recovery text",
        );
      }
      if (
        scope.profileId !== recovery.scope.profileId ||
        normalizeServerUrl(scope.serverUrl) !==
          normalizeServerUrl(recovery.scope.serverUrl) ||
        scope.project !== recovery.scope.project ||
        (scope.worktreePath ?? "") !== (recovery.scope.worktreePath ?? "") ||
        (scope.root ?? "") !== (recovery.scope.root ?? "")
      ) {
        throw new Error(
          "Recovery text belongs to a different server or worktree",
        );
      }
      const entries = await loadConflicts();
      if (
        currentScopeRef.current !== scope ||
        !conflictDraftStore
          .getSnapshot()
          .drafts.some((draft) => draft.id === recoveryKey && draft.isRecovery)
      ) {
        throw new Error(
          "Recovery owner changed before fresh inventory completed",
        );
      }
      const currentConflict = entries.find(
        (entry) => entry.path === recovery.target.path,
      );
      if (!currentConflict) {
        throw new Error(
          "The conflict is no longer present in the fresh inventory",
        );
      }
      const fresh = await loadConflictDraft(
        currentConflict.conflictId,
        undefined,
        true,
      );
      if (currentScopeRef.current !== scope) {
        throw new Error("Recovery owner changed before import completed");
      }
      const imported = conflictDraftStore.importRecoveryDraft(
        recoveryKey,
        fresh.id,
      );
      if (!imported.success) {
        throw new Error(
          imported.error ?? "Recovery text could not be imported",
        );
      }
      return (
        conflictDraftStore
          .getSnapshot()
          .drafts.find((draft) => draft.id === fresh.id) ?? fresh
      );
    },
    [loadConflicts, loadConflictDraft],
  );

  const applyDraft = useCallback(
    async (draftKey: string) => {
      const draft = conflictDraftStore
        .getSnapshot()
        .drafts.find((candidate) => candidate.id === draftKey);
      if (!draft) throw new Error("Draft not found");
      if (
        !isCurrentConnection({
          profileId: draft.scope.profileId,
          generation: draft.scope.generation,
        })
      ) {
        conflictDraftStore.markAsRecovery(
          draftKey,
          "Original owner is unavailable or retired",
        );
        throw new Error("Draft owner is no longer connected; no write sent");
      }
      if (draft.isResolving) throw new Error("Mutation already in flight");
      if (draft.isRecovery || draft.requiresReview || draft.isApplied) {
        throw new Error("Draft requires a fresh snapshot before another Apply");
      }
      if (
        draft.status === "unsupported" ||
        draft.worktree.kind !== "regular" ||
        draft.stages.ours.kind !== "text" ||
        draft.stages.theirs.kind !== "text"
      ) {
        throw new Error(
          "This conflict is not eligible for reviewed-text resolution",
        );
      }

      let owner: ConnectionRef;
      try {
        owner = captureScopeOwner(draft.scope);
      } catch {
        conflictDraftStore.markAsRecovery(
          draftKey,
          "Server binding or connection generation changed; explicit re-review required",
        );
        throw new Error("Draft owner changed; no write sent");
      }

      const target = {
        profileId: draft.scope.profileId,
        project: draft.scope.project,
        worktreePath: draft.scope.worktreePath ?? undefined,
      };
      const eolAttr = draft.authority.effectiveAttributes?.eol;
      const eol: "preserve" | "lf" | "crlf" =
        eolAttr === "crlf" ? "crlf" : eolAttr === "lf" ? "lf" : "preserve";
      const action = {
        type: "reviewedText" as const,
        tokens: tokenizeLosslessLines(draft.result),
        eol,
      };
      const attempt = conflictDraftStore.beginResolve(draftKey, action);
      try {
        const outcome = await getApi(owner).git.resolve(target, {
          conflictId: draft.target.conflictId,
          snapshotVersion: draft.target.snapshotVersion,
          fullIndexFingerprint: draft.authority.fullIndexFingerprint,
          action,
          root: draft.scope.root ?? undefined,
        });
        conflictDraftStore.reconcileOutcome(
          draftKey,
          attempt.attemptId,
          outcome,
        );
        if (!isCurrentConnection(owner)) {
          conflictDraftStore.markAsRecovery(
            draftKey,
            "Mutation outcome was received after its connection retired; fresh review required",
          );
        }
        return outcome;
      } catch (error) {
        conflictDraftStore.markAsRecovery(
          draftKey,
          "Mutation response unavailable; outcome unknown, refresh required",
        );
        conflictDraftStore.cancelResolve(draftKey, attempt.attemptId);
        throw error;
      } finally {
        if (isCurrentConnection(owner)) {
          invalidateGitProjectQueries(queryClient, target, {
            includeConflicts: true,
            includeFileTree: true,
            includeGitDiff: true,
            includeOperation: true,
            includeProjectStatus: true,
            reconcileEditorTabs: true,
          });
        }
        try {
          await refreshOwnerScope(draft.scope);
        } catch (error) {
          if (
            currentScopeRef.current &&
            matchesOwnerScope(draft.scope, currentScopeRef.current)
          ) {
            setRefreshError(
              error instanceof Error
                ? error.message
                : "Post-attempt authoritative refresh failed",
            );
          }
        }
      }
    },
    [queryClient, refreshOwnerScope],
  );
  const runOperation = useCallback(
    async (
      request: Parameters<typeof executeOperationMutation.mutateAsync>[0],
    ) => {
      const scope = currentScope;
      if (
        !scope ||
        currentScopeRef.current !== scope ||
        !isCurrentConnection({
          profileId: scope.profileId,
          generation: scope.generation,
        })
      ) {
        throw new Error("Operation owner is unavailable or retired");
      }
      captureScopeOwner(scope);
      try {
        return await executeOperationMutation.mutateAsync(request);
      } finally {
        try {
          await refreshOwnerScope(scope);
        } catch (error) {
          if (
            currentScopeRef.current &&
            matchesOwnerScope(scope, currentScopeRef.current)
          ) {
            setRefreshError(
              error instanceof Error
                ? error.message
                : "Post-operation authoritative refresh failed",
            );
          }
        }
      }
    },
    [currentScope, executeOperationMutation, refreshOwnerScope],
  );

  const continueOperation = useCallback(async () => {
    const op = operationQuery.data;
    if (!op || !op.canContinue)
      throw new Error("Operation cannot be continued");
    return runOperation({
      action: "continue",
      operationPrecondition: op.operationFingerprint,
      fullIndexFingerprint: op.fullIndexFingerprint,
      root,
      worktreePath,
    });
  }, [operationQuery.data, runOperation, root, worktreePath]);

  const abortOperation = useCallback(
    async (confirmed: boolean) => {
      const op = operationQuery.data;
      if (!op || !op.canAbort) throw new Error("Operation cannot be aborted");
      return runOperation({
        action: "abort",
        abortConfirmed: confirmed,
        operationPrecondition: op.operationFingerprint,
        fullIndexFingerprint: op.fullIndexFingerprint,
        root,
        worktreePath,
      });
    },
    [operationQuery.data, runOperation, root, worktreePath],
  );
  const refreshAfterTerminalReturn = useCallback(
    async (handoff: TerminalHandoffContext) => {
      const scope = currentScopeRef.current;
      if (!scope || !matchesOwnerScope(scope, handoff)) {
        throw new Error(
          "Terminal returned for a retired or different Git owner",
        );
      }
      await refreshOwnerScope(scope);
    },
    [refreshOwnerScope],
  );

  const confirmFreshReview = useCallback(
    async (key: string) => {
      const draft = conflictDraftStore
        .getSnapshot()
        .drafts.find((candidate) => candidate.id === key);
      const scope = currentScopeRef.current;
      if (!draft?.requiresReview || draft.isRecovery || !scope) {
        throw new Error("Draft is not ready for fresh-snapshot review");
      }
      if (!matchesOwnerScope(draft.scope, scope)) {
        throw new Error("Fresh review must occur in the original owner scope");
      }
      const fresh = await loadConflictDraft(
        draft.target.conflictId,
        undefined,
        true,
      );
      if (
        fresh.id !== key ||
        fresh.target.snapshotVersion !== draft.target.snapshotVersion ||
        fresh.authority.fullIndexFingerprint !==
          draft.authority.fullIndexFingerprint
      ) {
        throw new Error(
          "Conflict changed during review; import into its new snapshot",
        );
      }
      if (!conflictDraftStore.confirmFreshReview(key)) {
        throw new Error("Fresh-snapshot review could not be confirmed");
      }
    },
    [loadConflictDraft],
  );

  const cancelPendingDraftLoads = useCallback(() => {
    loadRequestRef.current += 1;
  }, []);
  const getDraft = useCallback((key: string) => {
    return (
      conflictDraftStore
        .getSnapshot()
        .drafts.find((candidate) => candidate.id === key) ?? null
    );
  }, []);
  const selectDraft = useCallback((key: string | null) => {
    loadRequestRef.current += 1;
    conflictDraftStore.setActiveDraft(key);
  }, []);
  const setVisible = useCallback((visible: boolean) => {
    if (!visible) loadRequestRef.current += 1;
    conflictDraftStore.setVisible(visible);
  }, []);
  const terminalHandoff: TerminalHandoffContext | null = operationQuery.data
    ?.terminalHandoffRequired
    ? {
        reason: operationQuery.data.terminalHandoffRequired.reason,
        worktreeRoot: operationQuery.data.terminalHandoffRequired.worktreeRoot,
        profileId,
        generation,
        serverUrl,
        project,
        worktreePath,
        root,
      }
    : null;

  return {
    drafts: storeState.drafts,
    activeDraft: storeState.activeDraft,
    activeDraftKey: storeState.activeDraftKey,
    isPanelVisible: storeState.isPanelVisible,
    currentScope,
    conflicts: conflictEntries,
    inventoryError,
    refreshError,
    operation: operationQuery.data,
    terminalHandoff,
    refreshAfterTerminalReturn,
    loadConflicts,
    loadConflictDraft,
    cancelPendingDraftLoads,
    getDraft,
    isLoading: inventoryLoading || operationQuery.isLoading,
    selectDraft,
    setVisible,
    updateDraftResult: (key: string, text: string) =>
      conflictDraftStore.updateResult(key, text),
    undoDraft: (key: string) => {
      if (!conflictDraftStore.undo(key)) return null;
      return (
        conflictDraftStore
          .getSnapshot()
          .drafts.find((draft) => draft.id === key)?.result ?? null
      );
    },
    redoDraft: (key: string) => {
      if (!conflictDraftStore.redo(key)) return null;
      return (
        conflictDraftStore
          .getSnapshot()
          .drafts.find((draft) => draft.id === key)?.result ?? null
      );
    },
    discardDraft: (key: string, confirmDirtyLoss?: boolean) =>
      conflictDraftStore.discardDraft(key, confirmDirtyLoss),
    importRecoveryDraft,
    confirmFreshReview,
    applyDraft,
    continueOperation,
    abortOperation,
    refetchAll: refreshAuthoritative,
  };
}
