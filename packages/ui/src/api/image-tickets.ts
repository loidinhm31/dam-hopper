import {
  assertMediaSessionAuthorizationMode,
  assertMediaTransport,
  MediaSessionError,
  mediaTicketUrl,
  probeMediaTicket,
  readMediaErrorCode,
} from "./media-session.js";
import {
  getActiveProfile,
  getAuthToken,
  getServerUrl,
  normalizeServerUrl,
} from "./server-config.js";
import { normalizeProjectTarget, type ProjectTargetInput } from "./client.js";

const IMAGE_TICKET_TIMEOUT_MS = 15_000;
const STREAM_PATH = /^\/api\/fs\/image\/stream\/[A-Za-z0-9_-]+$/;

export interface ImagePreviewTicket {
  purpose: "preview";
  url: string;
  expiresAt: number;
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
  authorizationMode: "session-cookie-v1";
}

interface RequestSnapshot {
  authToken: string | null;
  profileId: string | null;
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

function requestSnapshot(): RequestSnapshot {
  const profile = getActiveProfile();
  const configuredUrl = normalizeServerUrl(profile?.url ?? getServerUrl());
  try {
    const serverUrl = new URL(configuredUrl);
    assertMediaTransport(serverUrl.origin);
    return {
      serverOrigin: serverUrl.origin,
      authToken: getAuthToken(profile?.id),
      profileId: profile?.id ?? null,
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
      body: JSON.stringify({ ticket }),
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
): Promise<ImagePreviewTicket> {
  const snapshot = requestSnapshot();
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
        body: JSON.stringify({ ...normalizeProjectTarget(target), path }),
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
    return {
      purpose: "preview",
      url,
      expiresAt: issued.expiresAt,
      revoke: () => revokeTicket(snapshot, issued.ticket),
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
