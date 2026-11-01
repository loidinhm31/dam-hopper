/**
 * SessionChangesHost — Top-level modal host dialog mounting SessionChangesPanel.
 * Guarantees keyboard and focus isolation from active terminals underneath.
 */

import React, { useState, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { ConnectionRef } from "@/api/ownership";
import { useSessionChangesEnabled } from "@/api/session-changes-queries";
import { profileQueryKey } from "@/api/query-client";
import { SessionChangesPanel } from "./SessionChangesPanel";
export interface SessionChangesHostProps {
  isOpen: boolean;
  owner: ConnectionRef | null;
  terminalId: string | null;
  terminalIncarnation: string | null;
  ompSessionId: string | null;
  rootId?: string;
  onClose: () => void;
}

export function SessionChangesHost({
  isOpen,
  owner,
  terminalId,
  terminalIncarnation,
  ompSessionId,
  rootId = ".",
  onClose,
}: SessionChangesHostProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const qc = useQueryClient();
  const { enabled: isEnabled, isLoading } = useSessionChangesEnabled(
    owner ?? undefined,
  );

  useEffect(() => {
    if (isOpen && owner && !isLoading && !isEnabled) {
      void qc.cancelQueries({
        queryKey: profileQueryKey(owner, "session-changes"),
      });
      qc.removeQueries({
        queryKey: profileQueryKey(owner, "session-changes"),
      });
      onClose();
    }
  }, [isOpen, owner, isLoading, isEnabled, qc, onClose]);

  if (
    !isOpen ||
    !owner ||
    !terminalId ||
    !terminalIncarnation ||
    !ompSessionId
  ) {
    return null;
  }

  // Fail-closed: require authoritative ON and connected owner before mounting panel
  if (isLoading || !isEnabled) {
    return null;
  }
  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          data-testid="session-changes-overlay"
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          style={
            isMaximized
              ? undefined
              : {
                  resize: "both",
                  minWidth: "580px",
                  minHeight: "380px",
                  maxWidth: "98vw",
                  maxHeight: "96vh",
                }
          }
          className={cn(
            "fixed z-50 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-2xl focus:outline-none overflow-hidden",
            isMaximized
              ? "inset-2 w-auto h-auto max-w-none translate-x-0 translate-y-0"
              : "left-[50%] top-[50%] w-[90vw] max-w-6xl h-[85vh] translate-x-[-50%] translate-y-[-50%]",
          )}
          data-testid="session-changes-host-content"
          onKeyDown={(e) => {
            // Allow children (Monaco, list items) to handle keys, but stop bubble out to document/xterm
            e.stopPropagation();
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            Session Changes Review
          </DialogPrimitive.Title>
          <SessionChangesPanel
            key={`${owner.profileId}:${owner.generation}:${terminalId}:${terminalIncarnation}:${ompSessionId}:${rootId}`}
            owner={owner}
            terminalId={terminalId}
            terminalIncarnation={terminalIncarnation}
            ompSessionId={ompSessionId}
            rootId={rootId}
            isMaximized={isMaximized}
            onToggleMaximize={() => setIsMaximized((prev) => !prev)}
            onClose={onClose}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
