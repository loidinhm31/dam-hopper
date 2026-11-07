import { useWindowStore } from "@/os/window-store.js";
import { ExternalLink, Terminal } from "lucide-react";

export interface HubTerminalClaimPlaceholderProps {
  sessionLabel?: string;
  reason: "claimed-elsewhere" | "legacy-presenter" | "unresolved";
  holderWindowId?: string;
}

export function HubTerminalClaimPlaceholder({
  sessionLabel,
  reason,
  holderWindowId,
}: HubTerminalClaimPlaceholderProps) {
  const handleReveal = () => {
    if (holderWindowId) {
      useWindowStore.getState().revealWindow(holderWindowId);
    }
  };

  if (reason === "unresolved") {
    return (
      <div
        data-testid="hub-terminal-claim-placeholder"
        data-claim-reason="unresolved"
        className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-[var(--color-background)] text-[var(--color-text-muted)]"
      >
        <Terminal className="h-10 w-10 opacity-20" />
        <div className="flex flex-col gap-1 max-w-sm">
          <p className="text-sm font-medium text-[var(--color-text)]">
            Terminal session unresolved
          </p>
          <p className="text-xs">
            {sessionLabel
              ? `Session "${sessionLabel}" is not currently available in inventory.`
              : "The requested terminal session is not available in inventory."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="hub-terminal-claim-placeholder"
      data-claim-reason={reason}
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center bg-[var(--color-background)] text-[var(--color-text-muted)]"
    >
      <Terminal className="h-10 w-10 opacity-20" />
      <div className="flex flex-col gap-1 max-w-sm">
        <p className="text-sm font-medium text-[var(--color-text)]">
          Terminal open in another window
        </p>
        <p className="text-xs">
          {sessionLabel
            ? `Session "${sessionLabel}" is currently active in another window.`
            : "This terminal session is currently active in another window."}
        </p>
      </div>
      {holderWindowId && (
        <button
          type="button"
          onClick={handleReveal}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-text)] border border-[var(--color-border)] rounded transition-colors shadow-sm cursor-pointer"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Go to window
        </button>
      )}
    </div>
  );
}
