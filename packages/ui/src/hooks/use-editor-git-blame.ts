import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { QueryClientContext, type QueryClient } from "@tanstack/react-query";
import type { Tab } from "@/stores/editor.js";
import type { ConnectionRef } from "@/api/ownership.js";
import {
  isCurrentConnection,
  useConnectionSnapshot,
} from "@/api/connections.js";
import {
  getBoundApiClient,
  gitQueryKey,
} from "@/api/queries.js";
import {
  type GitBlameResponse,
  isGitBlameBusyError,
  isGitBlameStaleError,
  isGitBlameTooLargeError,
} from "@/api/client.js";
import { subscribeIpc } from "./use-sse.js";
import { generateUUID } from "@/lib/utils.js";
import {
  computeMonacoLineCount,
  findOwningVcsRoot,
  GIT_BLAME_DEBOUNCE_MS,
  isBufferOverLimit,
  validateBlameResponse,
} from "@/lib/editor-git-blame.js";

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
  onDidChangeContent?: (
    listener: (e: unknown) => void,
  ) => { dispose: () => void };
}

export interface BlameEditorSeam {
  getModel?: () => BlameTextModelSeam | null;
  onDidChangeModel?: (
    listener: (e: unknown) => void,
  ) => { dispose: () => void };
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

  const isEnabled = Boolean(tab?.blameEnabled && active && isBlameEligibleTab(tab));
  const profileId = tab?.target?.profileId ?? "";
  const snapshot = useConnectionSnapshot(profileId);

  const isOwnerConnected = Boolean(
    snapshot &&
      snapshot.status === "connected" &&
      (!tab?.resourceBinding?.serverUrl ||
        snapshot.serverUrl === tab.resourceBinding.serverUrl),
  );

  const [status, setStatus] = useState<EditorGitBlameStatus>(
    isEnabled ? (isOwnerConnected ? "waiting" : "unavailable") : "off",
  );
  const [data, setData] = useState<GitBlameResponse | null>(null);
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

  const localEpochRef = useRef<number>(1);
  const repositoryRefreshEpochRef = useRef<number>(1);

  const inFlightRef = useRef<boolean>(false);
  const pendingIntentRef = useRef<boolean>(false);
  const activeControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<TimerHandle>(null);
  const refreshDebounceTimerRef = useRef<TimerHandle>(null);

  const lastHeadCommitRef = useRef<string | null>(null);
  const lastOwningRootIdRef = useRef<string | null>(null);

  // Core blame request runner
  const runBlame = useCallback(async () => {
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

    const model = currentEditor.getModel?.();
    if (!model) return;

    const content = model.getValue();
    if (isBufferOverLimit(content)) {
      setStatus("unavailable");
      setUnavailableReason("Buffer exceeds 5 MiB size limit for Git blame");
      setErrorCode("GIT_BLAME_TOO_LARGE");
      setData(null);
      return;
    }

    if (inFlightRef.current) {
      pendingIntentRef.current = true;
      activeControllerRef.current?.abort();
      return;
    }

    const owner: ConnectionRef = {
      profileId: currentSnapshot.owner.profileId,
      generation: currentSnapshot.owner.generation,
    };
    const currentTabKey = currentTab.key;
    const currentModelId =
      model.id ??
      (typeof model.uri?.toString === "function" ? model.uri.toString() : "model");
    const currentModelVersion = model.getVersionId();
    const currentLocalEpoch = localEpochRef.current;
    const currentRefreshEpoch = repositoryRefreshEpochRef.current;
    const bufferLineCount = computeMonacoLineCount(content);
    const snapshotId = `${currentLocalEpoch}-${generateUUID().substring(0, 8)}`;

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
          modelVersion: currentModelVersion,
        },
        { signal: controller.signal, timeoutMs: 30000 },
      );

      if (controller.signal.aborted) return;

      // Post-await identity verification
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
      if (freshModel.getVersionId() !== currentModelVersion) return;
      if (localEpochRef.current !== currentLocalEpoch) return;
      if (repositoryRefreshEpochRef.current !== currentRefreshEpoch) return;

      // Validate response structure and range partition
      const validation = validateBlameResponse(resp, {
        expectedSnapshotId: snapshotId,
        expectedModelVersion: currentModelVersion,
        expectedBufferLineCount: bufferLineCount,
      });

      if (!validation.valid) {
        setStatus("error");
        setError(`Malformed blame response: ${validation.reason}`);
        setErrorCode("GIT_BLAME_INVALID_RESPONSE");
        setData(null);
        return;
      }

      setStatus("ready");
      setData(validation.response);
      setError(null);
      setErrorCode(null);
      setIsBusy(false);
      setUnavailableReason(null);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      if (!isEnabledRef.current) return;
      if (tabRef.current?.key !== currentTabKey) return;

      if (isGitBlameBusyError(err)) {
        setStatus("unavailable");
        setIsBusy(true);
        setErrorCode("GIT_BLAME_BUSY");
        setUnavailableReason(
          "Git blame workers are busy; refresh or edit to retry",
        );
        setData(null);
      } else if (isGitBlameTooLargeError(err)) {
        setStatus("unavailable");
        setIsBusy(false);
        setErrorCode("GIT_BLAME_TOO_LARGE");
        setUnavailableReason("Buffer exceeds 5 MiB size limit for Git blame");
        setData(null);
      } else if (isGitBlameStaleError(err)) {
        setStatus("waiting");
        setIsBusy(false);
        setErrorCode("GIT_BLAME_STALE_REVISION");
        setData(null);
      } else {
        setStatus("error");
        setIsBusy(false);
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setErrorCode(extractErrorCode(err));
        setData(null);
      }
    } finally {
      inFlightRef.current = false;
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }

      if (pendingIntentRef.current) {
        pendingIntentRef.current = false;
        clearTimeout(debounceTimerRef.current ?? undefined);
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null;
          void runBlame();
        }, GIT_BLAME_DEBOUNCE_MS);
      }
    }
  }, []);

  // External repository refresh coordinator
  const triggerRepositoryRefresh = useCallback(
    (force = false) => {
      if (!isEnabledRef.current || !isOwnerConnectedRef.current) return;

      clearTimeout(refreshDebounceTimerRef.current ?? undefined);

      refreshDebounceTimerRef.current = setTimeout(async () => {
        refreshDebounceTimerRef.current = null;
        repositoryRefreshEpochRef.current++;

        try {
          const currentTab = tabRef.current;
          if (!currentTab) return;
          const owner = snapshotRef.current?.owner;
          if (!owner || !isCurrentConnection(owner)) return;

          if (!queryClient) return;
          const roots = await queryClient.fetchQuery({
            queryKey: gitQueryKey("git-roots", currentTab.target),
            queryFn: () =>
              getBoundApiClient(owner).git.roots(currentTab.target),
            staleTime: 0,
          });

          const currentPath = currentTab.path ?? "";
          const owningRoot = findOwningVcsRoot(roots, currentPath);
          if (!owningRoot || owningRoot.mappingState === "missing") {
            setStatus("unavailable");
            setUnavailableReason("Owning VCS root unavailable");
            setData(null);
            return;
          }

          const headOid = owningRoot.status?.lastCommit?.hash ?? "";
          const rootId = owningRoot.rootId;

          const prevHead = lastHeadCommitRef.current;
          const prevRootId = lastOwningRootIdRef.current;
          lastHeadCommitRef.current = headOid;
          lastOwningRootIdRef.current = rootId;

          if (
            force ||
            headOid !== prevHead ||
            rootId !== prevRootId ||
            !dataRef.current
          ) {
            if (headOid !== prevHead || rootId !== prevRootId) {
              setData(null);
              setStatus("waiting");
            }
            void runBlame();
          }
        } catch {
          setStatus("unavailable");
          setUnavailableReason("Failed to discover Git roots");
          setData(null);
        }
      }, 50);
    },
    [queryClient, runBlame],
  );

  // Manual refresh action exposed to consumers
  const refresh = useCallback(() => {
    triggerRepositoryRefresh(true);
  }, [triggerRepositoryRefresh]);

  // Handle enabled / disabled / connection transitions
  useEffect(() => {
    if (!isEnabled) {
      setStatus("off");
      setData(null);
      setError(null);
      setErrorCode(null);
      setIsBusy(false);
      setUnavailableReason(null);
      clearTimeout(debounceTimerRef.current ?? undefined);
      debounceTimerRef.current = null;
      activeControllerRef.current?.abort();
      return;
    }

    if (!isOwnerConnected) {
      setStatus("unavailable");
      setData(null);
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
      activeControllerRef.current?.abort();
      return;
    }

    // Enabled and connected: start in waiting state and trigger initial request
    setStatus("waiting");
    setError(null);
    setErrorCode(null);
    setIsBusy(false);
    setUnavailableReason(null);
    void runBlame();
  }, [isEnabled, isOwnerConnected, snapshot, tab?.key, runBlame]);

  // Model content and model change subscriptions
  useEffect(() => {
    if (!isEnabled || !isOwnerConnected || !editor) return;

    let modelDisposable: { dispose: () => void } | undefined;

    const attachModelListeners = () => {
      modelDisposable?.dispose();
      const model = editor.getModel?.();
      if (!model || typeof model.onDidChangeContent !== "function") return;

      modelDisposable = model.onDidChangeContent(() => {
        // Immediate synchronous invalidation of attribution
        setData(null);
        setStatus("waiting");
        setError(null);
        setErrorCode(null);
        setIsBusy(false);
        setUnavailableReason(null);

        localEpochRef.current++;

        clearTimeout(debounceTimerRef.current ?? undefined);

        if (inFlightRef.current) {
          pendingIntentRef.current = true;
          activeControllerRef.current?.abort();
        }

        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null;
          void runBlame();
        }, GIT_BLAME_DEBOUNCE_MS);
      });
    };

    attachModelListeners();

    let editorModelDisposable: { dispose: () => void } | undefined;
    if (typeof editor.onDidChangeModel === "function") {
      editorModelDisposable = editor.onDidChangeModel(() => {
        clearTimeout(debounceTimerRef.current ?? undefined);
        debounceTimerRef.current = null;
        activeControllerRef.current?.abort();
        setData(null);
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
      triggerRepositoryRefresh(true);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerRepositoryRefresh(true);
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
        triggerRepositoryRefresh(false);
      }
    });

    const unsubWorkspace = subscribeIpc(profileId, "workspace:changed", (e) => {
      if (
        e.generation !== undefined &&
        snapshotRef.current?.owner.generation !== undefined
      ) {
        if (e.generation !== snapshotRef.current.owner.generation) return;
      }
      triggerRepositoryRefresh(false);
    });

    // QueryCache subscription for Git mutation invalidations
    const unsubQueryCache = queryClient
      ? queryClient.getQueryCache().subscribe((event) => {
          if (event.type === "updated" && event.action.type === "invalidate") {
            const key = event.query.queryKey;
            if (!Array.isArray(key)) return;
            let prefix = key[0];
            if (
              key.length >= 5 &&
              key[0] === "profile" &&
              (key[3] === "git" || typeof key[3] === "string")
            ) {
              prefix = key[4] ?? key[3];
            }
            if (
              prefix === "git-diff" ||
              prefix === "git-log" ||
              prefix === "branches" ||
              prefix === "git-conflicts"
            ) {
              const currentTarget = tabRef.current?.target;
              if (currentTarget && key.includes(currentTarget.project)) {
                triggerRepositoryRefresh(false);
              }
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

  // Overall cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(debounceTimerRef.current ?? undefined);
      clearTimeout(refreshDebounceTimerRef.current ?? undefined);
      activeControllerRef.current?.abort();
    };
  }, []);

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
