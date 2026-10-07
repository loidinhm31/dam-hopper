// Hook for Project Plans Dashboard: queries, navigation watch set lifecycle, and coverage — Phase 03
// Aligned with contracts.md section 7 and phase-03-owner-bound-client-and-refresh.md

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Transport } from "../api/transport.js";
import type { ApiClient } from "../api/client.js";
import {
  type ConnectionRef,
  normalizeProjectTargetRef,
} from "../api/ownership.js";
import {
  type ProjectTargetInput,
  normalizeProjectTarget,
  projectTargetCacheKey,
} from "../api/client.js";
import {
  getTransport as getBoundTransport,
  getApi,
  isCurrentConnection,
} from "../api/connections.js";
import {
  type PlanFoldersResponse,
  type SelectedPlanResponse,
  type PlanCoverageState,
  type PlanCoverageStatus,
} from "../api/project-plans-types.js";
import {
  planFoldersQueryKey,
  selectedPlanQueryKey,
  planDocumentQueryKey,
  usePlanFoldersQuery,
  useSelectedPlanQuery,
  usePlanDocumentQuery,
  normalizePlansBrowsePath,
  normalizePlanPath,
  normalizePlanDocumentPath,
} from "../api/project-plans-queries.js";

const MAX_ACTIVE_WATCH_PATHS = 33;
const MAX_CONCURRENT_REGISTRATIONS = 8;
const MAX_CHURN_RECONCILE_PASSES = 3;
const CHURN_COALESCE_MS = 50;

export interface UseProjectPlansOptions {
  /** Captured connection owner (profileId, generation). Required to enable queries/watchers. */
  owner?: ConnectionRef | null;
  /** Configured project target (project name and optional worktreePath). */
  target?: ProjectTargetInput | null;
  /** Current browse directory within plans (e.g. "plans" or "plans/subgroup"). Defaults to "plans". */
  browsePath?: string | null;
  /** Selected plan path if a plan is open (e.g. "plans/my-plan"). Null in folder browsing mode. */
  selectedPlanPath?: string | null;
  /** Selected document path if viewing a document (e.g. "plans/my-plan/plan.md"). */
  selectedDocumentPath?: string | null;
  /** Whether the dashboard is expanded/visible. Reads and watchers disabled when false. */
  enabled?: boolean;
  /** Optional custom client for testing or custom bindings */
  client?: ApiClient;
  /** Optional custom transport for testing */
  transport?: Transport;
}

export interface UseProjectPlansResult {
  foldersData?: PlanFoldersResponse;
  isFoldersLoading: boolean;
  foldersError: Error | null;

  selectedPlanData?: SelectedPlanResponse;
  isSelectedPlanLoading: boolean;
  selectedPlanError: Error | null;

  documentContent?: string;
  isDocumentLoading: boolean;
  documentError: Error | null;

  coverage: PlanCoverageState;

  refresh: () => Promise<void>;
  invalidate: () => Promise<void>;
}

interface FsWatchSubscriptionSeam {
  fsSubscribeTree?: (
    target: unknown,
    path: string,
    opts?: { watchOnly?: boolean },
  ) => Promise<number | { sub_id: number }>;
  fsUnsubscribeTree?: (sub_id: number) => void | Promise<unknown>;
  onFsEvent?: (sub_id: number, cb: (ev: unknown) => void) => () => void;
  onFsOverflow?: (sub_id: number, cb: (msg: string) => void) => () => void;
}

export function useProjectPlans(
  options: UseProjectPlansOptions,
): UseProjectPlansResult {
  const {
    owner,
    target,
    browsePath,
    selectedPlanPath,
    selectedDocumentPath,
    enabled = true,
    client: customClient,
    transport: customTransport,
  } = options;

  const qc = useQueryClient();

  // Normalize target ref for stable identification
  const normalizedTarget = useMemo(() => {
    if (!target) return null;
    const norm = normalizeProjectTarget(target);
    return normalizeProjectTargetRef({
      project: norm.project,
      worktreePath: norm.worktreePath,
      profileId: norm.profileId,
    });
  }, [target]);

  const targetCacheKey = useMemo(() => {
    return normalizedTarget ? projectTargetCacheKey(normalizedTarget) : "";
  }, [normalizedTarget]);

  const isEnabled = Boolean(
    enabled && owner && normalizedTarget && isCurrentConnection(owner),
  );

  const normalizedBrowse = useMemo(
    () => normalizePlansBrowsePath(browsePath),
    [browsePath],
  );
  const normalizedPlan = useMemo(
    () => (selectedPlanPath ? normalizePlanPath(selectedPlanPath) : null),
    [selectedPlanPath],
  );
  const normalizedDoc = useMemo(
    () =>
      selectedDocumentPath
        ? normalizePlanDocumentPath(selectedDocumentPath)
        : null,
    [selectedDocumentPath],
  );

  // ── Queries ───────────────────────────────────────────────────────────────

  const foldersQuery = usePlanFoldersQuery(
    owner,
    normalizedTarget,
    normalizedBrowse,
    {
      enabled: isEnabled && !normalizedPlan,
      client: customClient,
    },
  );

  const selectedPlanQuery = useSelectedPlanQuery(
    owner,
    normalizedTarget,
    normalizedPlan,
    {
      enabled: isEnabled && Boolean(normalizedPlan),
      client: customClient,
    },
  );

  const documentQuery = usePlanDocumentQuery(
    owner,
    normalizedTarget,
    normalizedDoc,
    {
      enabled: isEnabled && Boolean(normalizedDoc),
      client: customClient,
    },
  );

  // ── Coverage State ────────────────────────────────────────────────────────

  const [coverage, setCoverage] = useState<PlanCoverageState>(() => ({
    status: isEnabled ? "reconciling" : "unsupported",
    reason: isEnabled ? null : "Target or connection not ready",
  }));

  // Churn pass counter and timer refs
  const churnPassesRef = useRef(0);
  const churnTimerRef = useRef<number | null>(null);

  // ── Watch Paths Computation ───────────────────────────────────────────────

  const desiredWatchPaths = useMemo(() => {
    if (!isEnabled || !normalizedTarget) return [];
    const paths = new Set<string>();
    paths.add(".");

    if (normalizedPlan && selectedPlanQuery.data?.watchPaths) {
      for (const p of selectedPlanQuery.data.watchPaths) {
        paths.add(p);
      }
    } else if (foldersQuery.data?.watchPaths) {
      for (const p of foldersQuery.data.watchPaths) {
        paths.add(p);
      }
    } else {
      // Fallback before server response lands: watch requested ancestors
      const requested = normalizedPlan ?? normalizedBrowse;
      const parts = requested.split("/").filter(Boolean);
      let cur = "";
      for (const part of parts) {
        cur = cur ? `${cur}/${part}` : part;
        paths.add(cur);
      }
    }

    // Add document parent if outside current set
    if (normalizedDoc) {
      const slashIdx = normalizedDoc.lastIndexOf("/");
      const docParent = slashIdx > 0 ? normalizedDoc.substring(0, slashIdx) : ".";
      paths.add(docParent);
    }

    return Array.from(paths).slice(0, MAX_ACTIVE_WATCH_PATHS);
  }, [
    isEnabled,
    normalizedTarget,
    normalizedPlan,
    normalizedBrowse,
    normalizedDoc,
    selectedPlanQuery.data,
    foldersQuery.data,
  ]);

  // ── Watch Set Lifecycle & Reconciliation ──────────────────────────────────

  useEffect(() => {
    if (!isEnabled || !owner || !normalizedTarget) {
      setCoverage({
        status: "unsupported",
        reason: isEnabled ? null : "Dashboard disabled or connection inactive",
      });
      return;
    }

    let isDisposed = false;
    let originatingTransport: Transport;
    try {
      originatingTransport = customTransport ?? getBoundTransport(owner);
    } catch (e) {
      setCoverage({
        status: "degraded",
        reason: e instanceof Error ? e.message : "Failed to obtain transport",
      });
      return;
    }

    const seam = originatingTransport as unknown as FsWatchSubscriptionSeam;
    if (typeof seam.fsSubscribeTree !== "function") {
      setCoverage({
        status: "degraded",
        reason: "Transport does not support watchOnly tree subscriptions",
      });
      return;
    }

    setCoverage((prev) =>
      prev.status === "live" ? prev : { status: "reconciling", reason: null },
    );

    // Track active subscriptions for this effect lifetime on originating transport
    const activeSubs = new Map<
      string,
      { subId: number; cleanupEvent: () => void; cleanupOverflow: () => void }
    >();

    const invalidateActiveQueries = () => {
      if (isDisposed) return;
      if (normalizedPlan) {
        void qc.invalidateQueries({
          queryKey: selectedPlanQueryKey(owner, normalizedTarget, normalizedPlan),
        });
        if (normalizedDoc) {
          void qc.invalidateQueries({
            queryKey: planDocumentQueryKey(owner, normalizedTarget, normalizedDoc),
          });
        }
      } else {
        void qc.invalidateQueries({
          queryKey: planFoldersQueryKey(owner, normalizedTarget, normalizedBrowse),
        });
      }
    };

    const scheduleCoalescedInvalidation = () => {
      if (isDisposed) return;
      if (churnPassesRef.current >= MAX_CHURN_RECONCILE_PASSES) {
        setCoverage({
          status: "degraded",
          reason: "Excessive filesystem churn; paused automatic reconciliation",
        });
        return;
      }

      clearTimeout(churnTimerRef.current ?? undefined);
      churnTimerRef.current = window.setTimeout(() => {
        churnTimerRef.current = null;
        if (isDisposed) return;
        churnPassesRef.current += 1;
        invalidateActiveQueries();
      }, CHURN_COALESCE_MS);
    };

    const handleOverflow = (overflowSubId: number, msg: string) => {
      if (isDisposed) return;
      // Dispose affected handle
      for (const [watchedPath, sub] of activeSubs.entries()) {
        if (sub.subId === overflowSubId) {
          sub.cleanupEvent();
          sub.cleanupOverflow();
          seam.fsUnsubscribeTree?.(overflowSubId);
          activeSubs.delete(watchedPath);
          break;
        }
      }

      setCoverage({
        status: "reconciling",
        reason: `Filesystem event buffer overflow: ${msg}`,
      });
      invalidateActiveQueries();
      void reconcileWatches();
    };

    const registerWatch = async (path: string): Promise<boolean> => {
      if (isDisposed || activeSubs.has(path)) return true;
      try {
        const subResult = await seam.fsSubscribeTree!(
          normalizedTarget,
          path,
          { watchOnly: true },
        );
        const subId =
          typeof subResult === "number" ? subResult : subResult.sub_id;

        if (isDisposed) {
          // Late completion: unsubscribe immediately on originating transport
          seam.fsUnsubscribeTree?.(subId);
          return false;
        }

        const cleanupEvent =
          typeof seam.onFsEvent === "function"
            ? seam.onFsEvent(subId, () => {
                scheduleCoalescedInvalidation();
              })
            : () => {};

        const cleanupOverflow =
          typeof seam.onFsOverflow === "function"
            ? seam.onFsOverflow(subId, (msg) => {
                handleOverflow(subId, msg);
              })
            : () => {};

        activeSubs.set(path, { subId, cleanupEvent, cleanupOverflow });
        return true;
      } catch (err) {
        if (!isDisposed) {
          setCoverage({
            status: "degraded",
            reason: `Watch failed for ${path}: ${err instanceof Error ? err.message : String(err)}`,
            failedWatchPaths: [path],
          });
        }
        return false;
      }
    };

    const reconcileWatches = async () => {
      if (isDisposed) return;
      const targetPaths = desiredWatchPaths;
      const toAdd = targetPaths.filter((p) => !activeSubs.has(p));
      const toRemove = Array.from(activeSubs.keys()).filter(
        (p) => !targetPaths.includes(p),
      );

      // Add new watches before removing obsolete ones (bounded queue)
      let allAdditionsOk = true;
      for (let i = 0; i < toAdd.length; i += MAX_CONCURRENT_REGISTRATIONS) {
        if (isDisposed) return;
        const chunk = toAdd.slice(i, i + MAX_CONCURRENT_REGISTRATIONS);
        const results = await Promise.all(chunk.map((p) => registerWatch(p)));
        if (results.some((ok) => !ok)) {
          allAdditionsOk = false;
        }
      }

      if (isDisposed) return;

      // Remove obsolete watches
      for (const p of toRemove) {
        const sub = activeSubs.get(p);
        if (sub) {
          sub.cleanupEvent();
          sub.cleanupOverflow();
          seam.fsUnsubscribeTree?.(sub.subId);
          activeSubs.delete(p);
        }
      }

      if (!isDisposed && allAdditionsOk) {
        setCoverage({ status: "live", reason: null });
        // Authoritative refetch after additions closes registration races
        if (toAdd.length > 0) {
          invalidateActiveQueries();
        }
      }
    };

    void reconcileWatches();

    return () => {
      isDisposed = true;
      clearTimeout(churnTimerRef.current ?? undefined);
      churnTimerRef.current = null;
      // Detach listeners and unsubscribe all exact IDs on originating transport
      for (const [, sub] of activeSubs) {
        try {
          sub.cleanupEvent();
          sub.cleanupOverflow();
          seam.fsUnsubscribeTree?.(sub.subId);
        } catch {
          // Ignore synchronous cleanup errors during unmount
        }
      }
      activeSubs.clear();
    };
  }, [
    isEnabled,
    owner?.profileId,
    owner?.generation,
    targetCacheKey,
    normalizedBrowse,
    normalizedPlan,
    normalizedDoc,
    desiredWatchPaths,
    customTransport,
  ]);

  // ── Manual Actions ────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    churnPassesRef.current = 0;
    clearTimeout(churnTimerRef.current ?? undefined);
    churnTimerRef.current = null;
    if (owner && normalizedTarget) {
      setCoverage({ status: "reconciling", reason: null });
      if (normalizedPlan) {
        await qc.refetchQueries({
          queryKey: selectedPlanQueryKey(owner, normalizedTarget, normalizedPlan),
          exact: true,
        });
        if (normalizedDoc) {
          await qc.refetchQueries({
            queryKey: planDocumentQueryKey(owner, normalizedTarget, normalizedDoc),
            exact: true,
          });
        }
      } else {
        await qc.refetchQueries({
          queryKey: planFoldersQueryKey(owner, normalizedTarget, normalizedBrowse),
          exact: true,
        });
      }
      setCoverage({ status: "live", reason: null });
    }
  }, [
    owner,
    normalizedTarget,
    normalizedBrowse,
    normalizedPlan,
    normalizedDoc,
    qc,
  ]);

  const invalidate = useCallback(async () => {
    if (owner && normalizedTarget) {
      if (normalizedPlan) {
        await qc.invalidateQueries({
          queryKey: selectedPlanQueryKey(owner, normalizedTarget, normalizedPlan),
        });
      } else {
        await qc.invalidateQueries({
          queryKey: planFoldersQueryKey(owner, normalizedTarget, normalizedBrowse),
        });
      }
    }
  }, [owner, normalizedTarget, normalizedBrowse, normalizedPlan, qc]);

  return {
    foldersData: foldersQuery.data,
    isFoldersLoading: foldersQuery.isLoading,
    foldersError: foldersQuery.error,

    selectedPlanData: selectedPlanQuery.data,
    isSelectedPlanLoading: selectedPlanQuery.isLoading,
    selectedPlanError: selectedPlanQuery.error,

    documentContent: documentQuery.data,
    isDocumentLoading: documentQuery.isLoading,
    documentError: documentQuery.error,

    coverage,
    refresh,
    invalidate,
  };
}
