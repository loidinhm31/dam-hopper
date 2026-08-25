import type { Terminal } from "@xterm/xterm";

/** Keeps xterm's hidden textarea in sync with the app-wide input policy. */
export function syncNativeKeyboardSuppression(
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
    textarea.inputMode = "text";
    textarea.removeAttribute("inputmode");
    textarea.tabIndex = 0;
  }
}
