import { ChevronUp, ChevronDown } from "lucide-react";
import { terminalRegistry } from "@/lib/terminal-registry.js";
import { useSettingsStore } from "@/stores/settings.js";
import { cn } from "@/lib/utils.js";

interface TerminalScrollButtonsProps {
  sessionId: string;
  className?: string;
}

export function TerminalScrollButtons({
  sessionId,
  className,
}: TerminalScrollButtonsProps) {
  const terminalScrollStep = useSettingsStore((s) => s.terminalScrollStep);

  const handleScrollUp = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const entry = terminalRegistry.get(sessionId);
    if (entry) {
      entry.terminal.scrollLines(-terminalScrollStep);
    }
  };

  const handleScrollDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const entry = terminalRegistry.get(sessionId);
    if (entry) {
      entry.terminal.scrollLines(terminalScrollStep);
    }
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
        onClick={handleScrollUp}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-sm text-[var(--color-text)] shadow-lg transition-colors hover:bg-[var(--color-surface)] active:bg-[var(--color-border)]"
        title="Scroll Up"
        aria-label="Scroll Up"
      >
        <ChevronUp className="h-5 w-5" />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleScrollDown}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]/80 backdrop-blur-sm text-[var(--color-text)] shadow-lg transition-colors hover:bg-[var(--color-surface)] active:bg-[var(--color-border)]"
        title="Scroll Down"
        aria-label="Scroll Down"
      >
        <ChevronDown className="h-5 w-5" />
      </button>
    </div>
  );
}
