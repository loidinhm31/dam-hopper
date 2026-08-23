import { Maximize2, Minimize2, X } from "lucide-react";
import type { ToolWindowDef } from "@/types/ide.js";
import { cn } from "@/lib/utils.js";

interface ToolPanelProps {
  tool: ToolWindowDef;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
  maximizable?: boolean;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export function ToolPanel({
  tool,
  onClose,
  className,
  style,
  maximizable,
  isMaximized,
  onToggleMaximize,
}: ToolPanelProps) {
  return (
    <div
      style={style}
      className={cn(
        "shrink-0 flex min-h-0 flex-col bg-[var(--color-surface)] overflow-clip w-full",
        className,
      )}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
          {tool.label}
        </span>
        <div className="flex items-center gap-0.5">
          {maximizable && (
            <button
              onClick={onToggleMaximize}
              className="p-1 hover:bg-[var(--color-surface-2)] rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              title={isMaximized ? "Restore panel" : "Maximize panel"}
              aria-label={isMaximized ? "Restore panel" : "Maximize panel"}
            >
              {isMaximized ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--color-surface-2)] rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            title={`Close ${tool.label}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-clip">{tool.content}</div>
    </div>
  );
}
