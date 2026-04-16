import type { SessionInfo } from "./client.js";

/**
 * Session lifecycle status for UI rendering.
 * 
 * - alive: process is running
 * - restarting: process exited but will restart (within backoff window)
 * - crashed: process exited with non-zero code and won't restart
 * - exited: process exited cleanly (exitCode=0) and won't restart
 */
export type SessionStatus = "alive" | "restarting" | "crashed" | "exited";

/**
 * Determine UI status from session metadata.
 * 
 * Status dot colors:
 * - 🟢 alive
 * - 🟡 restarting (dead with willRestart=true, within backoff window)
 * - 🔴 crashed (exit≠0, no restart — either policy=never or retries exhausted)
 * - ⚪ exited (exit=0, policy=never)
 */
export function getSessionStatus(sess: SessionInfo): SessionStatus {
  if (sess.alive) return "alive";
  if (sess.willRestart) return "restarting";
  if (sess.exitCode !== 0 && sess.exitCode !== null && sess.exitCode !== undefined) {
    return "crashed";
  }
  return "exited";
}

/**
 * Get Tailwind color class for session status dot.
 */
export function getStatusDotColor(status: SessionStatus): string {
  switch (status) {
    case "alive":
      return "bg-green-500";
    case "restarting":
      return "bg-yellow-500";
    case "crashed":
      return "bg-red-500";
    case "exited":
      return "bg-[var(--color-text-muted)]/30";
  }
}

/**
 * Get status dot glow effect class (only for alive/restarting).
 */
export function getStatusGlowClass(status: SessionStatus): string {
  switch (status) {
    case "alive":
      return "status-glow-green";
    case "restarting":
      return "status-glow-orange";
    default:
      return "";
  }
}
