import { useMemo, useRef, useEffect } from "react";
import {
  useOsNotificationStore,
  redactNotification,
  type OsNotificationEntry,
} from "./notifications.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useWindowStore } from "./window-store.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";

export interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

const LEVEL_COLORS: Record<string, string> = {
  info: "text-[var(--color-primary)] border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10",
  warning: "text-[var(--color-warning)] border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10",
  error: "text-[var(--color-error)] border-[var(--color-error)]/30 bg-[var(--color-error)]/10",
  attention: "text-[var(--color-warning)] border-[var(--color-warning)] bg-[var(--color-warning)]/20 animate-pulse",
};

export function NotificationCenter({
  isOpen,
  onClose,
  className = "",
}: NotificationCenterProps) {
  const entries = useOsNotificationStore((state) => state.entries);
  const markRead = useOsNotificationStore((state) => state.markRead);
  const markAllRead = useOsNotificationStore((state) => state.markAllRead);
  const clearAll = useOsNotificationStore((state) => state.clearAll);
  const isCognitoActive = useCognitoModeStore((state) => state.active);
  const terminalNotifs = useTerminalNotificationsStore(
    (state) => state.notifications,
  );
  const markTerminalRead = useTerminalNotificationsStore(
    (state) => state.markRead,
  );
  const clearTerminalNotifs = useTerminalNotificationsStore(
    (state) => state.clearNotifications,
  );

  const session = useWindowStore((state) => state.session);
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const switchDesktop = useWindowStore((state) => state.switchDesktop);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !target?.closest?.('[data-os-nonmodal-trigger="notification-center"]')
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const displayEntries = useMemo(() => {
    const osList = entries.map((entry) =>
      redactNotification(entry, isCognitoActive),
    );
    const termList = terminalNotifs.map((tn) => {
      const entry: OsNotificationEntry = {
        id: tn.id,
        profileId: tn.event.profileId ?? "default",
        generation: 1,
        title: tn.event.title,
        body: tn.event.body,
        source: "terminal",
        level:
          tn.event.status === "needs-attention" ? "attention" : "info",
        timestamp: tn.event.receivedAt,
        read: tn.read,
        targetTerminalId: tn.event.sessionId,
        targetProject: tn.event.project,
      };
      return redactNotification(entry, isCognitoActive);
    });
    return [...osList, ...termList].sort((a, b) => b.timestamp - a.timestamp);
  }, [entries, terminalNotifs, isCognitoActive]);

  const handleSelectEntry = (entry: OsNotificationEntry) => {
    markRead(entry.id);
    markTerminalRead(entry.id);

    let targetWin = entry.targetWindowId
      ? session.windows[entry.targetWindowId]
      : undefined;
    if (!targetWin && entry.targetTerminalId) {
      targetWin = Object.values(session.windows).find(
        (w) =>
          w.appId === "terminals" &&
          w.ctx.profileId === entry.profileId &&
          (w.appState?.sessionId === entry.targetTerminalId ||
            !entry.targetTerminalId),
      );
    }

    if (targetWin) {
      if (targetWin.desktopId !== session.activeDesktopId) {
        switchDesktop(targetWin.desktopId);
      }
      if (targetWin.minimized) {
        restoreWindow(targetWin.id);
      }
      focusWindow(targetWin.id);
      onClose();
    }
  };

  const handleClearAll = () => {
    clearAll();
    clearTerminalNotifs();
  };

  const handleMarkAllRead = () => {
    markAllRead();
    for (const tn of terminalNotifs) {
      markTerminalRead(tn.id);
    }
  };
  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Notification Center"
      data-os-nonmodal-surface="notification-center"
      className={`fixed right-3 top-[calc(var(--os-topbar-height)+6px)] w-80 max-h-[480px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl z-50 flex flex-col text-xs select-none ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[var(--color-text)]">
            Notifications
          </span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--color-surface)] text-[var(--color-text-muted)] font-mono">
            {displayEntries.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {displayEntries.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="px-1.5 py-0.5 rounded text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
              >
                Mark all read
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="px-1.5 py-0.5 rounded text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-surface-hover)]"
              >
                Clear
              </button>
            </>
          )}
          <button
            type="button"
            aria-label="Close notification center"
            onClick={onClose}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Entry list */}
      <div
        role="feed"
        aria-label="Recent notifications"
        className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1"
      >
        {displayEntries.length === 0 ? (
          <div className="py-8 text-center text-[var(--color-text-muted)]">
            No notifications
          </div>
        ) : (
          displayEntries.map((entry) => {
            const levelStyle =
              LEVEL_COLORS[entry.level] ?? LEVEL_COLORS.info;
            return (
              <div
                key={entry.id}
                role="article"
                onClick={() => handleSelectEntry(entry)}
                className={`flex flex-col gap-1 p-2 rounded-lg border cursor-pointer transition-colors ${
                  entry.read
                    ? "border-[var(--color-border)]/50 bg-transparent text-[var(--color-text-muted)] opacity-75"
                    : "border-[var(--color-border)] bg-[var(--color-surface-hover)] text-[var(--color-text)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className={`px-1 py-0.2 rounded text-[9px] uppercase font-mono border ${levelStyle}`}
                    >
                      {entry.level}
                    </span>
                    <span className="font-medium truncate">{entry.title}</span>
                  </div>
                  <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 font-mono">
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {entry.body && (
                  <p className="text-[11px] text-[var(--color-text-muted)] line-clamp-2">
                    {entry.body}
                  </p>
                )}
                {entry.targetProject && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                      {entry.targetProject}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
