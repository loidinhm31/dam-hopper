export const TERMINAL_NOTIFICATION_SELECT_EVENT =
  "dam-hopper:terminal-notification-select";

export class TerminalNotificationSelectEvent extends Event {
  constructor(readonly sessionId: string) {
    super(TERMINAL_NOTIFICATION_SELECT_EVENT);
  }
}

export function dispatchTerminalNotificationSelection(
  sessionId: string,
  target: EventTarget = window,
): void {
  target.dispatchEvent(new TerminalNotificationSelectEvent(sessionId));
}

export function subscribeToTerminalNotificationSelection(
  listener: (sessionId: string) => void,
  target: EventTarget = window,
): () => void {
  const handleSelection = (event: Event) => {
    if (event instanceof TerminalNotificationSelectEvent) {
      listener(event.sessionId);
    }
  };

  target.addEventListener(TERMINAL_NOTIFICATION_SELECT_EVENT, handleSelection);
  return () =>
    target.removeEventListener(
      TERMINAL_NOTIFICATION_SELECT_EVENT,
      handleSelection,
    );
}

export function isTerminalNotificationTargetAvailable(
  sessionId: string,
  mountedSessionIds: readonly string[],
  alive: boolean | undefined,
): boolean {
  return alive === true && mountedSessionIds.includes(sessionId);
}

export interface NavigateToTerminalNotificationOptions {
  sessionId: string;
  mountedSessionIds: readonly string[];
  alive: boolean | undefined;
  focusWindow: () => void;
  revealTerminal: () => void;
  selectSession: (sessionId: string) => void;
  focusTerminal: (sessionId: string) => void;
}

export function navigateToTerminalNotification({
  sessionId,
  mountedSessionIds,
  alive,
  focusWindow,
  revealTerminal,
  selectSession,
  focusTerminal,
}: NavigateToTerminalNotificationOptions): boolean {
  if (
    !isTerminalNotificationTargetAvailable(sessionId, mountedSessionIds, alive)
  ) {
    return false;
  }

  focusWindow();
  revealTerminal();
  selectSession(sessionId);
  focusTerminal(sessionId);
  return true;
}

export interface ActivateTerminalAfterNavigationOptions {
  sessionId: string;
  hasTerminal: (sessionId: string) => boolean;
  activateTerminal: (sessionId: string) => void;
  subscribeToTerminal: (listener: (sessionId: string) => void) => () => void;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (frameId: number) => void;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export function activateTerminalAfterNavigation({
  sessionId,
  hasTerminal,
  activateTerminal,
  subscribeToTerminal,
  requestFrame = requestAnimationFrame,
  cancelFrame = (frameId) => globalThis.cancelAnimationFrame?.(frameId),
  setTimer = setTimeout,
  clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: ActivateTerminalAfterNavigationOptions): () => void {
  let disposed = false;
  let timer: unknown;
  let unsubscribe = () => {};
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelFrame(frameId);
    clearTimer(timer);
    unsubscribe();
  };
  const frameId = requestFrame(() => {
    if (disposed) return;

    unsubscribe = subscribeToTerminal((registeredSessionId) => {
      if (registeredSessionId !== sessionId || !hasTerminal(sessionId)) return;
      activateTerminal(sessionId);
      dispose();
    });
    timer = setTimer(dispose, 2_000);

    // Activate the current entry, but keep listening in case navigation remounts it.
    if (hasTerminal(sessionId)) activateTerminal(sessionId);
  });

  return dispose;
}
