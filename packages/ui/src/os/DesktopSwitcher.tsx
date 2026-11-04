import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from "react";
import { useWindowStore } from "./window-store.js";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.js";

export interface DesktopSwitcherProps {
  className?: string;
}

export function DesktopSwitcher({ className = "" }: DesktopSwitcherProps) {
  const session = useWindowStore((state) => state.session);
  const switchDesktop = useWindowStore((state) => state.switchDesktop);
  const addDesktop = useWindowStore((state) => state.addDesktop);
  const renameDesktop = useWindowStore((state) => state.renameDesktop);
  const removeDesktop = useWindowStore((state) => state.removeDesktop);

  const [confirmDelete, setConfirmDelete] = useState<{
    desktopId: string;
    desktopName: string;
    survivingId: string;
    survivingName: string;
    windowCount: number;
  } | null>(null);
  const [editingDesktopId, setEditingDesktopId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingDesktopId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingDesktopId]);

  const handleStartRename = (desktopId: string, currentName: string) => {
    setEditingDesktopId(desktopId);
    setEditingName(currentName);
  };

  const handleCommitRename = () => {
    if (editingDesktopId && editingName.trim()) {
      renameDesktop(editingDesktopId, editingName.trim());
    }
    setEditingDesktopId(null);
  };

  const handleKeyDownInput = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleCommitRename();
    } else if (e.key === "Escape") {
      setEditingDesktopId(null);
    }
  };

  const handleAddDesktop = useCallback(() => {
    addDesktop();
  }, [addDesktop]);

  return (
    <nav
      role="tablist"
      aria-label="Virtual Desktops"
      className={`flex items-center gap-1 overflow-x-auto select-none ${className}`}
    >
      {session.desktops.map((d, index) => {
        const isActive = d.id === session.activeDesktopId;
        const ordinal = index + 1;
        const isEditing = editingDesktopId === d.id;

        // Count windows on this desktop
        const desktopWindows = Object.values(session.windows).filter(
          (w) => w.desktopId === d.id,
        );
        const hasWindows = desktopWindows.length > 0;

        if (isEditing) {
          return (
            <div
              key={d.id}
              className="flex items-center px-1.5 py-0.5 rounded border border-[var(--color-primary)] bg-[var(--color-surface)]"
            >
              <input
                ref={inputRef}
                type="text"
                aria-label={`Rename desktop ${d.name}`}
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={handleCommitRename}
                onKeyDown={handleKeyDownInput}
                className="w-20 text-xs bg-transparent text-[var(--color-text)] outline-none"
              />
            </div>
          );
        }

        return (
          <div
            key={d.id}
            className={`group relative flex items-center rounded transition-colors ${
              isActive
                ? "bg-[var(--color-primary)] text-white font-medium shadow-sm"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`desktop-canvas-${d.id}`}
              onClick={() => switchDesktop(d.id)}
              onDoubleClick={() => handleStartRename(d.id, d.name)}
              className="px-2.5 py-1 text-xs truncate max-w-[120px] focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              <span className="opacity-70 mr-1">{ordinal}:</span>
              <span>{d.name}</span>
            </button>

            {/* Quick delete button on hover if >1 desktop exists */}
            {session.desktops.length > 1 && (
              <button
                type="button"
                aria-label={`Close desktop ${d.name}`}
                title="Close desktop (migrates windows to another desktop)"
                onClick={(e) => {
                  e.stopPropagation();
                  const otherDesktops = session.desktops.filter(
                    (other) => other.id !== d.id,
                  );
                  const surviving = otherDesktops[0];
                  if (!surviving) return;
                  if (hasWindows) {
                    setConfirmDelete({
                      desktopId: d.id,
                      desktopName: d.name,
                      survivingId: surviving.id,
                      survivingName: surviving.name,
                      windowCount: desktopWindows.length,
                    });
                    return;
                  }
                  removeDesktop(d.id, surviving.id);
                }}
                className="opacity-0 group-hover:opacity-100 mr-1 p-0.5 rounded text-[10px] hover:bg-black/20 transition-opacity"
              >
                ✕
              </button>
            )}

            {/* Small indicator dot if desktop has windows and is not active */}
            {!isActive && hasWindows && (
              <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--color-text-muted)]" />
            )}
          </div>
        );
      })}

      <button
        type="button"
        aria-label="Add Desktop"
        title="Add new virtual desktop"
        onClick={handleAddDesktop}
        className="px-2 py-1 rounded text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] transition-colors"
      >
        +
      </button>
      {confirmDelete && (
        <ConfirmDialog
          open={Boolean(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            if (
              confirmDelete &&
              session.desktops.some((d) => d.id === confirmDelete.desktopId) &&
              session.desktops.some((d) => d.id === confirmDelete.survivingId)
            ) {
              removeDesktop(confirmDelete.desktopId, confirmDelete.survivingId);
            }
            setConfirmDelete(null);
          }}
          title="Close Virtual Desktop?"
          description={`Desktop "${confirmDelete.desktopName}" contains ${confirmDelete.windowCount} window(s). Move them to "${confirmDelete.survivingName}" and close desktop?`}
          confirmText="Move Windows & Close"
          cancelText="Cancel"
          variant="danger"
        />
      )}
    </nav>
  );
}
