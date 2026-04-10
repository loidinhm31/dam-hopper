import { Files, Terminal, Search } from "lucide-react";
import { cn } from "@/lib/utils.js";

export type SidebarTab = "files" | "terminals" | "search";

interface Props {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  hideFiles?: boolean;
}

export function SidebarTabSwitcher({ activeTab, onTabChange, hideFiles = false }: Props) {
  return (
    <div className="flex shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {!hideFiles && (
        <button
          onClick={() => onTabChange("files")}
          title="Files"
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold tracking-wide transition-colors border-b-2",
            activeTab === "files"
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          )}
        >
          <Files className="h-3.5 w-3.5" />
          FILES
        </button>
      )}
      {!hideFiles && (
        <button
          onClick={() => onTabChange("search")}
          title="Search"
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold tracking-wide transition-colors border-b-2",
            activeTab === "search"
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          )}
        >
          <Search className="h-3.5 w-3.5" />
          SEARCH
        </button>
      )}
      <button
        onClick={() => onTabChange("terminals")}
        title="Terminals"
        className={cn(
          "flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold tracking-wide transition-colors border-b-2",
          activeTab === "terminals"
            ? "border-[var(--color-primary)] text-[var(--color-primary)]"
            : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        )}
      >
        <Terminal className="h-3.5 w-3.5" />
        TERMINALS
      </button>
    </div>
  );
}
