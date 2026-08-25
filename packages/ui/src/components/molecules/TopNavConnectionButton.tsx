import {
  ConnectionDot,
  type ConnectionStatus,
} from "@/components/atoms/ConnectionDot.js";
import { cn } from "@/lib/utils.js";

interface TopNavConnectionButtonProps {
  activeProfileName?: string;
  compactLabelClass: string;
  compactMobileMenuOpen: boolean;
  devMode: boolean;
  isCompactWorkspace: boolean;
  onClick: () => void;
  status: ConnectionStatus;
}

export function TopNavConnectionButton({
  activeProfileName,
  compactLabelClass,
  compactMobileMenuOpen,
  devMode,
  isCompactWorkspace,
  onClick,
  status,
}: TopNavConnectionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-sm px-2 py-1 transition-colors hover:bg-[var(--color-surface-2)]"
      title={activeProfileName || "Server connection"}
    >
      <ConnectionDot
        status={status}
        collapsed={isCompactWorkspace}
        devMode={devMode}
      />
      {activeProfileName && (
        <span
          className={cn(
            "font-bold tracking-wider text-[var(--color-text-muted)] uppercase",
            isCompactWorkspace
              ? compactMobileMenuOpen
                ? compactLabelClass
                : "hidden"
              : "hidden text-[10px] xl:inline",
          )}
        >
          {activeProfileName}
        </span>
      )}
    </button>
  );
}
