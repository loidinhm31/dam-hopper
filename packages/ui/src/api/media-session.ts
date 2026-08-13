export const MEDIA_SESSION_AUTHORIZATION_MODE = "session-cookie-v1";

export type MediaSessionErrorCode =
  | "MEDIA_SESSION_UNSUPPORTED"
  | "INSECURE_MEDIA_SERVER";

export class MediaSessionError extends Error {
  constructor(readonly code: MediaSessionErrorCode) {
    super(`Media session error: ${code}`);
    this.name = "MediaSessionError";
  }
}

function fail(code: MediaSessionErrorCode): never {
  throw new MediaSessionError(code);
}

/** Reject media origins that cannot receive the mandatory Secure session cookie. */
export function assertMediaTransport(serverOrigin: string): void {
  let server: URL;
  try {
    server = new URL(serverOrigin);
  } catch {
    fail("INSECURE_MEDIA_SERVER");
  }
  if (server.protocol !== "https:") fail("INSECURE_MEDIA_SERVER");
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

/**
 * Verify native media can send the HttpOnly partitioned cookie before exposing
 * a ticket URL to an image, video, or browser-managed download.
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
    if (!response.ok) fail("MEDIA_SESSION_UNSUPPORTED");
  } catch (error) {
    if (signal.aborted || error instanceof MediaSessionError) throw error;
    fail("MEDIA_SESSION_UNSUPPORTED");
  }
}

/** Best-effort bounded revocation before removing or switching credentials. */
export async function revokeCurrentMediaSession(
  serverOrigin: string,
  authToken: string,
): Promise<void> {
  // Profiles still support loopback HTTP for general development, but this
  // security-sensitive request must never transmit a bearer token in cleartext.
  try {
    if (new URL(serverOrigin).protocol !== "https:") return;
  } catch {
    return;
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    await fetch(`${serverOrigin}/api/fs/media-session`, {
      method: "DELETE",
      credentials: "include",
      headers: { Authorization: `Bearer ${authToken}` },
      signal: controller.signal,
    });
  } catch {
    // Server-side expiration is the bounded fallback when the old origin is unavailable.
  } finally {
    window.clearTimeout(timeout);
  }
}
