import type { ToolWindowDef } from "@/types/ide.js";
import { ToolPanel } from "./ToolPanel.js";
import { cn } from "@/lib/utils.js";

interface SidebarTopGroupProps {
  tool: ToolWindowDef;
  width: number;
  onClose: () => void;
  style?: React.CSSProperties;
  hasBottomTool?: boolean;
}

export function SidebarTopGroup({ tool, width, onClose, style, hasBottomTool }: SidebarTopGroupProps) {
  return (
    <ToolPanel
      tool={tool}
      width={width}
      onClose={onClose}
      style={style}
      className={cn(hasBottomTool ? "border-b border-[var(--color-border)]" : "flex-1")}
    />
  );
}
