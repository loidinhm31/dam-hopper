import { useState } from "react";
import { Clock, Check, Ban, Terminal, Cpu, AlertTriangle } from "lucide-react";
import { formatElapsedDuration, getIsoNow, validateSessionInterval } from "@/api/workflow-domain-helpers.js";
import type { LinkDto, ResourceLinkType, SessionDto } from "@/api/workflow-dto-types.js";
import { Button } from "@/components/atoms/Button.js";
import { Input } from "@/components/ui/Input.js";

export interface WorkflowSessionCardProps {
  session: SessionDto;
  links?: LinkDto[];
  nowMs?: number;
  onEndSession?: (sessionId: string, endedAt: string) => void;
  onAbandonSession?: (sessionId: string) => void;
  onUnlinkResource?: (sessionId: string, resourceType: ResourceLinkType, externalId: string) => void;
}

export function WorkflowSessionCard({
  session,
  links = [],
  nowMs,
  onEndSession,
  onAbandonSession,
  onUnlinkResource,
}: WorkflowSessionCardProps) {
  const isRunning = session.status === "running";
  const [endDraft, setEndDraft] = useState(getIsoNow());
  const [error, setError] = useState<string | null>(null);

  const durationText = formatElapsedDuration(session.startedAt, session.endedAt, nowMs);

  const suggestedLink = links.find((l) => l.suggestedEndTime);

  const handleEndSubmit = () => {
    const val = validateSessionInterval(session.startedAt, endDraft);
    if (!val.valid) {
      setError(val.error ?? "Invalid end time");
      return;
    }
    setError(null);
    onEndSession?.(session.id, endDraft);
  };

  return (
    <div
      className="flex flex-col gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-xs shadow-xs"
      data-session-id={session.id}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          <span className="font-semibold text-[var(--color-text)]">
            {isRunning ? "Active Session" : `Session (${session.status})`}
          </span>
          <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-muted)]">
            {durationText}
          </span>
        </div>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {new Date(session.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {links.length > 0 && (
        <div className="flex flex-col gap-1 rounded bg-[var(--color-surface-2)]/40 p-1.5">
          <span className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">
            Linked Resources
          </span>
          {links.map((link) => (
            <div key={link.id} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1">
                {link.resourceType === "terminal" ? (
                  <Terminal className="h-3 w-3 text-[var(--color-text-muted)]" />
                ) : (
                  <Cpu className="h-3 w-3 text-[var(--color-text-muted)]" />
                )}
                <span>{link.harnessLabel || link.externalId}</span>
                {link.observedState !== "attached" && (
                  <span className="text-[10px] text-[var(--color-warning)]">({link.observedState})</span>
                )}
              </div>
              {onUnlinkResource && (
                <button
                  type="button"
                  onClick={() => onUnlinkResource(session.id, link.resourceType, link.externalId)}
                  className="text-[10px] text-[var(--color-danger)] hover:underline cursor-pointer"
                >
                  Unlink
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {isRunning && (
        <div className="flex flex-col gap-1.5 border-t border-[var(--color-border)]/60 pt-2">
          {suggestedLink && (
            <div className="flex items-center justify-between rounded bg-[var(--color-info)]/10 px-2 py-1 text-[11px] text-[var(--color-info)]">
              <span className="truncate">Suggested end: {new Date(suggestedLink.suggestedEndTime!).toLocaleTimeString()}</span>
              <button
                type="button"
                onClick={() => setEndDraft(suggestedLink.suggestedEndTime!)}
                className="font-semibold underline hover:opacity-80 cursor-pointer shrink-0 ml-1"
              >
                Use suggestion
              </button>
            </div>
          )}

          {error && <div className="text-[10px] text-[var(--color-danger)]">{error}</div>}

          <div className="flex items-center gap-1.5">
            <Input
              value={endDraft}
              onChange={(e) => setEndDraft(e.target.value)}
              className="h-7 text-xs font-mono"
              placeholder="ISO end time"
              aria-label="End timestamp"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEndDraft(getIsoNow())}
              className="h-7 text-xs"
            >
              Now
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleEndSubmit}
              className="h-7 text-xs"
              aria-label="End session"
            >
              <Check className="h-3.5 w-3.5" />
              End
            </Button>
            {onAbandonSession && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => onAbandonSession(session.id)}
                className="h-7 text-xs"
                title="Abandon session"
              >
                <Ban className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
