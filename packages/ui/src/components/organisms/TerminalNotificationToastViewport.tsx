import { useEffect } from "react";
import { Bell, X } from "lucide-react";
import { dispatchTerminalNotificationSelection } from "@/lib/terminal-notification-navigation.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";
import type { TerminalAgentNotification } from "@/lib/terminal-notification-signal-parser.js";

interface TerminalNotificationToastProps {
  id: string;
  event: TerminalAgentNotification;
}

function TerminalNotificationToast({
  id,
  event,
}: TerminalNotificationToastProps) {
  const markRead = useTerminalNotificationsStore((state) => state.markRead);
  const dismissToast = useTerminalNotificationsStore(
    (state) => state.dismissToast,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(id), 6_000);
    return () => window.clearTimeout(timer);
  }, [dismissToast, id]);

  const selectNotification = () => {
    markRead(id);
    dispatchTerminalNotificationSelection(event.sessionId);
    dismissToast(id);
  };

  return (
    <article className="glass-card-blur flex overflow-hidden rounded-md border border-[var(--color-border)] shadow-2xl">
      <button
        type="button"
        onClick={selectNotification}
        className="flex min-w-0 flex-1 items-start gap-3 p-3 text-left transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-ring)]"
        aria-label={`${event.title}. Open terminal`}
      >
        <span className="mt-0.5 rounded bg-[var(--color-primary)]/15 p-1.5 text-[var(--color-primary)]">
          <Bell aria-hidden="true" size={14} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-bold text-[var(--color-text)]">
            {event.title}
          </span>
          {event.body && (
            <span className="mt-1 line-clamp-2 block text-[10px] leading-relaxed text-[var(--color-text-muted)]">
              {event.body}
            </span>
          )}
          {event.project && (
            <span className="mt-1.5 block truncate text-[9px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
              {event.project}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={() => dismissToast(id)}
        className="m-1 self-start rounded p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]"
        aria-label={`Dismiss ${event.title} notification`}
      >
        <X aria-hidden="true" size={14} />
      </button>
    </article>
  );
}

export function TerminalNotificationToastViewport() {
  const notifications = useTerminalNotificationsStore(
    (state) => state.notifications,
  );
  const toastIds = useTerminalNotificationsStore((state) => state.toasts);
  const visibleToasts = toastIds
    .slice(0, 3)
    .map((id) => notifications.find((item) => item.id === id))
    .filter((item) => item !== undefined);

  return (
    <aside
      aria-label="Terminal notification alerts"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
      className="pointer-events-none fixed right-[calc(var(--safe-area-right)_+_0.75rem)] top-[calc(var(--top-nav-height)_+_0.75rem)] z-[45] flex max-h-[calc(var(--app-viewport-height)_-_var(--top-nav-height)_-_var(--safe-area-bottom)_-_1.5rem)] w-[min(22rem,calc(var(--app-viewport-width)_-_1.5rem_-_var(--safe-area-left)_-_var(--safe-area-right)))] flex-col gap-2 overflow-y-auto"
    >
      {visibleToasts.map(({ id, event }) => (
        <div key={id} className="pointer-events-auto">
          <TerminalNotificationToast id={id} event={event} />
        </div>
      ))}
    </aside>
  );
}
