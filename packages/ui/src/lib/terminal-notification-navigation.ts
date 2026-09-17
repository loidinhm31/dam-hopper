import type { TerminalRef } from "@/api/ownership.js";

export const TERMINAL_NOTIFICATION_SELECT_EVENT =
  "dam-hopper:terminal-notification-select";

export class TerminalNotificationSelectEvent extends Event {
  constructor(
    readonly sessionId: string,
    readonly profileId?: string,
    readonly terminalRef?: TerminalRef,
  ) {
    super(TERMINAL_NOTIFICATION_SELECT_EVENT);
  }
}

export function dispatchTerminalNotificationSelection(
  sessionId: string,
  target: EventTarget = window,
  profileId?: string,
  terminalRef?: TerminalRef,
): void {
  target.dispatchEvent(
    new TerminalNotificationSelectEvent(sessionId, profileId, terminalRef),
  );
}

export function subscribeToTerminalNotificationSelection(
  listener: (
    sessionId: string,
    profileId?: string,
    terminalRef?: TerminalRef,
  ) => void,
  target: EventTarget = window,
): () => void {
  const handleSelection = (event: Event) => {
    if (event instanceof TerminalNotificationSelectEvent) {
      if (event.profileId !== undefined || event.terminalRef !== undefined) {
        listener(event.sessionId, event.profileId, event.terminalRef);
      } else {
        listener(event.sessionId);
      }
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
  registered = false,
): boolean {
  return (
    mountedSessionIds.includes(sessionId) &&
    (alive === true || (alive === undefined && registered))
  );
}

export interface NavigateToTerminalNotificationOptions {
  sessionId: string;
  mountedSessionIds: readonly string[];
  alive: boolean | undefined;
  registered?: boolean;
  focusWindow: () => void;
  revealTerminal: () => void;
  selectSession: (sessionId: string) => void;
  focusTerminal: (sessionId: string) => void;
}

export function navigateToTerminalNotification({
  sessionId,
  mountedSessionIds,
  alive,
  registered,
  focusWindow,
  revealTerminal,
  selectSession,
  focusTerminal,
}: NavigateToTerminalNotificationOptions): boolean {
  if (
    !isTerminalNotificationTargetAvailable(
      sessionId,
      mountedSessionIds,
      alive,
      registered,
    )
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
      const matches =
        registeredSessionId === sessionId ||
        (registeredSessionId.startsWith("[") &&
          registeredSessionId.includes(sessionId));
      if (!matches || !hasTerminal(sessionId)) return;
      activateTerminal(sessionId);
      dispose();
    });
    timer = setTimer(dispose, 2_000);

    // Activate the current entry, but keep listening in case navigation remounts it.
    if (hasTerminal(sessionId)) activateTerminal(sessionId);
  });

  return dispose;
}
