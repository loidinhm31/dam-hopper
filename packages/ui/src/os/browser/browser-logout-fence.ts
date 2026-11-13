import { disconnectProfile } from "@/api/connections.js";
import type { BrowserResetState } from "@/api/auth-types.js";
import { fenceBrowserViewsForProfile } from "@/os/BrowserStreamKeepAliveHost.js";

/** The subset of a completed logout that decides whether Browser views must be fenced. */
export interface LogoutFenceOutcome {
  browserResetState: BrowserResetState;
  sessionRevoked?: boolean;
}

/**
 * Completes a logout locally: Browser views are fenced (blackened, sockets retired) FIRST, while
 * the captured connection generation is still current, and only then is the profile disconnected.
 * `disconnectProfile` advances the generation, so reversing the order turns the fence into a
 * no-op and leaves the last frame and live sockets of the logged-out owner alive.
 */
export function fenceThenDisconnectProfile(
  profileId: string,
  generation: number | undefined,
  outcome: LogoutFenceOutcome,
): void {
  if (
    outcome.browserResetState === "cleared" ||
    outcome.browserResetState === "cleanupPending" ||
    outcome.sessionRevoked !== false
  ) {
    fenceBrowserViewsForProfile(
      profileId,
      "Shared Browser profile reset or logged out",
      generation,
    );
  }
  disconnectProfile(profileId);
}
