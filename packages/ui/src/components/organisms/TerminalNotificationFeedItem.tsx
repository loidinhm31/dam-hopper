import { cn } from "@/lib/utils.js";
import type { TerminalNotificationRecord } from "@/stores/terminal-notifications.js";

interface TerminalNotificationFeedItemProps {
  notification: TerminalNotificationRecord;
  onSelect: (id: string, sessionId: string) => void;
}

const formatTime = (receivedAt: number) =>
  new Date(receivedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export function TerminalNotificationFeedItem({
  notification: { id, event, read },
  onSelect,
}: TerminalNotificationFeedItemProps) {
  return (
    <li className="border-b border-[var(--color-border)]/70 last:border-b-0">
      <button
        type="button"
        onClick={() => onSelect(id, event.sessionId)}
        aria-label={`${read ? "Read" : "Unread"} terminal notification: ${event.title}`}
        className={cn(
          "relative w-full px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-ring)]",
          !read && "bg-[var(--color-primary)]/[0.06] pl-5",
        )}
      >
        {!read && (
          <span
            className="absolute left-2 top-4 h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]"
            aria-hidden="true"
          />
        )}
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-[var(--color-text)]">
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
          <time
            dateTime={new Date(event.receivedAt).toISOString()}
            aria-label={new Date(event.receivedAt).toLocaleString()}
            className="shrink-0 text-[9px] text-[var(--color-text-muted)]"
          >
            {formatTime(event.receivedAt)}
          </time>
        </span>
      </button>
    </li>
  );
}
