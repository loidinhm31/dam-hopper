import { useEffect, useId, useRef, useState } from "react";
import { Activity, AlertTriangle, Loader2, X } from "lucide-react";
import {
  useHostMetrics,
  useHostResourceAlerts,
  useHostResourceSnapshot,
} from "@/api/queries.js";
import { HostResourceDiagnosis } from "@/components/organisms/HostResourceDiagnosis.js";
import { useHostResourceAlertPresentation } from "@/hooks/use-host-resource-alert-presentation.js";
import { formatAlertState, severityClass } from "@/lib/host-resource-state.js";
import { cn } from "@/lib/utils.js";

export function HostResourcePopover() {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const snapshot = useHostResourceSnapshot();
  const alerts = useHostResourceAlerts(true);
  const legacyMetrics = useHostMetrics(open);
  const alert = snapshot.data?.alert;
  const alertPresentation = useHostResourceAlertPresentation(alert);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;

    const focusFrame = requestAnimationFrame(() => panelRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node))
        closeAndRestoreFocus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      if (event.key === "Tab") {
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable?.[0];
        const last = focusable?.[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const alertLabel = alert ? formatAlertState(alert.state) : "Sampling host";
  const hasConcern = alert && alert.state !== "healthy";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() =>
          setOpen((value) => {
            if (!value) alertPresentation.markRead();
            return !value;
          })
        }
        className={cn(
          "relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-[var(--color-text-muted)] transition-colors",
          "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]",
          open && "bg-[var(--color-primary)]/15 text-[var(--color-primary)]",
        )}
        title={`Host resources: ${alertLabel}`}
        aria-label={`Host resources: ${alertLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <Activity aria-hidden="true" size={16} />
        {(hasConcern || alertPresentation.unreadCount > 0) && (
          <span
            aria-label={`${alertPresentation.unreadCount} unread host incidents`}
            className={cn(
              "absolute -right-0.5 -top-0.5 min-w-4 rounded-full px-1 text-center text-[9px] font-bold leading-4 text-white shadow-sm",
              alertPresentation.unreadCount > 0
                ? "bg-[var(--color-danger)]"
                : cn("bg-current", severityClass(alert?.severity ?? "info")),
            )}
          >
            {alertPresentation.unreadCount > 0
              ? Math.min(alertPresentation.unreadCount, 99)
              : "!"}
          </span>
        )}
      </button>

      {open && (
        <section
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          aria-labelledby={`${panelId}-title`}
          className="glass-card-blur fixed left-1/2 top-[calc(var(--top-nav-height)+0.75rem)] z-[75] flex max-h-[min(38rem,calc(100dvh-var(--top-nav-height)-var(--safe-area-bottom)-1.5rem))] w-[min(26rem,calc(100vw-1rem-var(--safe-area-left)-var(--safe-area-right)))] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-[var(--color-border)] shadow-2xl outline-none sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-[26rem] sm:translate-x-0"
        >
          <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2.5">
            <div className="min-w-0">
              <h2
                id={`${panelId}-title`}
                className="text-xs font-bold text-[var(--color-text)]"
              >
                Host resources
              </h2>
              <p className="truncate text-[10px] text-[var(--color-text-muted)]">
                Read-only monitoring and diagnosis
              </p>
            </div>
            <button
              type="button"
              onClick={closeAndRestoreFocus}
              className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]"
              aria-label="Close host resources"
            >
              <X aria-hidden="true" size={15} />
            </button>
          </header>

          <div className="min-h-0 overflow-y-auto p-3">
            {snapshot.isLoading && (
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-primary)]" />
                Sampling host
              </div>
            )}
            {snapshot.isError && (
              <div className="flex items-center gap-2 text-xs text-[var(--color-danger)]">
                <AlertTriangle className="h-3.5 w-3.5" />
                Resource snapshot unavailable
              </div>
            )}
            {snapshot.data && (
              <HostResourceDiagnosis
                snapshot={snapshot.data}
                alerts={alerts.data ?? []}
                legacyMetrics={legacyMetrics.data}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
