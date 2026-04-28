import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface ToolWindowDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The content to render inside the tool panel */
  content: ReactNode;
  /** Optional: Preferred side if not specified in layout */
  defaultSide?: 'left' | 'right';
}
