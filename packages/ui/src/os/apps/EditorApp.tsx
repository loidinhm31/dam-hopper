import { useEffect, useMemo, useRef } from "react";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { useResourceClaim } from "../resource-registry.js";
import {
  attachMonacoToSlot,
  getMonacoParkingHost,
  parkMonacoElement,
  subscribeToMonacoParking,
} from "../MonacoKeepAliveHost.js";
import { useWindowStore } from "../window-store.js";
import { editorFileTabKey } from "@/stores/editor.js";
import type { ProjectTargetInput } from "@/api/client.js";
export interface EditorAppProps {
  window: OsWindow;
}

export function EditorApp({ window }: EditorAppProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const owner = useWindowOwner();
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const filePath =
    (window.appState?.filePath as string | undefined) ?? "untitled.ts";
  const target = useMemo<ProjectTargetInput>(
    () => ({
      profileId: owner.profileId,
      project: window.ctx.projectId ?? "global",
      worktreePath: window.ctx.worktreeId,
    }),
    [owner.profileId, window.ctx.projectId, window.ctx.worktreeId],
  );

  const tabKey = useMemo(
    () => editorFileTabKey(target, filePath),
    [target, filePath],
  );

  const claimKey = useMemo<ResourceClaimKey>(
    () => ({
      resourceKind: "editor",
      profileId: owner.profileId,
      generation: owner.generation,
      resourceId: tabKey,
    }),
    [owner.profileId, owner.generation, tabKey],
  );

  const claimStatus = useResourceClaim(claimKey, window.id);

  useEffect(() => {
    if (!claimStatus.success) return;
    const el = slotRef.current;
    if (!el) return;

    const attach = () => {
      attachMonacoToSlot(el, tabKey);
    };

    attach();
    const unsubscribe = subscribeToMonacoParking(tabKey, attach);

    return () => {
      unsubscribe();
      const parkingHost = getMonacoParkingHost();
      if (parkingHost) {
        parkMonacoElement(parkingHost, tabKey);
      }
    };
  }, [tabKey, claimStatus.success]);

  if (!claimStatus.success) {
    const holderId = claimStatus.existingHolderWindowId ?? "unknown";
    return (
      <div
        data-os-claim-denied="true"
        data-testid="editor-claim-denied"
        className="flex flex-col items-center justify-center p-4 text-center h-full bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] gap-3"
      >
        <p>File is already open in another editor window ({filePath}).</p>
        <button
          type="button"
          onClick={() => focusWindow(holderId)}
          className="px-3 py-1.5 rounded bg-[var(--color-primary)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
        >
          Focus Existing Window
        </button>
      </div>
    );
  }

  return (
    <div
      ref={slotRef}
      data-os-editor-app={window.id}
      data-testid={`editor-app-${window.id}`}
      className="relative w-full h-full bg-[var(--color-bg)] overflow-hidden"
    >
      <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--color-text-muted)] pointer-events-none">
        Editor slot: {filePath}
      </div>
    </div>
  );
}
