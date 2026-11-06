import type { TerminalTarget } from "@/api/terminal-session-contract.js";
import type { ResourceClaimKey } from "./types.js";

export type TerminalClaimKeyInput =
  | { readonly target: TerminalTarget }
  | {
      readonly profileId: string;
      readonly generation: number;
      readonly sessionId: string;
      readonly incarnation: number | undefined;
    };

/**
 * Builds a ResourceClaimKey with exact parity to TerminalsApp.
 *
 * For targeted terminals:
 * - resourceKind: "terminal"
 * - profileId: target.profileId
 * - generation: target.generation
 * - resourceId: target.terminalId
 * - incarnation: target.incarnation (string)
 * - authority: target.serverEpoch
 *
 * For untargeted terminals:
 * - resourceKind: "terminal"
 * - profileId: input.profileId
 * - generation: input.generation
 * - resourceId: input.sessionId
 * - incarnation: input.incarnation (number | undefined)
 */
export function buildTerminalClaimKey(
  input: TerminalClaimKeyInput,
): ResourceClaimKey {
  if ("target" in input) {
    return {
      resourceKind: "terminal",
      profileId: input.target.profileId,
      generation: input.target.generation,
      resourceId: input.target.terminalId,
      incarnation: input.target.incarnation,
      authority: input.target.serverEpoch,
    };
  }
  return {
    resourceKind: "terminal",
    profileId: input.profileId,
    generation: input.generation,
    resourceId: input.sessionId,
    incarnation: input.incarnation,
  };
}
