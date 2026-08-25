import { Menu, X } from "lucide-react";

interface TopNavMenuButtonProps {
  collapsed: boolean;
  onToggle?: () => void;
}

export function TopNavMenuButton({
  collapsed,
  onToggle,
}: TopNavMenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex-shrink-0 rounded-sm p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
      title={collapsed ? "Show menu" : "Hide menu"}
    >
      {collapsed ? <Menu size={16} /> : <X size={16} />}
    </button>
  );
}
