import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import type { Tab } from "@/stores/editor.js";
import type { ConnectionRef } from "@/api/ownership.js";
import {
  isCurrentConnection,
  useConnectionSnapshot,
} from "@/api/connections.js";
import { getBoundApiClient, gitQueryKey } from "@/api/queries.js";
import {
  type GitBlameResponse,
  isGitBlameBusyError,
  isGitBlameStaleError,
  isGitBlameTooLargeError,
  projectTargetCacheKey,
} from "@/api/client.js";
import { subscribeIpc } from "./use-sse.js";
import { generateUUID } from "@/lib/utils.js";
import {
  computeMonacoLineCount,
  findOwningVcsRoot,
  GIT_BLAME_DEBOUNCE_MS,
  isBufferOverLimit,
  isMatchingGitQueryKey,
  validateBlameResponse,
} from "@/lib/editor-git-blame.js";
import {
  advanceTargetEpoch,
  beginRequestLease,
  beginRootDiscovery,
  cancelRootDiscovery,
  completeRootDiscovery,
  endRequestLease,
  getCompletedBlameHit,
  getModelBufferMetadata,
  getModelBufferSha256,
  isLeaseValid,
  setCompletedBlamePayload,
  touchCompletedBlameHit,
} from "@/lib/editor-git-blame-cache.js";

type TimerHandle = number | NodeJS.Timeout | null;

function extractErrorCode(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof err.code === "string"
  ) {
    return err.code;
  }
  return "GIT_BLAME_ERROR";
}

function extractProjectName(payload: unknown): string | undefined {
  if (
    payload &&
    typeof payload === "object" &&
    "projectName" in payload &&
    typeof payload.projectName === "string"
  ) {
    return payload.projectName;
  }
  return undefined;
}

export type EditorGitBlameStatus =
  | "off"
  | "waiting"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

export interface BlameTextModelSeam {
  id?: string;
  uri?: { toString: () => string };
  getVersionId: () => number;
  getValue: () => string;
  getLineCount?: () => number;
  onDidChangeContent?: (listener: (e: unknown) => void) => {
    dispose: () => void;
  };
}

export interface BlameEditorSeam {
  getModel?: () => BlameTextModelSeam | null;
  onDidChangeModel?: (listener: (e: unknown) => void) => {
    dispose: () => void;
  };
}

export interface UseEditorGitBlameParams {
  tab: Tab | null | undefined;
  editor: BlameEditorSeam | null | undefined;
  active?: boolean;
}

export interface UseEditorGitBlameResult {
  status: EditorGitBlameStatus;
  data: GitBlameResponse | null;
  error: string | null;
  errorCode: string | null;
  isBusy: boolean;
  unavailableReason: string | null;
  refresh: () => void;
}

export interface RepositoryRefreshOptions {
  force?: boolean;
  reblameOnSameHead?: boolean;
}

/**
 * Checks whether a tab is eligible for Git blame annotations:
 * normal/degraded text editor tabs with available targets, excluding diff,
 * binary, image, video, and large tier tabs.
 */
export function isBlameEligibleTab(tab: Tab | null | undefined): boolean {
  if (!tab) return false;
  if (!tab.targetAvailable) return false;
  if (tab.conflicted) return false;
  if (!tab.path || tab.path.trim().length === 0) return false;
  if (
    tab.tier === "diff" ||
    tab.tier === "binary" ||
    tab.tier === "image" ||
    tab.tier === "video" ||
    tab.tier === "large"
  ) {
    return false;
  }
  return true;
}

export function useEditorGitBlame({
  tab,
  editor,
  active = true,
}: UseEditorGitBlameParams): UseEditorGitBlameResult {
  const queryClient = useContext(QueryClientContext) ?? null;

  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const isEnabled = Boolean(
    tab?.blameEnabled && active && isDocumentVisible && isBlameEligibleTab(tab),
  );
  const profileId = tab?.target?.profileId ?? "";
  const snapshot = useConnectionSnapshot(profileId);

  const isOwnerConnected = Boolean(
    snapshot &&
    snapshot.status === "connected" &&
    (!tab?.resourceBinding?.serverUrl ||
      snapshot.serverUrl === tab.resourceBinding.serverUrl),
  );

  const localEpochRef = useRef<number>(1);

  // Synchronous warm hit derivation during render:
  // Inspect live Monaco model and QueryClient cache for matching owner/target/root/HEAD/content
  const model = editor?.getModel?.();
  const currentModelVersion = model?.getVersionId();
  const modelMeta =
    isEnabled &&
    isOwnerConnected &&
    model &&
    typeof model.getVersionId === "function" &&
    typeof model.getValue === "function"
      ? getModelBufferMetadata(
          model as { getVersionId: () => number; getValue: () => string },
        )
      : null;
  const isOverLimit = modelMeta?.isOverLimit ?? false;
  const currentContentHash = modelMeta?.sha256 ?? null;
  const currentLineCount = modelMeta?.lineCount ?? 0;
  const capturedOwner: ConnectionRef | null = snapshot?.owner
    ? {
        profileId: snapshot.owner.profileId,
        generation: snapshot.owner.generation,
      }
    : null;

  const warmHit =
    isEnabled &&
    isOwnerConnected &&
    queryClient &&
    capturedOwner &&
    tab &&
    model &&
    currentModelVersion !== undefined &&
    currentContentHash &&
    !isOverLimit
      ? getCompletedBlameHit(
          queryClient,
          capturedOwner,
          tab.target,
          tab.path,
          currentContentHash,
          currentLineCount,
          currentModelVersion,
          `${localEpochRef.current}-warm`,
        )
      : null;

  const [status, setStatus] = useState<EditorGitBlameStatus>(() => {
    if (!isEnabled) return "off";
    if (!isOwnerConnected) return "unavailable";
    if (warmHit?.hit && warmHit.data) return "ready";
    return "waiting";
  });
  const [data, setData] = useState<GitBlameResponse | null>(() => {
    if (warmHit?.hit && warmHit.data) return warmHit.data;
    return null;
  });
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(
    isEnabled && !isOwnerConnected
      ? snapshot
        ? "Connection not connected or binding mismatch"
        : "No active connection"
      : null,
  );

  const isMountedRef = useRef<boolean>(true);

  // Touch LRU access recency in effect for warm hit
  useEffect(() => {
    if (warmHit?.hit && warmHit.queryKey && queryClient) {
      touchCompletedBlameHit(queryClient, warmHit.queryKey);
    }
  }, [warmHit?.hit, warmHit?.queryKey, queryClient]);

  // Mutable refs to track identities and avoid stale closures
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const editorRef = useRef(editor);
  editorRef.current = editor;

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const isEnabledRef = useRef(isEnabled);
  isEnabledRef.current = isEnabled;

  const isOwnerConnectedRef = useRef(isOwnerConnected);
  isOwnerConnectedRef.current = isOwnerConnected;

  const dataRef = useRef(data);
  dataRef.current = data;

  const statusRef = useRef(status);
  statusRef.current = status;

  const inFlightRef = useRef<boolean>(false);
  const pendingIntentRef = useRef<boolean>(false);
  const activeControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<TimerHandle>(null);
  const refreshDebounceTimerRef = useRef<TimerHandle>(null);

  const pendingRefreshOptionsRef = useRef<RepositoryRefreshOptions>({
    force: false,
    reblameOnSameHead: false,
  });
  const bypassCacheNextRef = useRef<boolean>(false);

  const lastHeadCommitRef = useRef<string | null>(
    warmHit?.hit && warmHit.data ? (warmHit.data.baseCommitOid ?? null) : null,
  );
  const lastOwningRootIdRef = useRef<string | null>(
    warmHit?.hit && warmHit.data ? warmHit.data.rootId : null,
  );

  const currentIdentityKey = tab
    ? `${tab.target.profileId}:${snapshot?.owner.generation ?? 0}:${tab.target.project}:${projectTargetCacheKey(tab.target)}:${tab.path}:${tab.key}`
    : "";

  const [prevIdentity, setPrevIdentity] = useState<string>(currentIdentityKey);
  if (currentIdentityKey !== prevIdentity) {
    setPrevIdentity(currentIdentityKey);
    if (warmHit?.hit && warmHit.data) {
      setData(warmHit.data);
      dataRef.current = warmHit.data;
      setStatus("ready");
      lastHeadCommitRef.current = warmHit.data.baseCommitOid ?? null;
      lastOwningRootIdRef.current = warmHit.data.rootId;
    } else {
      setData(null);
      dataRef.current = null;
      setStatus(
        isEnabled ? (isOwnerConnected ? "waiting" : "unavailable") : "off",
      );
      lastHeadCommitRef.current = null;
      lastOwningRootIdRef.current = null;
    }
    setError(null);
    setErrorCode(null);
    setIsBusy(false);
    setUnavailableReason(null);
    localEpochRef.current++;
    clearTimeout(debounceTimerRef.current ?? undefined);
    debounceTimerRef.current = null;
    clearTimeout(refreshDebounceTimerRef.current ?? undefined);
    refreshDebounceTimerRef.current = null;
    activeControllerRef.current?.abort();
  }

  // Synchronously adopt warm hit if not ready and warm hit is available
  // (e.g. user toggled blame on, visibility returned, or undid back to cached content)
  if (
    (status === "waiting" || status === "off") &&
    isEnabled &&
    isOwnerConnected &&
    warmHit?.hit &&
    warmHit.data
  ) {
    setStatus("ready");
    setData(warmHit.data);
    dataRef.current = warmHit.data;
    lastHeadCommitRef.current = warmHit.data.baseCommitOid ?? null;
    lastOwningRootIdRef.current = warmHit.data.rootId;
    setError(null);
    setErrorCode(null);
    setIsBusy(false);
    setUnavailableReason(null);
  }

  // Core blame request runner
  const runBlame = useCallback(
    async (options?: { bypassCache?: boolean }) => {
      if (!isEnabledRef.current || !isOwnerConnectedRef.current) return;

      const currentTab = tabRef.current;
      const currentEditor = editorRef.current;
      const currentSnapshot = snapshotRef.current;
      if (
        !currentTab ||
        !currentEditor ||
        !currentSnapshot ||
        currentSnapshot.status !== "connected"
      ) {
        return;
      }

      const currentModel = currentEditor.getModel?.();
      if (!currentModel) return;

      const content = currentModel.getValue();
      if (isBufferOverLimit(content)) {
        setStatus("unavailable");
        setUnavailableReason("Buffer exceeds 5 MiB size limit for Git blame");
        setErrorCode("GIT_BLAME_TOO_LARGE");
        setData(null);
        dataRef.current = null;
        return;
      }

      const owner: ConnectionRef = {
        profileId: currentSnapshot.owner.profileId,
        generation: currentSnapshot.owner.generation,
      };
      const currentTabKey = currentTab.key;
      const currentModelId =
        currentModel.id ??
        (typeof currentModel.uri?.toString === "function"
          ? currentModel.uri.toString()
          : "model");
      const currentVer = currentModel.getVersionId();
      const currentLocalEpoch = localEpochRef.current;
      const bufferLineCount = computeMonacoLineCount(content);
      const contentSha256 = getModelBufferSha256(currentModel, content);
      const snapshotId = `${currentLocalEpoch}-${generateUUID().substring(0, 8)}`;

      // Check client query cache if not bypassing
      if (!options?.bypassCache && queryClient) {
        const hit = getCompletedBlameHit(
          queryClient,
          owner,
          currentTab.target,
          currentTab.path,
          contentSha256,
          bufferLineCount,
          currentVer,
          snapshotId,
        );
        if (hit.hit && hit.data) {
          setStatus("ready");
          setData(hit.data);
          dataRef.current = hit.data;
          lastHeadCommitRef.current = hit.data.baseCommitOid ?? null;
          lastOwningRootIdRef.current = hit.data.rootId;
          setError(null);
          setErrorCode(null);
          setIsBusy(false);
          setUnavailableReason(null);
          if (hit.queryKey) {
            touchCompletedBlameHit(queryClient, hit.queryKey);
          }
          return;
        }
      }

      if (inFlightRef.current) {
        pendingIntentRef.current = true;
        if (options?.bypassCache) {
          bypassCacheNextRef.current = true;
        }
        activeControllerRef.current?.abort();
        return;
      }

      // Begin request lease in QueryClient
      const lease = queryClient
        ? beginRequestLease(
            queryClient,
            owner,
            currentTab.target,
            currentTab.path,
          )
        : null;
      const capturedTargetEpoch = lease?.capturedEpoch ?? 1;

      inFlightRef.current = true;
      setStatus("loading");
      setError(null);
      setErrorCode(null);
      setIsBusy(false);
      setUnavailableReason(null);

      const controller = new AbortController();
      activeControllerRef.current = controller;

      try {
        const client = getBoundApiClient(owner);
        const resp = await client.git.blame(
          currentTab.target,
          {
            path: currentTab.path,
            content,
            snapshotId,
            modelVersion: currentVer,
          },
          { signal: controller.signal, timeoutMs: 30000 },
        );

        if (controller.signal.aborted) return;

        // Post-await identity and lifecycle verification
        if (!isMountedRef.current) return;
        if (!isCurrentConnection(owner)) return;
        if (tabRef.current?.key !== currentTabKey) return;
        if (!isEnabledRef.current) return;

        const freshModel = editorRef.current?.getModel?.();
        if (!freshModel) return;
        const freshModelId =
          freshModel.id ??
          (typeof freshModel.uri?.toString === "function"
            ? freshModel.uri.toString()
            : "model");
        if (freshModelId !== currentModelId) return;
        if (freshModel.getVersionId() !== currentVer) return;
        if (localEpochRef.current !== currentLocalEpoch) return;

        // Check request lease validity; if invalidated mid-flight on matching model/epoch, reset status and reschedule
        if (lease && queryClient && !isLeaseValid(queryClient, lease)) {
          setStatus("waiting");
          pendingIntentRef.current = true;
          return;
        }

        // Validate response structure and range partition
        const validation = validateBlameResponse(resp, {
          expectedSnapshotId: snapshotId,
          expectedModelVersion: currentVer,
          expectedBufferLineCount: bufferLineCount,
        });

        if (!validation.valid) {
          setStatus("error");
          setError(`Malformed blame response: ${validation.reason}`);
          setErrorCode("GIT_BLAME_INVALID_RESPONSE");
          setData(null);
          dataRef.current = null;
          return;
        }

        setStatus("ready");
        setData(validation.response);
        dataRef.current = validation.response;
        lastHeadCommitRef.current = validation.response.baseCommitOid ?? null;
        if (validation.response.rootId) {
          lastOwningRootIdRef.current = validation.response.rootId;
        }
        setError(null);
        setErrorCode(null);
        setIsBusy(false);
        setUnavailableReason(null);

        // Commit to client query cache
        if (lease && queryClient) {
          setCompletedBlamePayload(
            queryClient,
            owner,
            currentTab.target,
            currentTab.path,
            contentSha256,
            validation.response,
            capturedTargetEpoch,
            lease,
          );
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        if (!isMountedRef.current) return;
        if (!isEnabledRef.current) return;
        if (!isCurrentConnection(owner)) return;
        if (tabRef.current?.key !== currentTabKey) return;
        if (localEpochRef.current !== currentLocalEpoch) return;

        if (isGitBlameBusyError(err)) {
          setStatus("unavailable");
          setIsBusy(true);
          setErrorCode("GIT_BLAME_BUSY");
          setUnavailableReason(
            "Git blame workers are busy; refresh or edit to retry",
          );
          setData(null);
          dataRef.current = null;
        } else if (isGitBlameTooLargeError(err)) {
          setStatus("unavailable");
          setIsBusy(false);
          setErrorCode("GIT_BLAME_TOO_LARGE");
          setUnavailableReason("Buffer exceeds 5 MiB size limit for Git blame");
          setData(null);
          dataRef.current = null;
        } else if (isGitBlameStaleError(err)) {
          setStatus("waiting");
          setIsBusy(false);
          setErrorCode("GIT_BLAME_STALE_REVISION");
          setData(null);
          dataRef.current = null;
        } else {
          setStatus("error");
          setIsBusy(false);
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          setErrorCode(extractErrorCode(err));
          setData(null);
          dataRef.current = null;
        }
      } finally {
        if (lease && queryClient) {
          endRequestLease(queryClient, lease);
        }
        inFlightRef.current = false;
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }

        if (pendingIntentRef.current) {
          pendingIntentRef.current = false;
          if (
            isMountedRef.current &&
            isEnabledRef.current &&
            isOwnerConnectedRef.current
          ) {
            clearTimeout(debounceTimerRef.current ?? undefined);
            const bypassNext = bypassCacheNextRef.current;
            bypassCacheNextRef.current = false;
            debounceTimerRef.current = setTimeout(() => {
              debounceTimerRef.current = null;
              void runBlame({ bypassCache: bypassNext });
            }, GIT_BLAME_DEBOUNCE_MS);
          }
        }
      }
    },
    [queryClient],
  );

  // External repository refresh coordinator with intent coalescing
  const triggerRepositoryRefresh = useCallback(
    (options?: boolean | RepositoryRefreshOptions) => {
      if (
        !isMountedRef.current ||
        !isEnabledRef.current ||
        !isOwnerConnectedRef.current
      ) {
        return;
      }

      const opts: RepositoryRefreshOptions =
        typeof options === "boolean" ? { force: options } : (options ?? {});
      if (opts.force) {
        pendingRefreshOptionsRef.current.force = true;
        bypassCacheNextRef.current = true;
      }
      if (opts.reblameOnSameHead) {
        pendingRefreshOptionsRef.current.reblameOnSameHead = true;
      }

      clearTimeout(refreshDebounceTimerRef.current ?? undefined);

      refreshDebounceTimerRef.current = setTimeout(async () => {
        refreshDebounceTimerRef.current = null;
        if (
          !isMountedRef.current ||
          !isEnabledRef.current ||
          !isOwnerConnectedRef.current
        ) {
          return;
        }

        const currentTab = tabRef.current;
        if (!currentTab) return;
        const currentTabKey = currentTab.key;
        const currentPath = currentTab.path ?? "";
        const owner = snapshotRef.current?.owner;
        if (!owner || !isCurrentConnection(owner)) return;

        // If an edit debounce is active, preserve all pending options;
        // when edit debounce fires, it will consume them.
        if (debounceTimerRef.current !== null) {
          return;
        }

        const effectiveOptions = { ...pendingRefreshOptionsRef.current };
        pendingRefreshOptionsRef.current = {
          force: false,
          reblameOnSameHead: false,
        };
        const force = effectiveOptions.force ?? false;
        const reblameOnSameHead = effectiveOptions.reblameOnSameHead ?? false;

        if (!queryClient) {
          const bypass = force || bypassCacheNextRef.current;
          bypassCacheNextRef.current = false;
          void runBlame({ bypassCache: bypass });
          return;
        }
        const discoveryHandle = beginRootDiscovery(
          queryClient,
          owner,
          currentTab.target,
        );

        try {
          const roots = await queryClient.fetchQuery({
            queryKey: gitQueryKey("git-roots", currentTab.target),
            queryFn: () =>
              getBoundApiClient(owner).git.roots(currentTab.target),
            staleTime: 0,
          });

          // Post-await liveness, identity, owner guards
          if (
            !isMountedRef.current ||
            !isEnabledRef.current ||
            !isOwnerConnectedRef.current ||
            !isCurrentConnection(owner) ||
            tabRef.current?.key !== currentTabKey
          ) {
            cancelRootDiscovery(queryClient, discoveryHandle);
            return;
          }

          const owningRoot = findOwningVcsRoot(roots, currentPath);
          if (!owningRoot || owningRoot.mappingState === "missing") {
            cancelRootDiscovery(queryClient, discoveryHandle);
            setStatus("unavailable");
            setUnavailableReason("Owning VCS root unavailable");
            setData(null);
            dataRef.current = null;
            return;
          }

          const headOid: string | null = owningRoot.status?.lastCommit?.hash ?? null;
          const rootId = owningRoot.rootId;

          const discResult = completeRootDiscovery(
            queryClient,
            discoveryHandle,
            rootId,
            headOid,
          );

          if (discResult.isStale) {
            return;
          }

          const headChanged = discResult.headChanged;
          const rootChanged = discResult.rootChanged;
          const isSameHead = !headChanged && !rootChanged;

          lastHeadCommitRef.current = headOid;
          lastOwningRootIdRef.current = rootId;

          // Focus / visibility coalesce: if work is already in flight and HEAD is unchanged,
          // don't abort or trigger redundant duplicate work.
          if (
            inFlightRef.current &&
            isSameHead &&
            !force &&
            !reblameOnSameHead
          ) {
            return;
          }

          const shouldReblame =
            force ||
            headChanged ||
            rootChanged ||
            !dataRef.current ||
            (reblameOnSameHead && isSameHead);

          if (shouldReblame) {
            if (headChanged || rootChanged) {
              advanceTargetEpoch(queryClient, owner, currentTab.target);
              setData(null);
              dataRef.current = null;
              setStatus("waiting");
            }
            const bypass =
              force || reblameOnSameHead || bypassCacheNextRef.current;
            bypassCacheNextRef.current = false;
            void runBlame({ bypassCache: bypass });
          }
        } catch {
          cancelRootDiscovery(queryClient, discoveryHandle);
          if (
            !isMountedRef.current ||
            !isEnabledRef.current ||
            !isOwnerConnectedRef.current ||
            !isCurrentConnection(owner) ||
            tabRef.current?.key !== currentTabKey
          ) {
            return;
          }

          if (force) {
            // Manual refresh escape hatch even if root discovery failed
            bypassCacheNextRef.current = false;
            void runBlame({ bypassCache: true });
          } else {
            setStatus("unavailable");
            setUnavailableReason("Failed to discover Git roots");
            setData(null);
            dataRef.current = null;
          }
        }
      }, 50);
    },
    [queryClient, runBlame],
  );

  // Manual refresh action exposed to consumers
  const refresh = useCallback(() => {
    if (queryClient && snapshotRef.current?.owner && tabRef.current) {
      advanceTargetEpoch(
        queryClient,
        snapshotRef.current.owner,
        tabRef.current.target,
      );
    }
    triggerRepositoryRefresh({ force: true });
  }, [queryClient, triggerRepositoryRefresh]);

  // Mount / unmount lifecycle and cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimeout(debounceTimerRef.current ?? undefined);
      debounceTimerRef.current = null;
      clearTimeout(refreshDebounceTimerRef.current ?? undefined);
      refreshDebounceTimerRef.current = null;
      activeControllerRef.current?.abort();
    };
  }, []);

  // Handle enabled / disabled / connection transitions
  useEffect(() => {
    isMountedRef.current = true;
    if (!isEnabled) {
      setStatus("off");
      setData(null);
      dataRef.current = null;
      setError(null);
      setErrorCode(null);
      setIsBusy(false);
      setUnavailableReason(null);
      clearTimeout(debounceTimerRef.current ?? undefined);
      debounceTimerRef.current = null;
      clearTimeout(refreshDebounceTimerRef.current ?? undefined);
      refreshDebounceTimerRef.current = null;
      activeControllerRef.current?.abort();
      return;
    }

    if (!isOwnerConnected) {
      setStatus("unavailable");
      setData(null);
      dataRef.current = null;
      setError(null);
      setErrorCode(null);
      setIsBusy(false);
      setUnavailableReason(
        snapshot
          ? "Connection not connected or binding mismatch"
          : "No active connection",
      );
      clearTimeout(debounceTimerRef.current ?? undefined);
      debounceTimerRef.current = null;
      clearTimeout(refreshDebounceTimerRef.current ?? undefined);
      refreshDebounceTimerRef.current = null;
      activeControllerRef.current?.abort();
      return;
    }

    // If warm hit is already ready and matches the current model, do NOT overwrite with waiting
    const activeModel = editorRef.current?.getModel?.();
    if (
      statusRef.current === "ready" &&
      dataRef.current !== null &&
      activeModel
    ) {
      return;
    }

    // Enabled and connected: start in waiting state, clear attribution, and trigger initial request
    setStatus("waiting");
    setData(null);
    dataRef.current = null;
    setError(null);
    setErrorCode(null);
    setIsBusy(false);
    setUnavailableReason(null);
    clearTimeout(debounceTimerRef.current ?? undefined);
    debounceTimerRef.current = null;
    clearTimeout(refreshDebounceTimerRef.current ?? undefined);
    refreshDebounceTimerRef.current = null;
    activeControllerRef.current?.abort();
    localEpochRef.current++;
    lastHeadCommitRef.current = null;
    lastOwningRootIdRef.current = null;

    void runBlame();
  }, [
    isEnabled,
    isOwnerConnected,
    currentIdentityKey,
    runBlame,
  ]);

  // Model content and model change subscriptions
  useEffect(() => {
    if (!isEnabled || !isOwnerConnected || !editor) return;

    let modelDisposable: { dispose: () => void } | undefined;

    const attachModelListeners = () => {
      modelDisposable?.dispose();
      const currentModel = editor.getModel?.();
      if (!currentModel || typeof currentModel.onDidChangeContent !== "function")
        return;

      modelDisposable = currentModel.onDidChangeContent(() => {
        // Immediate synchronous invalidation of visible attribution
        setData(null);
        dataRef.current = null;
        setStatus("waiting");
        setError(null);
        setErrorCode(null);
        setIsBusy(false);
        setUnavailableReason(null);

        // Advances local edit epoch strictly (does NOT advance shared target epoch,
        // allowing undo back to cached identical content to hit cache immediately)
        localEpochRef.current++;

        clearTimeout(debounceTimerRef.current ?? undefined);

        if (inFlightRef.current) {
          pendingIntentRef.current = true;
          activeControllerRef.current?.abort();
        }

        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null;
          const effectiveOpts = { ...pendingRefreshOptionsRef.current };
          pendingRefreshOptionsRef.current = {
            force: false,
            reblameOnSameHead: false,
          };
          const bypassNext = effectiveOpts.force || bypassCacheNextRef.current;
          bypassCacheNextRef.current = false;
          void runBlame({ bypassCache: bypassNext });
        }, GIT_BLAME_DEBOUNCE_MS);
      });
    };

    attachModelListeners();
    if (dataRef.current === null && !inFlightRef.current) {
      void runBlame();
    }
    let editorModelDisposable: { dispose: () => void } | undefined;
    if (typeof editor.onDidChangeModel === "function") {
      editorModelDisposable = editor.onDidChangeModel(() => {
        clearTimeout(debounceTimerRef.current ?? undefined);
        debounceTimerRef.current = null;
        activeControllerRef.current?.abort();
        setData(null);
        dataRef.current = null;
        setStatus("waiting");
        localEpochRef.current++;
        attachModelListeners();
        void runBlame();
      });
    }

    return () => {
      modelDisposable?.dispose();
      editorModelDisposable?.dispose();
    };
  }, [editor, isEnabled, isOwnerConnected, runBlame]);

  // External event listeners (focus, visibility, IPC, QueryCache)
  useEffect(() => {
    if (!isEnabled || !isOwnerConnected) return;

    const onWindowFocus = () => {
      triggerRepositoryRefresh({ force: false, reblameOnSameHead: false });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerRepositoryRefresh({ force: false, reblameOnSameHead: false });
      }
    };

    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Profile-bound IPC subscriptions
    const unsubStatus = subscribeIpc(profileId, "status:changed", (e) => {
      if (
        e.generation !== undefined &&
        snapshotRef.current?.owner.generation !== undefined
      ) {
        if (e.generation !== snapshotRef.current.owner.generation) return;
      }
      const currentProject = tabRef.current?.target.project;
      const projectName = extractProjectName(e.data);
      if (!projectName || projectName === currentProject) {
        triggerRepositoryRefresh({ reblameOnSameHead: true });
      }
    });

    const unsubWorkspace = subscribeIpc(profileId, "workspace:changed", (e) => {
      if (
        e.generation !== undefined &&
        snapshotRef.current?.owner.generation !== undefined
      ) {
        if (e.generation !== snapshotRef.current.owner.generation) return;
      }
      if (queryClient && snapshotRef.current?.owner && tabRef.current) {
        advanceTargetEpoch(
          queryClient,
          snapshotRef.current.owner,
          tabRef.current.target,
        );
      }
      setData(null);
      dataRef.current = null;
      setStatus("waiting");
      triggerRepositoryRefresh({ reblameOnSameHead: false });
    });

    // QueryCache subscription for Git mutation invalidations
    const unsubQueryCache = queryClient
      ? queryClient.getQueryCache().subscribe((event) => {
          const isInvalidated =
            event.type === "updated" && event.action.type === "invalidate";

          if (isInvalidated) {
            const key = event.query.queryKey;
            const currentTab = tabRef.current;
            if (!currentTab) return;

            const match = isMatchingGitQueryKey(
              key,
              currentTab.target,
              snapshotRef.current?.owner,
              lastOwningRootIdRef.current,
            );
            if (match.matches) {
              if (queryClient && snapshotRef.current?.owner) {
                advanceTargetEpoch(
                  queryClient,
                  snapshotRef.current.owner,
                  currentTab.target,
                );
              }
              setData(null);
              dataRef.current = null;
              setStatus("waiting");
              triggerRepositoryRefresh({
                reblameOnSameHead: match.isDiffMutation,
              });
            }
          }
        })
      : () => {};
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubStatus();
      unsubWorkspace();
      unsubQueryCache();
      clearTimeout(refreshDebounceTimerRef.current ?? undefined);
      refreshDebounceTimerRef.current = null;
    };
  }, [
    isEnabled,
    isOwnerConnected,
    profileId,
    queryClient,
    triggerRepositoryRefresh,
  ]);

  return {
    status,
    data,
    error,
    errorCode,
    isBusy,
    unavailableReason,
    refresh,
  };
}
