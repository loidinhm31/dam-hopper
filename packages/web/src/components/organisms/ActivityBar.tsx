import { cn } from "@/lib/utils.js";
import type { ToolWindowDef } from "@/types/ide.js";

interface ActivityBarProps {
  tools: ToolWindowDef[];
  activeTopId: string | null;
  activeBottomId: string | null;
  onToggle: (id: string) => void;
  side: 'left' | 'right';
}

export function ActivityBar({ tools, activeTopId, activeBottomId, onToggle, side }: ActivityBarProps) {
  const topTools = tools.filter(t => !t.position || t.position === 'top');
  const bottomTools = tools.filter(t => t.position === 'bottom');

  const renderTool = (tool: ToolWindowDef) => {
    const isTop = !tool.position || tool.position === 'top';
    const isActive = isTop ? activeTopId === tool.id : activeBottomId === tool.id;
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
  };

  return (
    <div className={cn(
      "w-10 shrink-0 flex flex-col items-center py-2 gap-2 bg-[var(--color-surface)] border-[var(--color-border)]",
      side === 'left' ? "border-r" : "border-l"
    )}>
      <div className="flex flex-col items-center gap-2">
        {topTools.map(renderTool)}
      </div>
      
      <div className="flex-1" />

      <div className="flex flex-col items-center gap-2">
        {bottomTools.map(renderTool)}
      </div>
    </div>
  );
}
