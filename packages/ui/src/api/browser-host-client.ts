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
import { isSecureOrLoopbackOrigin, parsePositiveEpoch } from "./auth-client.js";
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
export { BrowserHostClientError } from "./browser-host-types.js";

export interface ViewerAttachmentCredentials {
  owner: ConnectionRef;
  browserSessionId: string;
  browserIncarnation: string;
  profileEpoch: string;
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

function assertSecureOrLoopbackOrigin(url: string): string {
  const normalized = url.replace(/\/+$/, "");
  if (!isSecureOrLoopbackOrigin(normalized)) {
    throw new BrowserHostClientError(
      "Browser transport requires an HTTPS or loopback origin",
      "insecureOrigin",
      0,
    );
  }
  return normalized;
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
  assertSecureOrLoopbackOrigin(serverUrl);
  const authToken = getAuthToken(owner.profileId);
  return { serverUrl, authToken };
}

export async function requestBrowserHostJson<T>(
  owner: ConnectionRef,
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    extraHeaders?: Record<string, string>;
    credentials?: RequestCredentials;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const { serverUrl, authToken } = assertValidConnection(owner);

  const url = `${serverUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    ...options.extraHeaders,
  };
  if (authToken && isSecureOrLoopbackOrigin(serverUrl)) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    ...(options.credentials ? { credentials: options.credentials } : {}),
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
  return requestBrowserHostJson<BrowserCapabilitiesResponse>(
    owner,
    "/api/browser/capabilities",
    { signal },
  );
}

export async function listBrowserSessions(
  owner: ConnectionRef,
  signal?: AbortSignal,
): Promise<BrowserSessionDto[]> {
  return requestBrowserHostJson<BrowserSessionDto[]>(owner, "/api/browser/sessions", {
    signal,
  });
}

export async function getBrowserSession(
  owner: ConnectionRef,
  sessionId: string,
  signal?: AbortSignal,
): Promise<BrowserSessionDto> {
  return requestBrowserHostJson<BrowserSessionDto>(
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
  return requestBrowserHostJson<BrowserSessionDto>(owner, "/api/browser/sessions", {
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
  await requestBrowserHostJson<void>(
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
  return requestBrowserHostJson<BrowserSessionDto>(
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
  return requestBrowserHostJson<BrowserSessionDto>(
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
  return requestBrowserHostJson<BrowserSessionDto>(
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
  return requestBrowserHostJson<BrowserSessionDto>(
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
  return requestBrowserHostJson<AcquireControlResponse>(
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
  return requestBrowserHostJson<RenewControlResponse>(
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
  await requestBrowserHostJson<void>(
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
  await requestBrowserHostJson<void>(
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
  return requestBrowserHostJson<FindResponse>(
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
  return requestBrowserHostJson<{ text: string }>(
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
  return requestBrowserHostJson<IssueTicketResponse>(owner, "/api/browser/attachments", {
    method: "POST",
    body: req,
    signal,
  });
}

export interface ProfileResetStatusResponse extends ProfileResetResponse {
  operationId?: string;
  reason?: string;
}

export type BrowserResetPreflightResult =
  | {
      kind: "admitted";
      available: boolean;
      managedProfilePresent: boolean;
      profileEpoch: string;
      unavailableReason?: string;
    }
  | {
      kind: "unauthorized" | "forbidden" | "unavailable" | "unreachable";
      status: number | null;
      reason: string;
    };

export interface PendingBrowserResetContext {
  operationId?: string;
  profileEpoch?: string;
  browserResetState?: string;
  reason?: string;
}

const pendingBrowserResetByProfile = new Map<string, PendingBrowserResetContext>();

export function setPendingBrowserResetContext(
  profileId: string | undefined,
  context: PendingBrowserResetContext | null,
): void {
  if (!profileId) return;
  if (context === null) {
    pendingBrowserResetByProfile.delete(profileId);
  } else {
    pendingBrowserResetByProfile.set(profileId, context);
  }
}

export function getPendingBrowserResetContext(
  profileId: string | undefined,
): PendingBrowserResetContext | null {
  if (!profileId) return null;
  return pendingBrowserResetByProfile.get(profileId) ?? null;
}

function buildOriginAuthHeaders(
  baseUrl: string,
  token?: string | null,
  includeContentType = false,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Cache-Control": "no-store",
  };
  if (includeContentType) {
    headers["Content-Type"] = "application/json";
  }
  if (token && isSecureOrLoopbackOrigin(baseUrl)) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function requestOriginJson(
  baseUrl: string,
  endpoint: string,
  token: string | null | undefined,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<unknown> {
  const normalized = assertSecureOrLoopbackOrigin(baseUrl);
  const res = await fetch(`${normalized}${endpoint}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers: buildOriginAuthHeaders(
      normalized,
      token,
      options.body !== undefined,
    ),
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    credentials: "include",
    signal: options.signal,
  });
  const raw: unknown =
    typeof res.json === "function" ? await res.json().catch(() => null) : null;
  const data =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!res.ok) {
    const kind =
      data && typeof data.kind === "string" ? data.kind : `http_${res.status}`;
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `HTTP ${res.status} ${res.statusText}`;
    const opId =
      data && typeof data.operationId === "string"
        ? data.operationId
        : undefined;
    throw new BrowserHostClientError(message, kind, res.status, opId);
  }
  return raw;
}

export async function preflightBrowserCapabilitiesForOrigin(
  baseUrl: string,
  token?: string | null,
  signal?: AbortSignal,
): Promise<BrowserResetPreflightResult> {
  const normalized = assertSecureOrLoopbackOrigin(baseUrl);
  let res: Response;
  try {
    res = await fetch(`${normalized}/api/browser/capabilities`, {
      method: "GET",
      headers: buildOriginAuthHeaders(normalized, token),
      credentials: "include",
      signal,
    });
  } catch (err) {
    return {
      kind: "unreachable",
      status: null,
      reason: err instanceof Error ? err.message : "Server unreachable",
    };
  }

  const data: unknown =
    typeof res.json === "function" ? await res.json().catch(() => null) : null;
  const dataRec =
    data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!res.ok) {
    const errMsg =
      dataRec && typeof dataRec.error === "string"
        ? dataRec.error
        : `HTTP ${res.status}`;
    if (res.status === 401) {
      return { kind: "unauthorized", status: 401, reason: errMsg };
    }
    if (res.status === 403) {
      return { kind: "forbidden", status: 403, reason: errMsg };
    }
    return { kind: "unavailable", status: res.status, reason: errMsg };
  }

  const epoch = dataRec ? parsePositiveEpoch(dataRec.profileEpoch) : undefined;
  if (!dataRec || epoch === undefined) {
    return {
      kind: "unavailable",
      status: res.status,
      reason: "Browser capability metadata unavailable",
    };
  }

  const unavailableReason =
    typeof dataRec.unavailableReason === "string"
      ? dataRec.unavailableReason
      : typeof dataRec.reason === "string"
        ? dataRec.reason
        : undefined;

  return {
    kind: "admitted",
    available: Boolean(dataRec.available),
    managedProfilePresent: Boolean(dataRec.managedProfilePresent),
    profileEpoch: epoch,
    unavailableReason,
  };
}

function parseProfileResetStatus(data: unknown): ProfileResetStatusResponse {
  const rec =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const status =
    rec.status === "completed" ? "completed" : "cleanupPending";
  const profileEpoch = parsePositiveEpoch(rec.profileEpoch);
  if (profileEpoch === undefined) {
    throw new BrowserHostClientError(
      "Browser profile reset response carried no canonical profileEpoch",
      "protocol",
    );
  }
  return {
    status,
    profileEpoch,
    operationId:
      typeof rec.operationId === "string" ? rec.operationId : undefined,
    reason: typeof rec.reason === "string" ? rec.reason : undefined,
  };
}

export async function resetBrowserProfile(
  owner: ConnectionRef,
  req: ProfileResetRequest,
  signal?: AbortSignal,
): Promise<ProfileResetStatusResponse> {
  const { serverUrl, authToken } = assertValidConnection(owner);
  const res = await resetBrowserProfileForOrigin(serverUrl, authToken, req, signal);
  if (!isCurrentConnection(owner)) {
    throw new ConnectionOwnerError(
      `Connection became stale during request: ${owner.profileId}@${owner.generation}`,
      "stale",
    );
  }
  return res;
}

export async function getBrowserProfileResetStatus(
  owner: ConnectionRef,
  operationId: string,
  signal?: AbortSignal,
): Promise<ProfileResetStatusResponse> {
  const { serverUrl, authToken } = assertValidConnection(owner);
  const res = await getBrowserProfileResetStatusForOrigin(
    serverUrl,
    authToken,
    operationId,
    signal,
  );
  if (!isCurrentConnection(owner)) {
    throw new ConnectionOwnerError(
      `Connection became stale during request: ${owner.profileId}@${owner.generation}`,
      "stale",
    );
  }
  return res;
}

export async function resetBrowserProfileForOrigin(
  baseUrl: string,
  token: string | null | undefined,
  req: ProfileResetRequest,
  signal?: AbortSignal,
): Promise<ProfileResetStatusResponse> {
  const raw = await requestOriginJson(
    baseUrl,
    "/api/browser/profile/reset",
    token,
    { method: "POST", body: req, signal },
  );
  return parseProfileResetStatus(raw);
}

export async function getBrowserProfileResetStatusForOrigin(
  baseUrl: string,
  token: string | null | undefined,
  operationId: string,
  signal?: AbortSignal,
): Promise<ProfileResetStatusResponse> {
  const raw = await requestOriginJson(
    baseUrl,
    `/api/browser/profile/reset/${encodeURIComponent(operationId)}`,
    token,
    { method: "GET", signal },
  );
  return parseProfileResetStatus(raw);
}

/**
 * Mints an atomic matching media and control ticket pair in memory.
 * Captures immutable viewerId and subscriptionEpoch for connection binding.
 */
export async function mintViewerAttachmentTickets(
  owner: ConnectionRef,
  sessionId: string,
  browserIncarnation: string,
  profileEpoch: string,
  signal?: AbortSignal,
): Promise<ViewerAttachmentCredentials> {
  const { serverUrl } = assertValidConnection(owner);
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

  assertValidConnection(owner);
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
