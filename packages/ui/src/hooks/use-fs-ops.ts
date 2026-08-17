import { useQueryClient } from "@tanstack/react-query";
import { logger } from "@dam-hopper/shared/logger";
import { getTransport } from "@/api/transport.js";
import type { WsTransport } from "@/api/ws-transport.js";
import type { FsOpResult } from "@/api/fs-types.js";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "@/api/client.js";
import {
  getActiveProfile,
  getAuthToken,
  getServerUrl,
} from "@/api/server-config.js";
import { invalidateGitFileOperation } from "@/api/queries.js";
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
    void qc.invalidateQueries({
      queryKey: ["fs-tree", project, targetKey, subscribedPath],
    });
  }

  function invalidateGit(path: string) {
    void invalidateGitFileOperation(qc, targetRef, path);
  }

  function transport(): WsTransport {
    return getTransport() as WsTransport;
  }

  async function createFile(path: string): Promise<FsOpResult> {
    const result = await transport().fsOp("create_file", {
      ...targetRef,
      path,
    });
    if (result.ok) {
      invalidateTree();
      invalidateGit(path);
    }
    return result;
  }

  async function createDir(path: string): Promise<FsOpResult> {
    const result = await transport().fsOp("create_dir", {
      ...targetRef,
      path,
    });
    if (result.ok) {
      invalidateTree();
      invalidateGit(path);
    }
    return result;
  }

  async function rename(path: string, newPath: string): Promise<FsOpResult> {
    const result = await transport().fsOp("rename", {
      ...targetRef,
      path,
      newPath,
    });
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
    const result = await transport().fsOp("delete", {
      ...targetRef,
      path,
      forceGit,
    });
    if (result.ok) {
      invalidateTree();
      invalidateGit(path);
    }
    return result;
  }

  async function move(path: string, newPath: string): Promise<FsOpResult> {
    const result = await transport().fsOp("move", {
      ...targetRef,
      path,
      newPath,
    });
    if (result.ok) {
      invalidateTree();
      invalidateGit(path);
      invalidateGit(newPath);
    }
    return result;
  }

  async function download(path: string, size?: number): Promise<void> {
    if (isVideoFile(path)) {
      await startVideoDownload(targetRef, path);
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
    const profile = getActiveProfile();
    const serverUrl = profile?.url ?? getServerUrl();
    const token = getAuthToken(profile?.id);
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${serverUrl}/api/fs/download?${params}`, {
        headers,
      });
      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
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
