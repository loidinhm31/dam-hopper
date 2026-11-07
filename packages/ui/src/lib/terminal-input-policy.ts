import type { Terminal } from "@xterm/xterm";

/**
 * Generic terminal stdin suppression policy.
 *
 * Keeps xterm's hidden textarea and stdin in sync with application-wide
 * suppression states:
 * - Cognito Privacy Mode (full input isolation)
 * - Disconnected server profile / retired owner
 * - Frame focus loss / dialog modal capture
 *
 * When suppressed:
 * - disableStdin is true
 * - textarea inputmode is set to "none"
 * - tabIndex is -1 and textarea is blurred
 *
 * When unsuppressed:
 * - disableStdin is false
 * - textarea inputmode attribute is removed
 * - tabIndex is restored to 0
 */
export function syncTerminalInputSuppression(
  term: Terminal | null,
  shouldSuppress: boolean,
): void {
  if (!term) return;

  term.options.disableStdin = shouldSuppress;
  const textarea = term.textarea;
  if (!textarea) return;

  if (shouldSuppress) {
    textarea.inputMode = "none";
    textarea.setAttribute("inputmode", "none");
    textarea.tabIndex = -1;
    textarea.blur();
  } else {
    textarea.inputMode = "";
    textarea.removeAttribute("inputmode");
    textarea.tabIndex = 0;
  }
}

export interface TerminalInputSuppressionState {
  cognitoActive?: boolean;
  modalDepth?: number;
  activePalette?: boolean;
  activeNonmodal?: boolean;
  suppressNativeKeyboard?: boolean;
  suppressAutoFocus?: boolean;
  isStreamNotReady?: boolean;
  isOwnerDisconnected?: boolean;
}

export function calculateTerminalInputSuppression(
  state: TerminalInputSuppressionState,
): boolean {
  return Boolean(
    state.cognitoActive ||
      (state.modalDepth !== undefined && state.modalDepth > 0) ||
      state.activePalette ||
      state.activeNonmodal ||
      state.suppressNativeKeyboard ||
      state.suppressAutoFocus ||
      state.isStreamNotReady ||
      state.isOwnerDisconnected,
  );
}
