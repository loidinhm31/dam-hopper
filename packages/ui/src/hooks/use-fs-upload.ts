import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getTransport } from "@/api/transport.js";
import {
  captureConnection,
  getTransport as getConnectionsTransport,
  isCurrentConnection,
} from "@/api/connections.js";
import {
  normalizeFsTarget,
  toServerFsTarget,
  fsTargetKey,
  type ConnectionRef,
  type FsTargetRef,
} from "@/api/ownership.js";
import type { WsTransport } from "@/api/ws-transport.js";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
  type ProjectTargetRef,
} from "@/api/client.js";
import {
  fsTreeQueryKey,
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
  target: FsTargetRef | ProjectTargetInput,
  subscribedPath: string,
) {
  const qc = useQueryClient();
  const isTargetValid = !(target && typeof target === "object" && "kind" in target && target.kind === "project" && !target.project?.trim());
  const targetRef = isTargetValid ? normalizeFsTarget(target) : { kind: "project" as const, project: "", profileId: (target as FsTargetRef).profileId ?? "" };
  const targetKey = isTargetValid ? fsTargetKey(targetRef) : "invalid";
  const profileId = targetRef.profileId;
  const uploadTarget = useMemo(
    () =>
      targetRef.kind === "project" && !targetRef.profileId
        ? targetRef.worktreePath
          ? { project: targetRef.project, worktreePath: targetRef.worktreePath }
          : { project: targetRef.project }
        : targetRef,
    [targetRef],
  );
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
      let connectionRef: ConnectionRef | undefined;
      let t: WsTransport;

      if (profileId) {
        try {
          connectionRef = captureConnection(profileId);
          t = getConnectionsTransport(connectionRef) as WsTransport;
        } catch (err) {
          setProgress({
            filename: file.name,
            pct: 0,
            done: true,
            error:
              err instanceof Error
                ? err.message
                : "Profile disconnected; upload aborted.",
          });
          return;
        }
      } else {
        t = getTransport() as WsTransport;
      }

      try {
        const result = await t.fsUploadFile(uploadTarget, dir, file, (pct) => {
          setProgress({ filename: file.name, pct, done: false });
        });

        if (connectionRef && !isCurrentConnection(connectionRef)) {
          setProgress({
            filename: file.name,
            pct: 0,
            done: true,
            error: "Connection changed during upload",
          });
          return;
        }

        if (result.ok) {
          setProgress({ filename: file.name, pct: 100, done: true });
          const queryKey = fsTreeQueryKey(targetRef, subscribedPath);
          void qc.invalidateQueries({ queryKey });
          if (targetRef.kind === "project") {
            const path = dir ? `${dir}/${file.name}` : file.name;
            void invalidateGitFileOperation(
              qc,
              targetRef as unknown as ProjectTargetRef,
              path,
            );
          }
        } else {
          if (targetRef.kind === "project") {
            markTargetUnavailableIfNeeded(uploadTarget as ProjectTargetRef, result.error);
          }
          setProgress({
            filename: file.name,
            pct: 0,
            done: true,
            error: result.error ?? "Upload failed",
          });
        }
      } catch (e) {
        if (connectionRef && !isCurrentConnection(connectionRef)) {
          setProgress({
            filename: file.name,
            pct: 0,
            done: true,
            error: "Connection changed during upload",
          });
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        if (targetRef.kind === "project") {
          markTargetUnavailableIfNeeded(uploadTarget as ProjectTargetRef, e);
        }
        setProgress({ filename: file.name, pct: 0, done: true, error: msg });
      }
    },
    [subscribedPath, targetKey, qc, profileId, targetRef, uploadTarget],
  );

  function clearProgress() {
    setProgress(null);
  }

  return { progress, upload, clearProgress };
}
