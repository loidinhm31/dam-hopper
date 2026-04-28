import { cn } from "@/lib/utils.js";
import type { ToolWindowDef } from "@/types/ide.js";

interface ActivityBarProps {
  tools: ToolWindowDef[];
  activeId: string | null;
  onToggle: (id: string) => void;
  side: 'left' | 'right';
}

export function ActivityBar({ tools, activeId, onToggle, side }: ActivityBarProps) {
  return (
    <div className={cn(
      "w-10 shrink-0 flex flex-col items-center py-2 gap-2 bg-[var(--color-surface)] border-[var(--color-border)]",
      side === 'left' ? "border-r" : "border-l"
    )}>
      {tools.map((tool) => {
        const isActive = activeId === tool.id;
        return (
          <button
            key={tool.id}
            onClick={() => onToggle(tool.id)}
            title={tool.label}
            className={cn(
              "p-2 rounded-sm transition-all group relative",
              isActive 
                ? "text-[var(--color-primary)] bg-[var(--color-primary)]/10" 
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
            )}
          >
            <tool.icon className="h-5 w-5" />
            {isActive && (
              <div className={cn(
                "absolute inset-y-1.5 w-0.5 bg-[var(--color-primary)]",
                side === 'left' ? "left-0" : "right-0"
              )} />
            )}
          </button>
        );
      })}
    </div>
  );
}
