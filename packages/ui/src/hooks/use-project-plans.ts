// Hook for Project Plans Dashboard: queries, navigation watch set lifecycle, and coverage — Phase 03
// Aligned with contracts.md section 7 and phase-03-owner-bound-client-and-refresh.md

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Transport } from "../api/transport.js";
import type { FsEventDto } from "../api/fs-types.js";
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
  isCurrentConnection,
} from "../api/connections.js";
import {
  type PlanFoldersResponse,
  type SelectedPlanResponse,
  type PlanCoverageState,
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
  onFsEvent?: (sub_id: number, cb: (ev: FsEventDto) => void) => () => void;
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

  const reconcileRef = useRef<(() => Promise<void>) | null>(null);

  // ── Watch Paths Computation ───────────────────────────────────────────────

  const desiredWatchPaths = useMemo(() => {
    if (!isEnabled || !normalizedTarget) return [];
    const paths = new Set<string>();
    paths.add(".");

    const addAncestors = (path: string) => {
      let current = "";
      for (const part of path.split("/").filter(Boolean)) {
        current = current ? `${current}/${part}` : part;
        paths.add(current);
      }
    };
    const serverPaths = normalizedPlan
      ? selectedPlanQuery.data?.watchPaths
      : foldersQuery.data?.watchPaths;
    if (serverPaths) {
      for (const path of serverPaths) paths.add(path);
    } else {
      // Until the snapshot arrives, cover requested ancestors. Afterwards the
      // server advertises only existing directories (e.g. "." for missing plans).
      addAncestors(normalizedPlan ?? normalizedBrowse);
    }

    // Non-recursive watches also need every document ancestor to notice replacement.
    if (normalizedDoc) {
      const slashIdx = normalizedDoc.lastIndexOf("/");
      if (slashIdx > 0) addAncestors(normalizedDoc.substring(0, slashIdx));
    }

    return Array.from(paths);
  }, [
    isEnabled,
    normalizedTarget,
    normalizedPlan,
    normalizedBrowse,
    normalizedDoc,
    selectedPlanQuery.data,
    foldersQuery.data,
  ]);

  // Key the lifetime by paths, not DTO identity: data-only updates keep handles.
  const desiredWatchPathsKey = JSON.stringify(desiredWatchPaths);

  const invalidate = useCallback(async () => {
    if (
      !isEnabled ||
      !owner ||
      !normalizedTarget ||
      !isCurrentConnection(owner)
    )
      return;
    const queryKeys = [
      normalizedPlan
        ? selectedPlanQueryKey(owner, normalizedTarget, normalizedPlan)
        : planFoldersQueryKey(owner, normalizedTarget, normalizedBrowse),
    ];
    if (normalizedDoc) {
      queryKeys.push(
        planDocumentQueryKey(owner, normalizedTarget, normalizedDoc),
      );
    }
    await Promise.all(
      queryKeys.map((queryKey) =>
        qc.invalidateQueries({ queryKey, exact: true }),
      ),
    );
  }, [
    isEnabled,
    owner,
    normalizedTarget,
    normalizedBrowse,
    normalizedPlan,
    normalizedDoc,
    qc,
  ]);

  // ── Watch Set Lifecycle & Reconciliation ──────────────────────────────────

  useEffect(() => {
    if (!isEnabled || !owner || !normalizedTarget) {
      setCoverage({
        status: "unsupported",
        reason: "Dashboard disabled or connection inactive",
      });
      return;
    }

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
    if (
      typeof seam.fsSubscribeTree !== "function" ||
      typeof seam.fsUnsubscribeTree !== "function" ||
      typeof seam.onFsEvent !== "function"
    ) {
      setCoverage({
        status: "degraded",
        reason: "Transport does not support watchOnly tree subscriptions",
      });
      return;
    }

    let isDisposed = false;
    const isCurrent = () => !isDisposed && isCurrentConnection(owner);
    const requiredPaths: string[] = JSON.parse(desiredWatchPathsKey);
    // Keep the complete requirement; exceeding the cap is explicitly incomplete.
    const targetPaths = requiredPaths.filter(
      (_, index) => index < MAX_ACTIVE_WATCH_PATHS,
    );
    const activeSubs = new Map<
      string,
      { subId: number; cleanupEvent: () => void; cleanupOverflow: () => void }
    >();
    const pendingSubs = new Map<string, Promise<boolean>>();
    const stalePaths = new Set<string>();
    let timer: number | null = null;
    let reconciliation: Promise<void> | null = null;
    let requested = false;
    let eventVersion = 0;
    let churnPasses = 0;
    let paused = false;

    const unsubscribe = (subId: number) => {
      try {
        void Promise.resolve(seam.fsUnsubscribeTree!(subId)).catch(() => {});
      } catch {
        // Cleanup remains on the creating transport, even after owner retirement.
      }
    };
    const retire = (path: string) => {
      const sub = activeSubs.get(path);
      if (!sub) return;
      activeSubs.delete(path);
      try {
        sub.cleanupEvent();
      } catch {
        /* Continue cleaning the other resources. */
      }
      try {
        sub.cleanupOverflow();
      } catch {
        /* Continue cleaning the remote handle. */
      }
      unsubscribe(sub.subId);
    };

    const publishCoverage = () => {
      if (!isCurrent() || paused) return;
      const missing = requiredPaths.filter(
        (path) => !activeSubs.has(path) || stalePaths.has(path),
      );
      setCoverage(
        missing.length > 0
          ? {
              status: "degraded",
              reason:
                requiredPaths.length > MAX_ACTIVE_WATCH_PATHS
                  ? `Incomplete watch coverage: ${requiredPaths.length} required paths exceed limit ${MAX_ACTIVE_WATCH_PATHS}`
                  : "Incomplete watch coverage; refresh to retry missing registrations",
              failedWatchPaths: missing,
            }
          : { status: "live", reason: null },
      );
    };

    const schedule = () => {
      if (!isCurrent() || paused) return;
      clearTimeout(timer ?? undefined);
      timer = window.setTimeout(() => {
        timer = null;
        void requestReconciliation();
      }, CHURN_COALESCE_MS);
    };

    const handleEvent = (watchedPath: string, event: FsEventDto) => {
      if (!isCurrent()) return;
      eventVersion += 1;
      if (["created", "removed", "renamed"].includes(event.kind)) {
        const relativePaths = [
          event.targetRelativePath,
          event.targetRelativeFrom,
        ].filter((path): path is string => path !== undefined);
        // The server captures the validated target root. Absolute event paths
        // cannot distinguish root-self from a child, so never infer that identity.
        // Older transports without metadata safely rebind the emitting subtree.
        const affected =
          relativePaths.length > 0 ? relativePaths : [watchedPath];
        for (const path of targetPaths) {
          if (
            affected.some(
              (changed) =>
                changed === "." ||
                path === changed ||
                path.startsWith(`${changed}/`),
            )
          ) {
            stalePaths.add(path);
            retire(path);
          }
        }
        publishCoverage();
      }
      schedule();
    };

    const registerWatch = (path: string): Promise<boolean> => {
      if (!isCurrent()) return Promise.resolve(false);
      if (activeSubs.has(path)) return Promise.resolve(true);
      const pending = pendingSubs.get(path);
      if (pending) return pending;
      const registration = (async () => {
        let subId: number | undefined;
        let cleanupEvent: (() => void) | undefined;
        let cleanupOverflow: (() => void) | undefined;
        try {
          const result = await Promise.resolve().then(() =>
            seam.fsSubscribeTree!(normalizedTarget, path, { watchOnly: true }),
          );
          subId = typeof result === "number" ? result : result.sub_id;
          if (!isCurrent() || stalePaths.has(path)) {
            unsubscribe(subId);
            return false;
          }
          const registeredId = subId;
          cleanupEvent = seam.onFsEvent!(subId, (event) => {
            if (activeSubs.get(path)?.subId === registeredId)
              handleEvent(path, event);
          });
          cleanupOverflow =
            seam.onFsOverflow?.(subId, () => {
              if (!isCurrent() || activeSubs.get(path)?.subId !== registeredId)
                return;
              retire(path);
              eventVersion += 1;
              void requestReconciliation();
            }) ?? (() => {});
          activeSubs.set(path, { subId, cleanupEvent, cleanupOverflow });
          return true;
        } catch {
          try {
            cleanupEvent?.();
          } catch {
            /* Continue cleaning. */
          }
          try {
            cleanupOverflow?.();
          } catch {
            /* Continue cleaning. */
          }
          if (subId !== undefined) unsubscribe(subId);
          return false;
        } finally {
          pendingSubs.delete(path);
        }
      })();
      pendingSubs.set(path, registration);
      return registration;
    };

    const reconcile = async () => {
      while (requested && isCurrent() && !paused) {
        requested = false;
        setCoverage({ status: "reconciling", reason: null });
        const startingVersion = eventVersion;
        for (const path of stalePaths) retire(path);
        stalePaths.clear();
        const toAdd = targetPaths.filter((path) => !activeSubs.has(path));
        for (
          let index = 0;
          index < toAdd.length && isCurrent();
          index += MAX_CONCURRENT_REGISTRATIONS
        ) {
          await Promise.all(
            toAdd
              .slice(index, index + MAX_CONCURRENT_REGISTRATIONS)
              .map(registerWatch),
          );
        }
        if (!isCurrent()) return;
        // Invalidation alone may reuse an initial no-data request that predates
        // installation. Cancel that scoped request before starting the snapshot.
        const queryKeys = [
          normalizedPlan
            ? selectedPlanQueryKey(owner, normalizedTarget, normalizedPlan)
            : planFoldersQueryKey(owner, normalizedTarget, normalizedBrowse),
        ];
        if (normalizedDoc) {
          queryKeys.push(
            planDocumentQueryKey(owner, normalizedTarget, normalizedDoc),
          );
        }
        await Promise.all(
          queryKeys.map((queryKey) =>
            qc.cancelQueries({ queryKey, exact: true }),
          ),
        );
        if (!isCurrent()) return;
        await invalidate();
        if (!isCurrent()) return;
        if (eventVersion !== startingVersion) {
          requested = true;
          churnPasses += 1;
          if (churnPasses >= MAX_CHURN_RECONCILE_PASSES) {
            paused = true;
            setCoverage({
              status: "degraded",
              reason:
                "Excessive filesystem churn; paused automatic reconciliation",
              failedWatchPaths: requiredPaths.filter(
                (path) => !activeSubs.has(path),
              ),
            });
          }
        } else {
          // Successful/quiescent settlement is not a lifetime churn allowance.
          churnPasses = 0;
        }
        publishCoverage();
      }
    };

    const requestReconciliation = (): Promise<void> => {
      if (!isCurrent() || paused) return Promise.resolve();
      requested = true;
      if (!reconciliation) {
        reconciliation = reconcile().finally(() => {
          reconciliation = null;
        });
      }
      return reconciliation;
    };
    const refreshWatches = () => {
      paused = false;
      churnPasses = 0;
      clearTimeout(timer ?? undefined);
      timer = null;
      return requestReconciliation();
    };
    reconcileRef.current = refreshWatches;
    void requestReconciliation();

    return () => {
      isDisposed = true;
      if (reconcileRef.current === refreshWatches) reconcileRef.current = null;
      clearTimeout(timer ?? undefined);
      for (const path of activeSubs.keys()) retire(path);
      // Pending registrations observe disposal and retire their exact late IDs.
    };
  }, [
    isEnabled,
    owner?.profileId,
    owner?.generation,
    targetCacheKey,
    normalizedBrowse,
    normalizedPlan,
    normalizedDoc,
    desiredWatchPathsKey,
    customTransport,
    invalidate,
  ]);

  // ── Manual Actions ────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (reconcileRef.current) {
      await reconcileRef.current();
    } else {
      // Data can still be explicitly refreshed when transport coverage is unsupported.
      await invalidate();
    }
  }, [invalidate]);

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
