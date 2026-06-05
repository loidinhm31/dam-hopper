import { ChevronsDown, ChevronsUp } from "lucide-react";
import { terminalRegistry } from "@/lib/terminal-registry.js";
import { cn } from "@/lib/utils.js";
import { useSettingsStore } from "@/stores/settings.js";

interface TerminalScrollButtonsProps {
  sessionId: string;
  className?: string;
}

export function TerminalScrollButtons({
  sessionId,
  className,
}: TerminalScrollButtonsProps) {
  const terminalScrollStep = useSettingsStore((s) => s.terminalScrollStep);

  const handleScrollToTop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    terminalRegistry.get(sessionId)?.terminal.scrollToTop();
  };

  const handleScrollUp = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    terminalRegistry.get(sessionId)?.terminal.scrollLines(-terminalScrollStep);
  };

  const handleScrollDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    terminalRegistry.get(sessionId)?.terminal.scrollLines(terminalScrollStep);
  };

  const handleScrollToBottom = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    terminalRegistry.get(sessionId)?.terminal.scrollToBottom();
  };

  return (
    <div
      className={cn(
        "absolute right-4 bottom-4 flex flex-col gap-2 z-10",
        className
      )}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleScrollToTop}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-sm text-[var(--color-text)] shadow-lg transition-colors hover:bg-[var(--color-surface)] active:bg-[var(--color-border)]"
        title="Jump to top"
        aria-label="Jump to top"
      >
        <ChevronsUp className="h-5 w-5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleScrollUp}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-sm text-[var(--color-text)] shadow-lg transition-colors hover:bg-[var(--color-surface)] active:bg-[var(--color-border)]"
        title={`Scroll up ${terminalScrollStep} lines`}
        aria-label={`Scroll up ${terminalScrollStep} lines`}
      >
        <span className="text-base leading-none">^</span>
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleScrollDown}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-sm text-[var(--color-text)] shadow-lg transition-colors hover:bg-[var(--color-surface)] active:bg-[var(--color-border)]"
        title={`Scroll down ${terminalScrollStep} lines`}
        aria-label={`Scroll down ${terminalScrollStep} lines`}
      >
        <span className="text-base leading-none">v</span>
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleScrollToBottom}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-sm text-[var(--color-text)] shadow-lg transition-colors hover:bg-[var(--color-surface)] active:bg-[var(--color-border)]"
        title="Jump to bottom"
        aria-label="Jump to bottom"
      >
        <ChevronsDown className="h-5 w-5" />
      </button>
    </div>
  );
}
