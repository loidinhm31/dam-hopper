import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getTransport } from "@/api/transport.js";
import type { WsTransport } from "@/api/ws-transport.js";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "@/api/client.js";
import {
  invalidateGitFileOperation,
  markTargetUnavailableIfNeeded,
} from "@/api/queries.js";

export interface UploadProgress {
  filename: string;
  pct: number;
  done: boolean;
  error?: string;
}

/**
 * Streams a File to the server via the WS fs:upload_* protocol.
 *
 * Returns upload state and an `upload(project, dir, file)` trigger.
 * Progress is derived from per-seq acks.
 */
export function useFsUpload(
  target: ProjectTargetInput,
  subscribedPath: string,
) {
  const qc = useQueryClient();
  const targetRef = normalizeProjectTarget(target);
  const project = targetRef.project;
  const worktreePath = targetRef.worktreePath;
  const targetKey = projectTargetCacheKey(targetRef);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const upload = useCallback(
    async (dir: string, file: File): Promise<void> => {
      if (typeof file.stream !== "function") {
        setProgress({
          filename: file.name,
          pct: 0,
          done: true,
          error: "File.stream() not supported in this browser",
        });
        return;
      }

      setProgress({ filename: file.name, pct: 0, done: false });
      const requestTarget =
        worktreePath == null ? project : { project, worktreePath };

      try {
        const t = getTransport() as WsTransport;
        const result = await t.fsUploadFile(requestTarget, dir, file, (pct) => {
          setProgress({ filename: file.name, pct, done: false });
        });

        if (result.ok) {
          setProgress({ filename: file.name, pct: 100, done: true });
          void qc.invalidateQueries({
            queryKey: ["fs-tree", project, targetKey, subscribedPath],
          });
          const path = dir ? `${dir}/${file.name}` : file.name;
          void invalidateGitFileOperation(qc, requestTarget, path);
        } else {
          markTargetUnavailableIfNeeded(requestTarget, result.error);
          setProgress({
            filename: file.name,
            pct: 0,
            done: true,
            error: result.error ?? "Upload failed",
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        markTargetUnavailableIfNeeded(requestTarget, e);
        setProgress({ filename: file.name, pct: 0, done: true, error: msg });
      }
    },
    [project, subscribedPath, targetKey, worktreePath, qc],
  );

  function clearProgress() {
    setProgress(null);
  }

  return { progress, upload, clearProgress };
}
