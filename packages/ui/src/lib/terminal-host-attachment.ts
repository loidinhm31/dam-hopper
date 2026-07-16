import {
  cancelScheduledTerminalFit,
  fitTerminalNow,
  scheduleTerminalFit,
} from "@/lib/terminal-fit-scheduler.js";
import {
  getTerminal,
  type TerminalEntry,
} from "@/lib/terminal-registry.js";

interface AttachTerminalsToHostOptions {
  host: HTMLElement;
  sessionIds: Iterable<string>;
  activeSessionId: string | null;
  suppressTerminalFocus?: boolean;
  resolveTerminal?: (sessionId: string) => TerminalEntry | undefined;
}

function applyHostGeometry(element: HTMLElement): void {
  element.style.width = "100%";
  element.style.height = "100%";
  element.style.position = "absolute";
  element.style.inset = "0";
}

export function attachTerminalsToHost({
  host,
  sessionIds,
  activeSessionId,
  suppressTerminalFocus = false,
  resolveTerminal = getTerminal,
}: AttachTerminalsToHostOptions): void {
  for (const sessionId of sessionIds) {
    const entry = resolveTerminal(sessionId);
    const element = entry?.terminal.element;
    if (!entry || !element) continue;

    const isActive = sessionId === activeSessionId;
    const isMovingToHost = element.parentElement !== host;
    if (!isActive || isMovingToHost) {
      entry.findController.close();
    }

    applyHostGeometry(element);
    if (isActive) element.style.visibility = "hidden";
    if (element.parentElement !== host) host.appendChild(element);
    entry.invalidateSuggestionGeometry?.();

    if (!isActive) {
      cancelScheduledTerminalFit(entry);
      element.style.display = "none";
      element.style.visibility = "";
      continue;
    }

    element.style.display = "block";
    fitTerminalNow(entry);
    element.style.visibility = "";
    scheduleTerminalFit(entry, { focus: !suppressTerminalFocus });
  }
}
