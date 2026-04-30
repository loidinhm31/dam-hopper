import type { ToolWindowDef } from "@/types/ide.js";
import { ToolPanel } from "./ToolPanel.js";
import { cn } from "@/lib/utils.js";

interface SidebarTopGroupProps {
  tool: ToolWindowDef;
  onClose: () => void;
  style?: React.CSSProperties;
}

export function SidebarTopGroup({ tool, onClose, style }: SidebarTopGroupProps) {
  return (
    <ToolPanel
      tool={tool}
      onClose={onClose}
      style={style}
      className="flex-1"
    />
  );
}
