import type { ConnectionRef } from "./ownership.js";

export const MEDIA_SESSION_AUTHORIZATION_MODE = "session-cookie-v2";

export type MediaSessionErrorCode = string;

export class MediaSessionError extends Error {
  constructor(readonly code: MediaSessionErrorCode) {
    super(`Media session error: ${code}`);
    this.name = "MediaSessionError";
  }
}

export interface RemoteCleanupHandle {
  readonly owner: ConnectionRef;
  readonly resourceId: string;
  readonly cleanup: () => Promise<void>;
  readonly isRetired: () => boolean;
}

export function createRemoteCleanupHandle(
  owner: ConnectionRef,
  resourceId: string,
  cleanupFn: (signal: AbortSignal) => Promise<void>,
): RemoteCleanupHandle {
  let retired = false;
  let inFlight: Promise<void> | null = null;

  return {
    owner,
    resourceId,
    isRetired: () => retired,
    cleanup: async () => {
      if (retired) return;
      if (inFlight) return inFlight;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      inFlight = (async () => {
        try {
          await cleanupFn(controller.signal);
        } catch {
          // Bounded best-effort: server TTL provides ultimate safety
        } finally {
          clearTimeout(timeout);
          retired = true;
          inFlight = null;
        }
      })();
      return inFlight;
    },
  };
}

function fail(code: MediaSessionErrorCode): never {
  throw new MediaSessionError(code);
}

/** Accept only web origins supported by browser credentialed requests. */
export function assertMediaTransport(serverOrigin: string): void {
  let server: URL;
  try {
    server = new URL(serverOrigin);
  } catch {
    fail("MEDIA_SESSION_UNSUPPORTED");
  }
  if (server.protocol !== "http:" && server.protocol !== "https:") {
    fail("MEDIA_SESSION_UNSUPPORTED");
  }
}

/** Require the server contract version; capability-only servers fail closed. */
export function assertMediaSessionAuthorizationMode(value: unknown): void {
  if (value !== MEDIA_SESSION_AUTHORIZATION_MODE) {
    fail("MEDIA_SESSION_UNSUPPORTED");
  }
}

/** Resolve a ticket path without accepting an origin or query supplied by a server. */
export function mediaTicketUrl(
  streamPath: string,
  serverOrigin: string,
): string {
  const url = new URL(streamPath, serverOrigin);
  if (
    url.origin !== serverOrigin ||
    url.pathname !== streamPath ||
    url.search ||
    url.hash
  ) {
    fail("MEDIA_SESSION_UNSUPPORTED");
  }
  return url.toString();
}

/** Read only the server's stable error code from a failed media request. */
export async function readMediaErrorCode(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload: unknown = await response.clone().json();
    if (
      payload &&
      typeof payload === "object" &&
      "code" in payload &&
      typeof payload.code === "string"
    ) {
      return payload.code;
    }
  } catch {
    // Keep the status-derived fallback without exposing response text.
  }
  return fallback;
}

/**
 * Verify the authenticated, actor-bound ticket before exposing its URL to an
 * image, video, or browser-managed download. Cookie transport is used when
 * available; cross-origin media can authorize with the bound ticket itself.
 */
export async function probeMediaTicket(
  url: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      credentials: "include",
      signal,
    });
    if (!response.ok) {
      fail(await readMediaErrorCode(response, "MEDIA_SESSION_UNSUPPORTED"));
    }
  } catch (error) {
    if (signal.aborted || error instanceof MediaSessionError) throw error;
    fail("MEDIA_SESSION_UNSUPPORTED");
  }
}

/** Best-effort bounded revocation before removing or switching credentials. */
export async function revokeCurrentMediaSession(
  serverOrigin: string,
  authToken: string,
  mediaClientId?: string | null,
): Promise<void> {
  if (!mediaClientId) return;
  try {
    const protocol = new URL(serverOrigin).protocol;
    if (protocol !== "http:" && protocol !== "https:") return;
  } catch {
    return;
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    await fetch(`${serverOrigin}/api/fs/media-session`, {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ mediaClientId }),
      signal: controller.signal,
    });
  } catch {
    // Server-side expiration is the bounded fallback when the old origin is unavailable.
  } finally {
    window.clearTimeout(timeout);
  }
}
