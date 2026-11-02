import { useCallback, useMemo, useState, useEffect } from "react";
import type { OsWindow } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { FileTree } from "@/components/organisms/FileTree.js";
import { dispatchIntent, createIntent, registerIntentHandler } from "../intents.js";
import { normalizeProjectTarget } from "@/api/client.js";
import type { FsArborNode } from "@/api/fs-types.js";
import type { FileTreeRevealRequest } from "@/lib/file-tree-reveal.js";

export interface FilesAppProps {
  window: OsWindow;
}

export function FilesApp({ window }: FilesAppProps) {
  const owner = useWindowOwner();
  const profileId = owner.profileId;
  const project = window.ctx.projectId ?? "";
  const worktreeId = window.ctx.worktreeId;
  const [revealRequest, setRevealRequest] = useState<FileTreeRevealRequest | null>(null);

  const target = useMemo(
    () =>
      normalizeProjectTarget({
        profileId,
        project,
        worktreePath: worktreeId,
      }),
    [profileId, project, worktreeId],
  );

  const handleFileOpen = useCallback(
    (node: FsArborNode) => {
      void dispatchIntent(
        createIntent(
          "file:open",
          {
            profileId,
            projectId: project,
            worktreeId,
            filePath: node.id,
          },
          window.id,
        ),
      );
    },
    [profileId, project, worktreeId, window.id],
  );

  const handleOpenTerminal = useCallback(() => {
    void dispatchIntent(
      createIntent(
        "terminal:open",
        {
          profileId,
          projectId: project,
          worktreeId,
        },
        window.id,
      ),
    );
  }, [profileId, project, worktreeId, window.id]);

  useEffect(() => {
    const unregister = registerIntentHandler("file:reveal", (intent) => {
      if (
        intent.payload.profileId === profileId &&
        intent.payload.projectId === project &&
        intent.payload.worktreeId === worktreeId
      ) {
        setRevealRequest({
          project,
          path: intent.payload.filePath,
          nonce: Date.now(),
        });
        return { status: "handled", targetWindowId: window.id };
      }
      return { status: "unhandled", reason: "Target context mismatch" };
    });
    return unregister;
  }, [profileId, project, worktreeId, window.id]);

  return (
    <div
      data-os-files-app={window.id}
      data-testid={`files-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex-1 min-h-0 relative">
        <FileTree
          project={project}
          target={target}
          onFileOpen={handleFileOpen}
          onOpenTerminal={handleOpenTerminal}
          revealRequest={revealRequest}
          className="h-full"
        />
      </div>
    </div>
  );
}
