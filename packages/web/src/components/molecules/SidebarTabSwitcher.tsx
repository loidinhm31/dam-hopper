import { Files, Terminal, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils.js";

export type SidebarTab = "files" | "terminals" | "changes";

interface TabDef {
  id: SidebarTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hidden?: boolean;
}

interface Props {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  hideFiles?: boolean;
  changesCount?: number;
}

export function SidebarTabSwitcher({ activeTab, onTabChange, hideFiles = false, changesCount }: Props) {
  const tabs: TabDef[] = [
    { id: "files", label: "FILES", icon: Files, hidden: hideFiles },
    { id: "terminals", label: "TERMINALS", icon: Terminal },
    { id: "changes", label: "CHANGES", icon: GitCompareArrows },
  ];

  return (
    <div className="flex shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {tabs.filter((t) => !t.hidden).map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onTabChange(id)}
          title={label}
          className={cn(
            "flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-semibold tracking-wide transition-colors border-b-2",
            activeTab === id
              ? "border-[var(--color-primary)] text-[var(--color-primary)]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
          {id === "changes" && changesCount !== undefined && changesCount > 0 && (
            <span className="ml-0.5 rounded-sm bg-[var(--color-warning)]/20 border border-[var(--color-warning)]/30 px-1 text-[9px] text-[var(--color-warning)]">
              {changesCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
