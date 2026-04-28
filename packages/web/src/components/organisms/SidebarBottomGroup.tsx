import type { ToolWindowDef } from "@/types/ide.js";
import { ToolPanel } from "./ToolPanel.js";

interface SidebarBottomGroupProps {
  tool: ToolWindowDef;
  width: number;
  onClose: () => void;
  style?: React.CSSProperties;
}

export function SidebarBottomGroup({ tool, width, onClose, style }: SidebarBottomGroupProps) {
  return (
    <ToolPanel
      tool={tool}
      width={width}
      onClose={onClose}
      style={style}
      className="flex-1"
    />
  );
}
