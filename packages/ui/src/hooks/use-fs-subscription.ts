import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransport, type Transport } from "@/api/transport.js";
import {
  captureConnection,
  getTransport as getConnectionsTransport,
} from "@/api/connections.js";
import {
  toServerProjectTarget,
  normalizeFsTarget,
  toServerFsTarget,
  fsTargetKey,
  type FsTargetRef,
  type ServerFsTarget,
} from "@/api/ownership.js";
import type {
  FsArborNode,
  FsListResponse,
  ServerTreeNode,
  FsEventDto,
  FsTreeData,
} from "@/api/fs-types.js";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
  type ProjectTargetRef,
} from "@/api/client.js";
import { fsTreeQueryKey } from "@/api/queries.js";
import { scheduleGitFsInvalidation } from "@/lib/git-fs-invalidation.js";
import { useTransportGeneration } from "@/hooks/use-transport-generation.js";
import {
  explorerLanguageScanWorkspaceEpoch,
  markExplorerLanguageScanStale,
} from "@/lib/explorer-language-scan.js";

// ---------------------------------------------------------------------------
// Delta application
// ---------------------------------------------------------------------------

/**
 * Apply a WS fs:event to cached tree data.
 *
 * Strategy:
 * - "delete" / "modify": locate node by basename and splice/update in place.
 * - Everything else (create, rename, other): signal the caller to refetch
 *   (we'd need to stat the new file to build a proper node).
 *
 * Returns `null` to signal "unknown parent → trigger refetch".
 */
export function applyFsDelta(
  data: FsTreeData,
  ev: FsEventDto,
): FsTreeData | null {
  const normalizedPath = ev.path.replace(/\\/g, "/");
  const basename = normalizedPath.split("/").pop() ?? "";

  switch (ev.kind) {
    case "remove": {
      const idx = data.nodes.findIndex((n) => n.name === basename);
      if (idx === -1) return data; // already gone, no-op
      return {
        ...data,
        nodes: [...data.nodes.slice(0, idx), ...data.nodes.slice(idx + 1)],
      };
    }
    case "modify": {
      const idx = data.nodes.findIndex((n) => n.name === basename);
      if (idx === -1) return data;
      const updated: FsArborNode = {
        ...data.nodes[idx],
        mtime: Math.floor(Date.now() / 1000),
      };
      const nodes = [...data.nodes];
      nodes[idx] = updated;
      return { ...data, nodes };
    }
    default:
      // create / rename / access / other — refetch for correctness
      return null;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface FsSubscriptionTransportSeam {
  fsSubscribeTree?: (
    target: ServerFsTarget | FsTargetRef | ProjectTargetInput,
    path: string,
  ) => Promise<{ sub_id: number; nodes: ServerTreeNode[] }>;
  fsUnsubscribeTree?: (sub_id: number) => void;
  onFsEvent?: (sub_id: number, cb: (ev: FsEventDto) => void) => () => void;
}

export function resolveSubscriptionTransport(
  targetRef: FsTargetRef,
  originating?: Transport | null,
): Transport {
  if (originating) return originating;
  if (targetRef.profileId) {
    const conn = captureConnection(targetRef.profileId);
    return getConnectionsTransport(conn);
  }
  return getTransport();
}

/**
 * Subscribe to a filesystem tree via WS.
 *
 * Returns the TanStack Query result for the target-scoped tree cache key.
 * Also exposes `loadChildren` for lazy dir expansion.
 */
export function useFsSubscription(
  target: FsTargetRef | ProjectTargetInput | null | undefined,
  path: string,
  options?: { enabled?: boolean },
) {
  const qc = useQueryClient();
  const isTargetValid = !(target && typeof target === "object" && "kind" in target && target.kind === "project" && !target.project?.trim());
  const isEnabled = (options?.enabled ?? true) && isTargetValid;
  const targetRef = target && isTargetValid
    ? normalizeFsTarget(target)
    : { kind: "workspace" as const, profileId: "" };
  const profileId = targetRef.profileId;
  const targetKey =
    targetRef.kind === "workspace"
      ? "workspace"
      : targetRef.worktreePath == null
        ? "root"
        : targetRef.worktreePath;
  const requestTarget = toServerFsTarget(targetRef);
  const transportGeneration = useTransportGeneration(profileId);
  const boundTransportGenerationRef = useRef(transportGeneration);
  const originatingTransportRef = useRef<Transport | null>(null);

  const treeQueryKey = fsTreeQueryKey(targetRef, path);
  const query = useQuery<FsTreeData>({
    queryKey: treeQueryKey,
    enabled: isEnabled,
    queryFn: async ({ signal }) => {
      const t = resolveSubscriptionTransport(targetRef);
      const fsSeam = t as unknown as FsSubscriptionTransportSeam;
      if (typeof fsSeam.fsSubscribeTree !== "function") {
        throw new Error("Transport does not support file tree subscription");
      }
      originatingTransportRef.current = t;

      let sub_id: number | undefined;
      try {
        const result = await fsSeam.fsSubscribeTree(requestTarget, path);
        sub_id = result.sub_id;
        if (signal.aborted) {
          if (typeof fsSeam.fsUnsubscribeTree === "function") {
            fsSeam.fsUnsubscribeTree(sub_id);
          }
          throw new DOMException("Subscription cancelled", "AbortError");
        }
        return { sub_id, nodes: result.nodes.map(serverNodeToArbor) };
      } catch (e) {
        if (
          sub_id !== undefined &&
          !(e instanceof DOMException && e.name === "AbortError")
        ) {
          if (typeof fsSeam.fsUnsubscribeTree === "function") {
            fsSeam.fsUnsubscribeTree(sub_id);
          }
        }
        throw e;
      }
    },
    staleTime: Infinity,
  });
  // Set up fs event listener once we have a sub_id.
  // Cleanup runs on sub_id change (re-subscription) or unmount.
  const subId = query.data?.sub_id;
  useEffect(() => {
    if (!isEnabled || subId == null) return;
    if (boundTransportGenerationRef.current !== transportGeneration) {
      boundTransportGenerationRef.current = transportGeneration;
      void qc.resetQueries({
        queryKey: treeQueryKey,
        exact: true,
      });
      return;
    }
    let t: Transport;
    try {
      t = resolveSubscriptionTransport(
        targetRef,
        originatingTransportRef.current,
      );
    } catch {
      return;
    }

    const fsSeam = t as unknown as FsSubscriptionTransportSeam;
    const projectRef =
      targetRef.kind === "project"
        ? (targetRef as unknown as ProjectTargetRef)
        : null;
    const workspaceEpoch = projectRef
      ? explorerLanguageScanWorkspaceEpoch(qc, projectRef)
      : 0;
    const handleEvent = (ev: FsEventDto) => {
      if (
        projectRef &&
        explorerLanguageScanWorkspaceEpoch(qc, projectRef) !== workspaceEpoch
      ) {
        return;
      }
      if (projectRef) {
        markExplorerLanguageScanStale(qc, projectRef, workspaceEpoch, targetKey);
      }
      qc.setQueryData<FsTreeData>(treeQueryKey, (prev) => {
        if (!prev) return prev;
        const next = applyFsDelta(prev, ev);
        if (next === null) {
          void qc.invalidateQueries({
            queryKey: treeQueryKey,
          });
          return prev;
        }
        return next;
      });
      if (projectRef) {
        scheduleGitFsInvalidation(qc, projectRef);
      }
    };
    let off: () => void;
    if (typeof fsSeam.onFsEvent === "function") {
      off = fsSeam.onFsEvent(subId, handleEvent);
    } else if (typeof t.onEvent === "function") {
      off = t.onEvent(`fs:${subId}`, (payload) =>
        handleEvent(payload as FsEventDto),
      );
    } else {
      off = () => {};
    }

    return () => {
      off();
      if (typeof fsSeam.fsUnsubscribeTree === "function") {
        fsSeam.fsUnsubscribeTree(subId);
      }
      if (originatingTransportRef.current === t) {
        originatingTransportRef.current = null;
      }
      const currentCached = qc.getQueryData<FsTreeData>(treeQueryKey);
      if (currentCached?.sub_id === subId) {
        qc.removeQueries({ queryKey: treeQueryKey, exact: true });
      }
    };
  }, [
    subId,
    targetKey,
    path,
    qc,
    transportGeneration,
    profileId,
  ]);
  /** Load children for a dir node and splice them into the cached tree. */
  async function loadChildren(nodeId: string) {
    const t = resolveSubscriptionTransport(
      targetRef,
      originatingTransportRef.current,
    );
    const wire = toServerFsTarget(targetRef);
    const resp = await t.invoke<FsListResponse>("fs:list", {
      target: wire,
      path: nodeId,
    });
    const children = resp.entries.map(
      (e) =>
        ({
          id: nodeId + "/" + e.name,
          name: e.name,
          kind: e.kind,
          size: e.size,
          mtime: e.mtime,
          isSymlink: e.isSymlink,
          children: e.kind === "dir" ? null : undefined,
        }) as FsArborNode,
    );

    qc.setQueryData<FsTreeData>(treeQueryKey, (prev) => {
      if (!prev) return prev;
      return { ...prev, nodes: spliceChildren(prev.nodes, nodeId, children) };
    });

    if (targetRef.kind === "project" && targetRef.profileId) {
      qc.setQueryData<FsTreeData>(
        ["fs-tree", targetRef.project, targetKey, path],
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            nodes: spliceChildren(prev.nodes, nodeId, children),
          };
        },
      );
    }

    return children;
  }

  return { ...query, loadChildren };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serverNodeToArbor(n: ServerTreeNode): FsArborNode {
  return {
    id: n.path,
    name: n.name,
    kind: n.kind as "file" | "dir",
    size: n.size,
    mtime: n.mtime,
    isSymlink: n.isSymlink,
    children: n.kind === "dir" ? null : (undefined as unknown as null),
  };
}

export function spliceChildren(
  nodes: FsArborNode[],
  targetId: string,
  children: FsArborNode[],
): FsArborNode[] {
  return nodes.map((n) => {
    if (n.id === targetId) return { ...n, children };
    if (n.children && n.children.length > 0) {
      return { ...n, children: spliceChildren(n.children, targetId, children) };
    }
    return n;
  });
}
