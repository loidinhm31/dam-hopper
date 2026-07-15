export type TerminalSuggestionCapability = "unavailable" | "editing";

/**
 * Phase 01 deliberately fails closed. Phase 02 can return `editing` only after
 * the server has verified a supported shell lifecycle for this PTY incarnation.
 */
export function getTerminalSuggestionCapability(): TerminalSuggestionCapability {
  return "unavailable";
}
