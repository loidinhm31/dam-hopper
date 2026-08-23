import { useEffect, useId, useRef, useState } from "react";
import { Bell, BellOff, CheckCheck, Trash2 } from "lucide-react";
import { dispatchTerminalNotificationSelection } from "@/lib/terminal-notification-navigation.js";
import {
  selectUnreadTerminalNotificationCount,
  useTerminalNotificationsStore,
} from "@/stores/terminal-notifications.js";
import { cn } from "@/lib/utils.js";
import { TerminalNotificationFeedItem } from "@/components/organisms/TerminalNotificationFeedItem.js";

export function TerminalNotificationCenter() {
  const notifications = useTerminalNotificationsStore(
    (state) => state.notifications,
  );
  const markRead = useTerminalNotificationsStore((state) => state.markRead);
  const markAllRead = useTerminalNotificationsStore(
    (state) => state.markAllRead,
  );
  const clearNotifications = useTerminalNotificationsStore(
    (state) => state.clearNotifications,
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const unreadCount = useTerminalNotificationsStore(
    selectUnreadTerminalNotificationCount,
  );

  const closeAndRestoreFocus = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;

    const focusFrame = requestAnimationFrame(() => panelRef.current?.focus());

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectNotification = (id: string, sessionId: string) => {
    markRead(id);
    dispatchTerminalNotificationSelection(sessionId);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "relative inline-flex rounded-sm p-1.5 text-[var(--color-text-muted)] transition-colors",
          "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]",
          open && "bg-[var(--color-primary)]/15 text-[var(--color-primary)]",
        )}
        aria-label={`Terminal notifications, ${unreadCount} unread`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        title="Terminal notifications"
      >
        <Bell aria-hidden="true" size={16} />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-[var(--color-danger)] px-1 text-center text-[9px] font-bold leading-4 text-white shadow-sm">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          ref={panelRef}
          id={panelId}
          role="dialog"
          tabIndex={-1}
          aria-label="Terminal notifications"
          className="glass-card-blur fixed left-1/2 top-[calc(var(--top-nav-height)_+_0.75rem)] z-[75] flex max-h-[min(32rem,calc(var(--app-viewport-height)_-_var(--top-nav-height)_-_var(--safe-area-bottom)_-_1.5rem))] w-[min(24rem,calc(var(--app-viewport-width)_-_1rem_-_var(--safe-area-left)_-_var(--safe-area-right)))] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-[var(--color-border)] shadow-2xl outline-none sm:absolute sm:left-auto sm:right-0 sm:top-9 sm:w-96 sm:translate-x-0"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2.5">
            <div>
              <h2 className="text-xs font-bold text-[var(--color-text)]">
                Terminal notifications
              </h2>
              <p className="text-[10px] text-[var(--color-text-muted)]">
                {unreadCount === 0
                  ? "You’re all caught up"
                  : `${unreadCount} unread`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={markAllRead}
                disabled={unreadCount === 0}
                className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Mark all terminal notifications as read"
                title="Mark all as read"
              >
                <CheckCheck aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                onClick={clearNotifications}
                disabled={notifications.length === 0}
                className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Clear terminal notifications"
                title="Clear notifications"
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </div>
          </div>

          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <BellOff
                aria-hidden="true"
                className="text-[var(--color-text-muted)]/60"
                size={24}
              />
              <p className="text-xs font-semibold text-[var(--color-text)]">
                No notifications yet
              </p>
              <p className="text-[10px] text-[var(--color-text-muted)]">
                Codex terminal updates will appear here.
              </p>
            </div>
          ) : (
            <ul
              className="min-h-0 overflow-y-auto"
              aria-label="Notification history"
            >
              {notifications.map((notification) => (
                <TerminalNotificationFeedItem
                  key={notification.id}
                  notification={notification}
                  onSelect={selectNotification}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
