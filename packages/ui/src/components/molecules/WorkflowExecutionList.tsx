import { useState } from "react";
import { Play, Activity, Link as LinkIcon, Terminal } from "lucide-react";
import { getIsoNow } from "@/api/workflow-domain-helpers.js";
import type { LinkDto, ResourceLinkType, SessionDto } from "@/api/workflow-dto-types.js";
import { Button } from "@/components/atoms/Button.js";
import { Input } from "@/components/ui/Input.js";
import { WorkflowSessionCard } from "./WorkflowSessionCard.js";

export interface WorkflowExecutionListProps {
  sessions: SessionDto[];
  links?: Record<string, LinkDto[]>;
  nowMs?: number;
  selectedItemId?: string | null;
  onStartSession?: (startedAt: string, itemId?: string | null) => void;
  onEndSession?: (sessionId: string, endedAt: string) => void;
  onAbandonSession?: (sessionId: string) => void;
  onLinkResource?: (sessionId: string, req: { resourceType: ResourceLinkType; externalId: string; harnessLabel?: string; runId?: string }) => void;
  onUnlinkResource?: (sessionId: string, resourceType: ResourceLinkType, externalId: string) => void;
}

export function WorkflowExecutionList({
  sessions,
  links = {},
  nowMs,
  selectedItemId,
  onStartSession,
  onEndSession,
  onAbandonSession,
  onLinkResource,
  onUnlinkResource,
}: WorkflowExecutionListProps) {
  const [startDraft, setStartDraft] = useState(getIsoNow());
  const [harnessLabel, setHarnessLabel] = useState("");
  const [harnessRunId, setHarnessRunId] = useState("");
  const [terminalId, setTerminalId] = useState("");

  const runningSessions = sessions.filter((s) => s.status === "running");
  const pastSessions = sessions.filter((s) => s.status !== "running");
  const primaryRunningSession = runningSessions[0];

  const handleStartSubmit = () => {
    onStartSession?.(startDraft, selectedItemId);
    setStartDraft(getIsoNow());
  };

  const handleLinkHarnessSubmit = () => {
    if (!primaryRunningSession || !harnessLabel.trim() || !harnessRunId.trim()) return;
    onLinkResource?.(primaryRunningSession.id, {
      resourceType: "agent",
      externalId: harnessRunId.trim(),
      harnessLabel: harnessLabel.trim(),
      runId: harnessRunId.trim(),
    });
    setHarnessLabel("");
    setHarnessRunId("");
  };

  const handleLinkTerminalSubmit = () => {
    if (!primaryRunningSession || !terminalId.trim()) return;
    onLinkResource?.(primaryRunningSession.id, {
      resourceType: "terminal",
      externalId: terminalId.trim(),
    });
    setTerminalId("");
  };

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-hidden text-xs">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--color-text)]">
          <Activity className="h-4 w-4 text-[var(--color-primary)]" />
          <span>Execution</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/30 p-2">
        <span className="font-semibold text-[var(--color-text)]">Start New Session</span>
        <div className="flex items-center gap-1.5">
          <Input
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            className="h-7 text-xs font-mono"
            placeholder="ISO start time"
            aria-label="Start timestamp"
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => setStartDraft(getIsoNow())} className="h-7 text-xs">
            Now
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={handleStartSubmit} className="h-7 text-xs">
            <Play className="h-3 w-3" />
            Start
          </Button>
        </div>
      </div>

      {primaryRunningSession && onLinkResource && (
        <div className="flex flex-col gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-[var(--color-text)]">Link Terminal</span>
            <div className="flex items-center gap-1.5">
              <Input
                value={terminalId}
                onChange={(e) => setTerminalId(e.target.value)}
                placeholder="Terminal session ID"
                className="h-7 text-xs font-mono"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleLinkTerminalSubmit}
                disabled={!terminalId.trim()}
                className="h-7 text-xs"
              >
                <Terminal className="h-3 w-3" />
                Link
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-[var(--color-border)]/60 pt-1.5">
            <span className="font-semibold text-[var(--color-text)]">Link Harness / Agent Run</span>
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                value={harnessLabel}
                onChange={(e) => setHarnessLabel(e.target.value)}
                placeholder="Label (e.g. planner)"
                className="h-7 text-xs"
              />
              <Input
                value={harnessRunId}
                onChange={(e) => setHarnessRunId(e.target.value)}
                placeholder="Run ID"
                className="h-7 text-xs"
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleLinkHarnessSubmit}
              disabled={!harnessLabel.trim() || !harnessRunId.trim()}
              className="h-7 text-xs justify-center"
            >
              <LinkIcon className="h-3 w-3" />
              Link Harness Run
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-2">
          {runningSessions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase text-[var(--color-primary)]">
                Running ({runningSessions.length})
              </span>
              {runningSessions.map((s) => (
                <WorkflowSessionCard
                  key={s.id}
                  session={s}
                  links={links[s.id]}
                  nowMs={nowMs}
                  onEndSession={onEndSession}
                  onAbandonSession={onAbandonSession}
                  onUnlinkResource={onUnlinkResource}
                />
              ))}
            </div>
          )}

          {pastSessions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase text-[var(--color-text-muted)]">
                Recent Sessions ({pastSessions.length})
              </span>
              {pastSessions.map((s) => (
                <WorkflowSessionCard
                  key={s.id}
                  session={s}
                  links={links[s.id]}
                  nowMs={nowMs}
                  onUnlinkResource={onUnlinkResource}
                />
              ))}
            </div>
          )}

          {sessions.length === 0 && (
            <div className="p-4 text-center text-xs text-[var(--color-text-muted)]">
              No sessions recorded. Start a session above to track work time.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
