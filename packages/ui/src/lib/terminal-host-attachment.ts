import {
  cancelScheduledTerminalFit,
  fitTerminalNow,
  scheduleTerminalFit,
} from "@/lib/terminal-fit-scheduler.js";
import { getTerminal, type TerminalEntry } from "@/lib/terminal-registry.js";

const originParents = new WeakMap<HTMLElement, HTMLElement>();

export function parkTerminalElement(
  entry: TerminalEntry,
  fromHost: HTMLElement,
): boolean {
  const element = entry.attachmentElement ?? entry.terminal.element;
  if (!element || element.parentElement !== fromHost) {
    return false;
  }
  const origin = originParents.get(element);
  if (origin) {
    cancelScheduledTerminalFit(entry);
    element.style.display = "none";
    element.style.visibility = "";
    origin.appendChild(element);
    return true;
  }
  return false;
}
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
  // The host only clips the terminal surface; it must never retain an
  // ancestor scroll offset after browser focus/zoom adjustment.
  host.scrollLeft = 0;
  host.scrollTop = 0;

  for (const sessionId of sessionIds) {
    const entry = resolveTerminal(sessionId);
    const element = entry?.attachmentElement ?? entry?.terminal.element;
    if (!entry || !element) continue;

    if (
      element.parentElement &&
      element.parentElement !== host &&
      !originParents.has(element)
    ) {
      originParents.set(element, element.parentElement);
    }

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
