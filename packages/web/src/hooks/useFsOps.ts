import { useQueryClient } from "@tanstack/react-query";
import { getTransport } from "@/api/transport.js";
import type { WsTransport } from "@/api/ws-transport.js";
import type { FsOpResult } from "@/api/fs-types.js";
import { getServerUrl, getAuthToken } from "@/api/server-config.js";

/**
 * Wraps transport.fsOp with query cache invalidation after each mutation.
 *
 * Watcher events will also trigger invalidation via useFsSubscription, so
 * double invalidation is idempotent and safe.
 */
export function useFsOps(project: string, subscribedPath: string) {
  const qc = useQueryClient();

  function invalidateTree() {
    void qc.invalidateQueries({ queryKey: ["fs-tree", project, subscribedPath] });
  }

  function transport(): WsTransport {
    return getTransport() as WsTransport;
  }

  async function createFile(path: string): Promise<FsOpResult> {
    const result = await transport().fsOp("create_file", { project, path });
    if (result.ok) invalidateTree();
    return result;
  }

  async function createDir(path: string): Promise<FsOpResult> {
    const result = await transport().fsOp("create_dir", { project, path });
    if (result.ok) invalidateTree();
    return result;
  }

  async function rename(path: string, newPath: string): Promise<FsOpResult> {
    const result = await transport().fsOp("rename", { project, path, newPath });
    if (result.ok) invalidateTree();
    return result;
  }

  async function deleteEntry(path: string, forceGit = false): Promise<FsOpResult> {
    const result = await transport().fsOp("delete", { project, path, forceGit });
    if (result.ok) invalidateTree();
    return result;
  }

  async function move(path: string, newPath: string): Promise<FsOpResult> {
    const result = await transport().fsOp("move", { project, path, newPath });
    if (result.ok) invalidateTree();
    return result;
  }

  async function download(path: string): Promise<void> {
    const params = new URLSearchParams({ project, path });
    const token = getAuthToken();
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${getServerUrl()}/api/fs/download?${params}`, { headers });
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
      console.error("Download failed:", error);
      throw error;
    }
  }

  return { createFile, createDir, rename, deleteEntry, move, download };
}
