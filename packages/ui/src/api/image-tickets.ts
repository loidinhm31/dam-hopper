import {
  assertMediaSessionAuthorizationMode,
  assertMediaTransport,
  createRemoteCleanupHandle,
  MediaSessionError,
  mediaTicketUrl,
  probeMediaTicket,
  readMediaErrorCode,
  type RemoteCleanupHandle,
} from "./media-session.js";
import {
  getActiveProfile,
  getAuthToken,
  getServerUrl,
  normalizeServerUrl,
} from "./server-config.js";
import {
  normalizeProjectTarget,
  toServerProjectTarget,
  type ConnectionRef,
  type ProjectTargetInput,
} from "./client.js";
import {
  captureConnection,
  getConnectionSnapshot,
  getMediaClientId,
} from "./connections.js";
const IMAGE_TICKET_TIMEOUT_MS = 15_000;
const STREAM_PATH = /^\/api\/fs\/image\/stream\/[A-Za-z0-9_-]+$/;

export interface ImagePreviewTicket {
  purpose: "preview";
  url: string;
  expiresAt: number;
  cleanupHandle: RemoteCleanupHandle;
  revoke: () => Promise<void>;
}

export class ImageTicketError extends Error {
  constructor(readonly code: string) {
    super(`Image ticket error: ${code}`);
    this.name = "ImageTicketError";
  }
}

interface TicketResponse {
  ticket: string;
  streamPath: string;
  expiresAt: number;
  purpose: "preview";
  authorizationMode: "session-cookie-v2";
}

interface RequestSnapshot {
  authToken: string | null;
  owner: ConnectionRef;
  mediaClientId: string;
  serverOrigin: string;
}

function ticketError(code: string): ImageTicketError {
  return new ImageTicketError(code);
}

function throwIfAborted(
  requestSignal: AbortSignal,
  callerSignal: AbortSignal | undefined,
): void {
  if (!requestSignal.aborted) return;
  throw ticketError(callerSignal?.aborted ? "ABORTED" : "TIMEOUT");
}

function resolveOwnerAndSnapshot(
  target: ProjectTargetInput,
  explicitOwner?: ConnectionRef,
): RequestSnapshot {
  const targetRef = normalizeProjectTarget(target);
  let owner: ConnectionRef | undefined = explicitOwner;
  if (!owner && targetRef.profileId) {
    try {
      owner = captureConnection(targetRef.profileId);
    } catch {
      const snap = getConnectionSnapshot(targetRef.profileId);
      owner = snap?.owner;
    }
  }
  if (!owner) {
    const profile = getActiveProfile();
    if (profile?.id) {
      const snap = getConnectionSnapshot(profile.id);
      owner = snap?.owner ?? { profileId: profile.id, generation: 1 };
    } else {
      owner = { profileId: "default", generation: 1 };
    }
  }
  const snap = getConnectionSnapshot(owner.profileId);
  const configuredUrl = normalizeServerUrl(
    snap?.serverUrl ?? getActiveProfile()?.url ?? getServerUrl(),
  );
  try {
    const serverUrl = new URL(configuredUrl);
    assertMediaTransport(serverUrl.origin);
    return {
      serverOrigin: serverUrl.origin,
      authToken: getAuthToken(owner.profileId),
      owner,
      mediaClientId: getMediaClientId(owner),
    };
  } catch (error) {
    if (error instanceof MediaSessionError) throw ticketError(error.code);
    throw ticketError("INVALID_SERVER");
  }
}

function requestHeaders(authToken: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };
}

function createTimeoutSignal(signal: AbortSignal | undefined): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    IMAGE_TICKET_TIMEOUT_MS,
  );
  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });
  if (signal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    },
  };
}

function parseTicketResponse(value: unknown): TicketResponse {
  if (!value || typeof value !== "object") {
    throw ticketError("INVALID_RESPONSE");
  }
  const response = value as Partial<TicketResponse>;
  if (
    typeof response.ticket !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(response.ticket) ||
    typeof response.streamPath !== "string" ||
    !STREAM_PATH.test(response.streamPath) ||
    typeof response.expiresAt !== "number" ||
    !Number.isSafeInteger(response.expiresAt) ||
    response.expiresAt <= 0 ||
    response.purpose !== "preview"
  ) {
    throw ticketError("INVALID_RESPONSE");
  }
  if (response.streamPath !== `/api/fs/image/stream/${response.ticket}`) {
    throw ticketError("INVALID_RESPONSE");
  }
  assertMediaSessionAuthorizationMode(response.authorizationMode);
  return response as TicketResponse;
}

async function revokeTicket(
  snapshot: RequestSnapshot,
  ticket: string,
): Promise<void> {
  try {
    await fetch(`${snapshot.serverOrigin}/api/fs/image/tickets`, {
      method: "DELETE",
      credentials: "include",
      keepalive: true,
      headers: requestHeaders(snapshot.authToken),
      body: JSON.stringify({
        ticket,
        mediaClientId: snapshot.mediaClientId,
      }),
    });
  } catch {
    // Cleanup is best effort; the ticket still expires server-side.
  }
}

/** Issues the fixed-purpose, in-memory browser image capability. */
export async function issueImageTicket(
  target: ProjectTargetInput,
  path: string,
  signal?: AbortSignal,
  owner?: ConnectionRef,
): Promise<ImagePreviewTicket> {
  const snapshot = resolveOwnerAndSnapshot(target, owner);
  const targetRef = normalizeProjectTarget(target);
  const timeout = createTimeoutSignal(signal);
  let issuedTicket: string | null = null;
  try {
    const response = await fetch(
      `${snapshot.serverOrigin}/api/fs/image/tickets`,
      {
        method: "POST",
        credentials: "include",
        headers: requestHeaders(snapshot.authToken),
        signal: timeout.signal,
        body: JSON.stringify({
          ...toServerProjectTarget(targetRef),
          path,
          mediaClientId: snapshot.mediaClientId,
        }),
      },
    );
    throwIfAborted(timeout.signal, signal);
    if (!response.ok) {
      throw ticketError(
        await readMediaErrorCode(response, `HTTP_${response.status}`),
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throwIfAborted(timeout.signal, signal);
      throw ticketError("INVALID_RESPONSE");
    }
    throwIfAborted(timeout.signal, signal);
    const issued = parseTicketResponse(payload);
    issuedTicket = issued.ticket;
    const url = mediaTicketUrl(issued.streamPath, snapshot.serverOrigin);
    await probeMediaTicket(url, timeout.signal);
    throwIfAborted(timeout.signal, signal);

    const cleanupHandle = createRemoteCleanupHandle(
      snapshot.owner,
      issued.ticket,
      async (cleanupSignal) => {
        await fetch(`${snapshot.serverOrigin}/api/fs/image/tickets`, {
          method: "DELETE",
          credentials: "include",
          keepalive: true,
          headers: requestHeaders(snapshot.authToken),
          body: JSON.stringify({
            ticket: issued.ticket,
            mediaClientId: snapshot.mediaClientId,
          }),
          signal: cleanupSignal,
        });
      },
    );

    return {
      purpose: "preview",
      url,
      expiresAt: issued.expiresAt,
      cleanupHandle,
      revoke: () => cleanupHandle.cleanup(),
    };
  } catch (error) {
    if (issuedTicket) void revokeTicket(snapshot, issuedTicket);
    if (timeout.signal.aborted && signal?.aborted) {
      throw ticketError("ABORTED");
    }
    if (error instanceof ImageTicketError) throw error;
    if (error instanceof MediaSessionError) throw ticketError(error.code);
    throw ticketError(timeout.signal.aborted ? "TIMEOUT" : "NETWORK");
  } finally {
    timeout.cleanup();
  }
}
