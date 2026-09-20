import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransport, type Transport } from "@/api/transport.js";
import {
  captureConnection,
  getTransport as getConnectionsTransport,
} from "@/api/connections.js";
import { toServerProjectTarget } from "@/api/ownership.js";
import type { WsTransport } from "@/api/ws-transport.js";
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
    project: string | { project: string; worktreePath?: string },
    path: string,
  ) => Promise<{ sub_id: number; nodes: ServerTreeNode[] }>;
  fsUnsubscribeTree?: (sub_id: number) => void;
  onFsEvent?: (sub_id: number, cb: (ev: FsEventDto) => void) => () => void;
}

function resolveSubscriptionTransport(
  targetRef: ProjectTargetRef,
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
 * Subscribe to a project's file tree via WS.
 *
 * Returns the TanStack Query result for `['fs-tree', project, path]`.
 * Also exposes `loadChildren` for lazy dir expansion.
 */
export function useFsSubscription(target: ProjectTargetInput, path: string) {
  const qc = useQueryClient();
  const targetRef = normalizeProjectTarget(target);
  const project = targetRef.project;
  const worktreePath = targetRef.worktreePath;
  const profileId = targetRef.profileId;
  const targetKey = projectTargetCacheKey(targetRef);
  const requestTarget =
    worktreePath == null ? project : { project, worktreePath };
  const transportGeneration = useTransportGeneration(profileId);
  const boundTransportGenerationRef = useRef(transportGeneration);
  const originatingTransportRef = useRef<Transport | null>(null);

  const treeQueryKey = profileId
    ? ["fs-tree", profileId, project, targetKey, path]
    : ["fs-tree", project, targetKey, path];
  const query = useQuery<FsTreeData>({
    queryKey: treeQueryKey,
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
    if (subId == null) return;
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
    const workspaceEpoch = explorerLanguageScanWorkspaceEpoch(qc, targetRef);
    const handleEvent = (ev: FsEventDto) => {
      if (
        explorerLanguageScanWorkspaceEpoch(qc, targetRef) !== workspaceEpoch
      ) {
        return;
      }
      markExplorerLanguageScanStale(qc, targetRef, workspaceEpoch, targetKey);
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
      scheduleGitFsInvalidation(qc, targetRef);
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
    project,
    worktreePath,
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
    const wire = toServerProjectTarget(targetRef);
    const resp = await t.invoke<FsListResponse>("fs:list", {
      ...wire,
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

    if (targetRef.profileId) {
      qc.setQueryData<FsTreeData>(
        ["fs-tree", project, targetKey, path],
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

function spliceChildren(
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
