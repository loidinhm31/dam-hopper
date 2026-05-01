import { useRef, useEffect } from "react";
import { X, Save } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { SessionInfo } from "@/api/client.js";

export interface TabEntry {
  sessionId: string;
  label: string;
  session?: SessionInfo;
  /** Whether this terminal session can be saved as a new profile */
  isSaveable?: boolean;
}

interface SavePromptState {
  sessionId: string;
  name: string;
  error?: string;
}

interface Props {
  tabs: TabEntry[];
  activeTab: string | null;
  onSelectTab: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  savePrompt?: SavePromptState | null;
  onSaveTab?: (sessionId: string) => void;
  onSavePromptChange?: (name: string) => void;
  onSavePromptSubmit?: () => void;
  onSavePromptCancel?: () => void;
}

function TabStatusDot({ session }: { session?: SessionInfo }) {
  if (!session) {
    return <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)]/30 shrink-0" />;
  }
  if (session.alive) {
    return <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] status-glow-green shrink-0" />;
  }
  if (session.exitCode !== 0 && session.exitCode !== null && session.exitCode !== undefined) {
    return <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-danger)] status-glow-red shrink-0" />;
  }
  return <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)] status-glow-orange shrink-0" />;
}

export function TerminalTabBar({
  tabs,
  activeTab,
  onSelectTab,
  onCloseTab,
  savePrompt,
  onSaveTab,
  onSavePromptChange,
  onSavePromptSubmit,
  onSavePromptCancel,
}: Props) {
  const saveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (savePrompt) {
      saveInputRef.current?.focus();
    }
  }, [savePrompt?.sessionId]);

  if (tabs.length === 0) {
    return null;
  }

  const activeTab_ = tabs.find((t) => t.sessionId === activeTab);
  const showSaveButton = activeTab_?.isSaveable && onSaveTab && activeTab;

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
      {/* Tab strip */}
      <div className="flex items-center overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.sessionId === activeTab;
          const cwdTooltip = tab.session?.cwd ? `cwd: ${tab.session.cwd}` : undefined;
          return (
            <div
              key={tab.sessionId}
              onClick={() => onSelectTab(tab.sessionId)}
              title={cwdTooltip}
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
                title="Close terminal (terminates process)"
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

        {/* Save button for saveable terminal sessions */}
        {showSaveButton && !savePrompt && (
          <button
            type="button"
            onClick={() => onSaveTab!(activeTab!)}
            title="Save as profile"
            className={cn(
              "flex items-center gap-1 px-2 py-1.5 text-xs shrink-0 ml-auto",
              "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
              "hover:bg-[var(--color-surface-2)] transition-colors",
            )}
          >
            <Save className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Inline save-as-profile prompt */}
      {savePrompt && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <span className="text-xs text-[var(--color-text-muted)] shrink-0">Save as:</span>
          <div className="flex-1 min-w-0">
            <input
              ref={saveInputRef}
              type="text"
              placeholder="Profile name (no colons)"
              value={savePrompt.name}
              onChange={(e) => onSavePromptChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSavePromptSubmit?.();
                if (e.key === "Escape") onSavePromptCancel?.();
              }}
              className={cn(
                "w-full bg-transparent border rounded px-2 py-0.5 text-xs text-[var(--color-text)] outline-none transition-colors",
                savePrompt.error
                  ? "border-[var(--color-danger)] focus:border-[var(--color-danger)]"
                  : "border-[var(--color-border)] focus:border-[var(--color-primary)]",
              )}
            />
            {savePrompt.error && (
              <p className="text-[10px] text-[var(--color-danger)] mt-0.5">{savePrompt.error}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onSavePromptSubmit}
            className="text-xs px-2 py-0.5 rounded bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity shrink-0"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onSavePromptCancel}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
