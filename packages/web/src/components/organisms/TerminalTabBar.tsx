import { X } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { SessionInfo } from "@/types/electron.js";

export interface TabEntry {
  sessionId: string;
  label: string;
  session?: SessionInfo;
}

interface Props {
  tabs: TabEntry[];
  activeTab: string | null;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
}

function TabStatusDot({ session }: { session?: SessionInfo }) {
  if (!session) {
    return <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)]/30 shrink-0" />;
  }
  if (session.alive) {
    return <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />;
  }
  if (session.exitCode !== 0 && session.exitCode !== null && session.exitCode !== undefined) {
    return <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />;
  }
  return <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />;
}

export function TerminalTabBar({ tabs, activeTab, onSelectTab, onCloseTab }: Props) {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
      {tabs.map((tab) => {
        const isActive = tab.sessionId === activeTab;
        return (
          <div
            key={tab.sessionId}
            onClick={() => onSelectTab(tab.sessionId)}
            className={cn(
              "group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer shrink-0",
              "border-r border-[var(--color-border)] transition-colors select-none",
              "max-w-40",
              isActive
                ? "bg-[var(--color-background)] text-[var(--color-text)] border-b-2 border-b-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
            )}
          >
            <TabStatusDot session={tab.session} />
            <span className="truncate flex-1 font-mono">{tab.label}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.sessionId); }}
              title="Close tab (does not kill session)"
              className={cn(
                "rounded p-0.5 transition-colors shrink-0",
                "opacity-0 group-hover:opacity-100",
                isActive && "opacity-60",
                "hover:bg-[var(--color-surface-2)] hover:opacity-100",
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
