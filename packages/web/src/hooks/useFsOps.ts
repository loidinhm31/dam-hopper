import { useQueryClient } from "@tanstack/react-query";
import { getTransport } from "@/api/transport.js";
import type { WsTransport } from "@/api/ws-transport.js";
import type { FsOpResult } from "@/api/fs-types.js";

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

  function download(path: string): void {
    const params = new URLSearchParams({ project, path });
    const a = document.createElement("a");
    a.href = `/api/fs/download?${params}`;
    a.download = path.split("/").pop() ?? "download";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return { createFile, createDir, rename, deleteEntry, move, download };
}
