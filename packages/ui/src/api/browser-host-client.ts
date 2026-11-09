/**
 * Browser Host REST and WebSocket Ticket Client.
 *
 * Implements typed API calls to server browser_host routes,
 * ensuring connection ownership and generation fences per architecture-contracts.md.
 */

import {
  type ConnectionRef,
  ConnectionOwnerError,
} from "./ownership.js";
import {
  getConnectionSnapshot,
  isCurrentConnection,
} from "./connections.js";
import {
  getAuthToken,
  getServerUrl,
  normalizeServerUrl,
} from "./server-config.js";
import { generateUUID } from "../lib/utils.js";
import {
  BrowserHostClientError,
  CONTROL_SUBPROTOCOL,
  MEDIA_SUBPROTOCOL,
  TICKET_SUBPROTOCOL_PREFIX,
  type AcquireControlRequest,
  type AcquireControlResponse,
  type BrowserCapabilitiesResponse,
  type BrowserSessionDto,
  type CreateSessionRequest,
  type DialogResponseRequest,
  type FindRequest,
  type FindResponse,
  type HistoryRequest,
  type IssueTicketRequest,
  type IssueTicketResponse,
  type NavigateRequest,
  type ProfileResetRequest,
  type ProfileResetResponse,
  type ReleaseControlRequest,
  type ReloadRequest,
  type RenewControlRequest,
  type RenewControlResponse,
  type SetViewportRequest,
} from "./browser-host-types.js";

export interface ViewerAttachmentCredentials {
  owner: ConnectionRef;
  browserSessionId: string;
  browserIncarnation: string;
  profileEpoch: number;
  viewerId: string;
  subscriptionEpoch: string;
  mediaTicket: string;
  controlTicket: string;
  mediaWsUrl: string;
  controlWsUrl: string;
  mediaSubprotocols: [string, string];
  controlSubprotocols: [string, string];
}

interface ValidatedConnection {
  serverUrl: string;
  authToken: string | null;
}

function assertValidConnection(owner: ConnectionRef): ValidatedConnection {
  if (!isCurrentConnection(owner)) {
    throw new ConnectionOwnerError(
      `Connection is stale or disconnected: ${owner.profileId}@${owner.generation}`,
      "stale",
    );
  }
  const snap = getConnectionSnapshot(owner.profileId);
  const rawUrl = snap?.serverUrl ?? getServerUrl();
  const serverUrl = normalizeServerUrl(rawUrl);
  if (!serverUrl) {
    throw new ConnectionOwnerError(
      `No server URL configured for profile ${owner.profileId}`,
      "unavailable",
    );
  }
  const authToken = getAuthToken(owner.profileId);
  return { serverUrl, authToken };
}

async function requestJson<T>(
  owner: ConnectionRef,
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    extraHeaders?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const { serverUrl, authToken } = assertValidConnection(owner);

  const url = `${serverUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    ...options.extraHeaders,
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  // Re-verify connection ownership after await to prevent stale profile delivery
  if (!isCurrentConnection(owner)) {
    throw new ConnectionOwnerError(
      `Connection became stale during request: ${owner.profileId}@${owner.generation}`,
      "stale",
    );
  }

  if (!res.ok) {
    let errorKind = `http_${res.status}`;
    let errorMessage = `HTTP ${res.status} ${res.statusText}`;
    try {
      const errJson = (await res.json()) as { kind?: string; error?: string };
      if (errJson && typeof errJson === "object") {
        if (typeof errJson.kind === "string") {
          errorKind = errJson.kind;
        }
        if (typeof errJson.error === "string") {
          errorMessage = errJson.error;
        }
      }
    } catch {
      // Non-JSON response body
    }
    throw new BrowserHostClientError(errorMessage, errorKind, res.status);
  }

  const text = await res.text();

  // Re-verify connection ownership after reading body stream
  if (!isCurrentConnection(owner)) {
    throw new ConnectionOwnerError(
      `Connection became stale during response body consumption: ${owner.profileId}@${owner.generation}`,
      "stale",
    );
  }

  if (!text || text.trim() === "") {
    return undefined as unknown as T;
  }
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Capabilities and Sessions
// ---------------------------------------------------------------------------

export async function getBrowserCapabilities(
  owner: ConnectionRef,
  signal?: AbortSignal,
): Promise<BrowserCapabilitiesResponse> {
  return requestJson<BrowserCapabilitiesResponse>(
    owner,
    "/api/browser/capabilities",
    { signal },
  );
}

export async function listBrowserSessions(
  owner: ConnectionRef,
  signal?: AbortSignal,
): Promise<BrowserSessionDto[]> {
  return requestJson<BrowserSessionDto[]>(owner, "/api/browser/sessions", {
    signal,
  });
}

export async function getBrowserSession(
  owner: ConnectionRef,
  sessionId: string,
  signal?: AbortSignal,
): Promise<BrowserSessionDto> {
  return requestJson<BrowserSessionDto>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}`,
    { signal },
  );
}

export async function createBrowserSession(
  owner: ConnectionRef,
  req: CreateSessionRequest,
  signal?: AbortSignal,
): Promise<BrowserSessionDto> {
  return requestJson<BrowserSessionDto>(owner, "/api/browser/sessions", {
    method: "POST",
    body: req,
    signal,
  });
}

export async function closeBrowserSession(
  owner: ConnectionRef,
  sessionId: string,
  signal?: AbortSignal,
): Promise<void> {
  await requestJson<void>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
      signal,
    },
  );
}

// ---------------------------------------------------------------------------
// Navigation and Viewport
// ---------------------------------------------------------------------------

export async function navigateBrowser(
  owner: ConnectionRef,
  sessionId: string,
  req: NavigateRequest,
  signal?: AbortSignal,
): Promise<BrowserSessionDto> {
  return requestJson<BrowserSessionDto>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/navigate`,
    {
      method: "POST",
      body: req,
      signal,
    },
  );
}

export async function historyBrowser(
  owner: ConnectionRef,
  sessionId: string,
  req: HistoryRequest,
  signal?: AbortSignal,
): Promise<BrowserSessionDto> {
  return requestJson<BrowserSessionDto>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/history`,
    {
      method: "POST",
      body: req,
      signal,
    },
  );
}

export async function reloadBrowser(
  owner: ConnectionRef,
  sessionId: string,
  req: ReloadRequest,
  signal?: AbortSignal,
): Promise<BrowserSessionDto> {
  return requestJson<BrowserSessionDto>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/reload`,
    {
      method: "POST",
      body: req,
      signal,
    },
  );
}

export async function setBrowserViewport(
  owner: ConnectionRef,
  sessionId: string,
  req: SetViewportRequest,
  signal?: AbortSignal,
): Promise<BrowserSessionDto> {
  return requestJson<BrowserSessionDto>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/viewport`,
    {
      method: "PUT",
      body: req,
      signal,
    },
  );
}

// ---------------------------------------------------------------------------
// Control Lease, Dialogs, Find & Selection
// ---------------------------------------------------------------------------

export async function acquireBrowserControl(
  owner: ConnectionRef,
  sessionId: string,
  req: AcquireControlRequest,
  signal?: AbortSignal,
): Promise<AcquireControlResponse> {
  return requestJson<AcquireControlResponse>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/control/acquire`,
    {
      method: "POST",
      body: req,
      signal,
    },
  );
}

export async function renewBrowserControl(
  owner: ConnectionRef,
  sessionId: string,
  req: RenewControlRequest,
  signal?: AbortSignal,
): Promise<RenewControlResponse> {
  return requestJson<RenewControlResponse>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/control/renew`,
    {
      method: "POST",
      body: req,
      signal,
    },
  );
}

export async function releaseBrowserControl(
  owner: ConnectionRef,
  sessionId: string,
  req: ReleaseControlRequest,
  signal?: AbortSignal,
): Promise<void> {
  await requestJson<void>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/control/release`,
    {
      method: "POST",
      body: req,
      signal,
    },
  );
}

export async function respondBrowserDialog(
  owner: ConnectionRef,
  sessionId: string,
  req: DialogResponseRequest,
  signal?: AbortSignal,
): Promise<void> {
  await requestJson<void>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/dialog`,
    {
      method: "POST",
      body: req,
      signal,
    },
  );
}

export async function findInBrowserPage(
  owner: ConnectionRef,
  sessionId: string,
  req: FindRequest,
  signal?: AbortSignal,
): Promise<FindResponse> {
  return requestJson<FindResponse>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/find`,
    {
      method: "POST",
      body: req,
      signal,
    },
  );
}

export async function getBrowserSelectedText(
  owner: ConnectionRef,
  sessionId: string,
  leaseToken: string,
  signal?: AbortSignal,
): Promise<{ text: string }> {
  return requestJson<{ text: string }>(
    owner,
    `/api/browser/sessions/${encodeURIComponent(sessionId)}/selected-text`,
    {
      extraHeaders: {
        "x-browser-lease": leaseToken,
      },
      signal,
    },
  );
}

// ---------------------------------------------------------------------------
// Attachments and Profile Reset
// ---------------------------------------------------------------------------

export async function issueAttachmentTicket(
  owner: ConnectionRef,
  req: IssueTicketRequest,
  signal?: AbortSignal,
): Promise<IssueTicketResponse> {
  return requestJson<IssueTicketResponse>(owner, "/api/browser/attachments", {
    method: "POST",
    body: req,
    signal,
  });
}

export async function resetBrowserProfile(
  owner: ConnectionRef,
  req: ProfileResetRequest,
  signal?: AbortSignal,
): Promise<ProfileResetResponse> {
  return requestJson<ProfileResetResponse>(owner, "/api/browser/profile/reset", {
    method: "POST",
    body: req,
    signal,
  });
}

/**
 * Mints an atomic matching media and control ticket pair in memory.
 * Captures immutable viewerId and subscriptionEpoch for connection binding.
 */
export async function mintViewerAttachmentTickets(
  owner: ConnectionRef,
  sessionId: string,
  browserIncarnation: string,
  profileEpoch: number,
  signal?: AbortSignal,
): Promise<ViewerAttachmentCredentials> {
  const viewerId = generateUUID();
  const subscriptionEpoch = generateUUID();

  const [mediaTicketResp, controlTicketResp] = await Promise.all([
    issueAttachmentTicket(
      owner,
      {
        purpose: "media",
        browserSessionId: sessionId,
        viewerId,
        subscriptionEpoch,
        browserIncarnation,
        profileEpoch,
      },
      signal,
    ),
    issueAttachmentTicket(
      owner,
      {
        purpose: "control",
        browserSessionId: sessionId,
        viewerId,
        subscriptionEpoch,
        browserIncarnation,
        profileEpoch,
      },
      signal,
    ),
  ]);

  const { serverUrl } = assertValidConnection(owner);
  const wsBaseUrl = serverUrl.replace(/^http(s?):/, "ws$1:");
  const mediaWsUrl = `${wsBaseUrl}/api/browser/media`;
  const controlWsUrl = `${wsBaseUrl}/api/browser/control`;

  return {
    owner,
    browserSessionId: sessionId,
    browserIncarnation,
    profileEpoch,
    viewerId,
    subscriptionEpoch,
    mediaTicket: mediaTicketResp.ticket,
    controlTicket: controlTicketResp.ticket,
    mediaWsUrl,
    controlWsUrl,
    mediaSubprotocols: [
      MEDIA_SUBPROTOCOL,
      `${TICKET_SUBPROTOCOL_PREFIX}${mediaTicketResp.ticket}`,
    ],
    controlSubprotocols: [
      CONTROL_SUBPROTOCOL,
      `${TICKET_SUBPROTOCOL_PREFIX}${controlTicketResp.ticket}`,
    ],
  };
}
