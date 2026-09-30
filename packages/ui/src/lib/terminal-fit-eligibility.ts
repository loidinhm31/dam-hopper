export interface TerminalFitCandidate {
  terminal?: {
    element?: HTMLElement;
  };
  attachmentElement?: HTMLElement;
}

export function isTerminalFitEligible(
  target: TerminalFitCandidate | undefined,
): boolean {
  if (!target) return false;

  const element = target.attachmentElement ?? target.terminal?.element;
  if (!element || !element.isConnected) return false;

  if (
    element.closest("[data-terminal-parking-host='true']") ||
    element.closest("[aria-hidden='true']")
  ) {
    return false;
  }

  if (element.style.display === "none") return false;

  const parent = element.parentElement;
  if (parent && parent.style.display === "none") return false;

  if (typeof window !== "undefined") {
    if (window.getComputedStyle(element).display === "none") return false;
    if (parent && window.getComputedStyle(parent).display === "none") {
      return false;
    }
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  return true;
}
