import type { ToolWindowDef } from "@/types/ide.js";
import { ToolPanel } from "./ToolPanel.js";

interface SidebarBottomGroupProps {
  tool: ToolWindowDef;
  onClose: () => void;
  style?: React.CSSProperties;
  maximizable?: boolean;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export function SidebarBottomGroup({
  tool,
  onClose,
  style,
  maximizable,
  isMaximized,
  onToggleMaximize,
}: SidebarBottomGroupProps) {
  return (
    <ToolPanel
      tool={tool}
      onClose={onClose}
      style={style}
      className="flex-1"
      maximizable={maximizable}
      isMaximized={isMaximized}
      onToggleMaximize={onToggleMaximize}
    />
  );
}
