import type { ToolWindowDef } from "@/types/ide.js";
import { ToolPanel } from "./ToolPanel.js";

interface SidebarBottomGroupProps {
  tool: ToolWindowDef;
  onClose: () => void;
  style?: React.CSSProperties;
}

export function SidebarBottomGroup({ tool, onClose, style }: SidebarBottomGroupProps) {
  return (
    <ToolPanel
      tool={tool}
      onClose={onClose}
      style={style}
      className="flex-1"
    />
  );
}
