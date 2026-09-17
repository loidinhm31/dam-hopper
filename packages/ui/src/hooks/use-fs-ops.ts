import { useQueryClient } from "@tanstack/react-query";
import { logger } from "@dam-hopper/shared/logger";
import { getTransport } from "@/api/transport.js";
import {
  captureConnection,
  getConnectionSnapshot,
  getTransport as getConnectionsTransport,
  isCurrentConnection,
} from "@/api/connections.js";
import {
  toServerProjectTarget,
  type ConnectionRef,
} from "@/api/ownership.js";
import type { WsTransport } from "@/api/ws-transport.js";
import type { FsOpResult } from "@/api/fs-types.js";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "@/api/client.js";
import {
  getProfiles,
  getAuthToken,
  getServerUrl,
} from "@/api/server-config.js";
import {
  invalidateGitFileOperation,
  markTargetUnavailableIfNeeded,
} from "@/api/queries.js";
import { isVideoFile } from "@/lib/video-file.js";
import { startVideoDownload } from "@/lib/start-video-download.js";

const MAX_BLOB_DOWNLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Wraps transport.fsOp with query cache invalidation after each mutation.
 *
 * Watcher events will also trigger invalidation via useFsSubscription, so
 * double invalidation is idempotent and safe.
 */
export function useFsOps(target: ProjectTargetInput, subscribedPath: string) {
  const qc = useQueryClient();
  const targetRef = normalizeProjectTarget(target);
  const project = targetRef.project;
  const targetKey = projectTargetCacheKey(targetRef);

  function invalidateTree() {
    if (targetRef.profileId) {
      void qc.invalidateQueries({
        queryKey: [
          "fs-tree",
          targetRef.profileId,
          project,
          targetKey,
          subscribedPath,
        ],
      });
    }
    void qc.invalidateQueries({
      queryKey: ["fs-tree", project, targetKey, subscribedPath],
    });
  }

  function invalidateGit(path: string) {
    void invalidateGitFileOperation(qc, targetRef, path);
  }

  function getBoundTransport(): {
    transport: WsTransport;
    connectionRef?: ConnectionRef;
  } {
    const profileId = targetRef.profileId;
    if (profileId) {
      try {
        const conn = captureConnection(profileId);
        const t = getConnectionsTransport(conn) as WsTransport;
        return { transport: t, connectionRef: conn };
      } catch {
        // Disconnected or offline
      }
    }
    return { transport: getTransport() as WsTransport };
  }

  async function runFsOp(
    op: "create_file" | "create_dir" | "rename" | "delete" | "move",
    params: { path: string; newPath?: string; forceGit?: boolean },
  ): Promise<FsOpResult> {
    const { transport: t, connectionRef } = getBoundTransport();
    try {
      const wire = toServerProjectTarget(targetRef);
      const result = await t.fsOp(op, {
        ...wire,
        ...params,
      });
      if (connectionRef && !isCurrentConnection(connectionRef)) {
        return { ok: false, error: "Connection changed during operation" };
      }
      markTargetUnavailableIfNeeded(targetRef, result);
      return result;
    } catch (error) {
      if (connectionRef && !isCurrentConnection(connectionRef)) {
        return { ok: false, error: "Connection changed during operation" };
      }
      markTargetUnavailableIfNeeded(targetRef, error);
      throw error;
    }
  }

  async function createFile(path: string): Promise<FsOpResult> {
    const result = await runFsOp("create_file", { path });
    if (result.ok) {
      invalidateTree();
      invalidateGit(path);
    }
    return result;
  }

  async function createDir(path: string): Promise<FsOpResult> {
    const result = await runFsOp("create_dir", { path });
    if (result.ok) {
      invalidateTree();
      invalidateGit(path);
    }
    return result;
  }

  async function rename(path: string, newPath: string): Promise<FsOpResult> {
    const result = await runFsOp("rename", { path, newPath });
    if (result.ok) {
      invalidateTree();
      invalidateGit(path);
      invalidateGit(newPath);
    }
    return result;
  }

  async function deleteEntry(
    path: string,
    forceGit = false,
  ): Promise<FsOpResult> {
    const result = await runFsOp("delete", { path, forceGit });
    if (result.ok) {
      invalidateTree();
      invalidateGit(path);
    }
    return result;
  }

  async function move(path: string, newPath: string): Promise<FsOpResult> {
    const result = await runFsOp("move", { path, newPath });
    if (result.ok) {
      invalidateTree();
      invalidateGit(path);
      invalidateGit(newPath);
    }
    return result;
  }

  async function download(path: string, size?: number): Promise<void> {
    if (isVideoFile(path)) {
      try {
        await startVideoDownload(targetRef, path);
      } catch (error) {
        markTargetUnavailableIfNeeded(targetRef, error);
        throw error;
      }
      return;
    }
    if (!Number.isFinite(size) || size === undefined) {
      throw new Error("Cannot safely download a file with unknown size.");
    }
    if (size > MAX_BLOB_DOWNLOAD_BYTES) {
      throw new Error(
        "This file is too large for browser download. Use an external client.",
      );
    }
    const params = new URLSearchParams({ project, path });
    if (targetRef.worktreePath != null) {
      params.set("worktreePath", targetRef.worktreePath);
    }
    const profileId = targetRef.profileId;
    let serverUrl = getServerUrl();
    let token: string | null = null;
    if (profileId) {
      const snapshot = getConnectionSnapshot(profileId);
      const profile = getProfiles().find((p) => p.id === profileId);
      serverUrl = snapshot?.serverUrl ?? profile?.url ?? getServerUrl();
      token = getAuthToken(profileId);
    } else {
      token = getAuthToken();
    }
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    try {
      const response = await fetch(`${serverUrl}/api/fs/download?${params}`, {
        headers,
      });
      if (!response.ok) {
        let error: { code?: string; message: string } = {
          message: `Download failed: ${response.statusText}`,
        };
        try {
          const payload: unknown = await response.clone().json();
          if (payload && typeof payload === "object") {
            const record = payload as Record<string, unknown>;
            error = {
              code: typeof record.code === "string" ? record.code : undefined,
              message:
                typeof record.message === "string"
                  ? record.message
                  : error.message,
            };
          }
        } catch {
          // Keep the HTTP status error when the response is not JSON.
        }
        markTargetUnavailableIfNeeded(targetRef, error);
        throw new Error(error.message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() ?? "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error("useFsOps", "download failed", { path, error });
      throw error;
    }
  }

  return { createFile, createDir, rename, deleteEntry, move, download };
}
