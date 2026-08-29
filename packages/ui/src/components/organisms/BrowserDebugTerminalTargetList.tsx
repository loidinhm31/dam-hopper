import {
  browserTerminalTargetReason,
  type BrowserTerminalTarget,
} from "@/lib/browser-terminal-handoff.js";
import { TerminalTitleText } from "@/components/atoms/TerminalTitleText.js";

interface BrowserDebugTerminalTargetListProps {
  disabled: boolean;
  selectedId: string | null;
  targets: BrowserTerminalTarget[];
  onSelect: (sessionId: string) => void;
}

export function BrowserDebugTerminalTargetList({
  disabled,
  selectedId,
  targets,
  onSelect,
}: BrowserDebugTerminalTargetListProps) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-xs font-semibold text-[var(--color-text)]">
        Choose a live terminal
      </legend>
      <div className="mt-2 grid gap-1">
        {targets.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Open a live terminal before attaching a browser artifact.
          </p>
        )}
        {targets.map((candidate) => {
          const reason = browserTerminalTargetReason(candidate);
          const id = `browser-terminal-${candidate.sessionId}`;
          return (
            <label
              key={candidate.sessionId}
              className="flex min-w-0 min-h-11 items-center gap-2 rounded border border-[var(--color-border)] px-2 text-xs has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-[var(--color-ring)]"
            >
              <input
                id={id}
                type="radio"
                name="browser-terminal"
                checked={candidate.sessionId === selectedId}
                disabled={reason !== null}
                onChange={() => onSelect(candidate.sessionId)}
                aria-describedby={`${id}-status`}
              />
              <span className="min-w-0 flex-1">
                <span className="block min-w-0">
                  <span className="flex min-w-0 items-center">
                    {candidate.openTitle ? (
                      <TerminalTitleText
                        title={candidate.openTitle}
                        className="min-w-0 flex-1 text-[var(--color-text)]"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">
                        {candidate.label}
                      </span>
                    )}
                  </span>
                  {candidate.current ? (
                    <span className="block min-w-0 truncate text-[var(--color-text)]">
                      {" · Current terminal"}
                    </span>
                  ) : null}
                </span>
                <span
                  id={`${id}-status`}
                  className="block truncate font-mono text-[10px] text-[var(--color-text-muted)]"
                >
                  {reason ?? "Ready"}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
