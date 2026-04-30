import { X } from "lucide-react";
import type { ToolWindowDef } from "@/types/ide.js";
import { cn } from "@/lib/utils.js";

interface ToolPanelProps {
  tool: ToolWindowDef;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ToolPanel({ tool, onClose, className, style }: ToolPanelProps) {
  return (
    <div 
      style={style} 
      className={cn("shrink-0 flex flex-col bg-[var(--color-surface)] overflow-hidden w-full", className)}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
          {tool.label}
        </span>
        <button 
          onClick={onClose} 
          className="p-1 hover:bg-[var(--color-surface-2)] rounded-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          title={`Close ${tool.label}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tool.content}
      </div>
    </div>
  );
}
