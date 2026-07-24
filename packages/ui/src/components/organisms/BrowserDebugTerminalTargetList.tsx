import {
  browserTerminalTargetReason,
  type BrowserTerminalTarget,
} from "@/lib/browser-terminal-handoff.js";

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
        {targets.map((target) => {
          const reason = browserTerminalTargetReason(target);
          const id = `browser-terminal-${target.sessionId}`;
          return (
            <label
              key={target.sessionId}
              className="flex min-h-11 items-center gap-2 rounded border border-[var(--color-border)] px-2 text-xs has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-[var(--color-ring)]"
            >
              <input
                id={id}
                type="radio"
                name="browser-terminal"
                checked={target.sessionId === selectedId}
                disabled={reason !== null}
                onChange={() => onSelect(target.sessionId)}
                aria-describedby={`${id}-status`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--color-text)]">
                  {target.label}
                  {target.current ? " · Current terminal" : ""}
                </span>
                <span
                  id={`${id}-status`}
                  className="block truncate font-mono text-[10px] text-[var(--color-text-muted)]"
                >
                  {reason ?? target.sessionId}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
