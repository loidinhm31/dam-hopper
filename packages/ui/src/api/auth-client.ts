/**
 * Typed HTTP client functions for DamHopper authentication protocol v2.
 */

import {
  AUTH_PROTOCOL_VERSION,
  AUTH_ERROR_CODES,
  AuthClientError,
  type AuthStatusResult,
  type AuthSessionResponse,
  type LoginResult,
  type LoginChallengeResponse,
  type MfaChallengeResponse,
  type MfaSetupResponse,
} from "./auth-types.js";

export * from "./auth-types.js";

async function parseErrorResponse(
  res: Response,
  fallbackMessage = "Authentication request failed",
): Promise<AuthClientError> {
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON error body
  }

  const status = res.status;
  const retryHeader = res.headers?.get ? res.headers.get("Retry-After") : null;
  const retryAfter = retryHeader ? parseInt(retryHeader, 10) || undefined : undefined;

  if (json && typeof json === "object") {
    const record = json as Record<string, unknown>;
    const code =
      typeof record.code === "string"
        ? record.code
        : status === 401
          ? AUTH_ERROR_CODES.AUTH_REQUIRED
          : status === 429
            ? AUTH_ERROR_CODES.RATE_LIMITED
            : status === 503
              ? AUTH_ERROR_CODES.AUTH_UNAVAILABLE
              : `HTTP_${status}`;
    const message =
      typeof record.error === "string"
        ? record.error
        : typeof record.message === "string"
          ? record.message
          : `${fallbackMessage} (${status})`;
    const parsedRetry =
      typeof record.retryAfter === "number" ? record.retryAfter : retryAfter;
    return new AuthClientError(message, code, status, parsedRetry);
  }

  return new AuthClientError(
    `${fallbackMessage} (HTTP ${status})`,
    status === 401
      ? AUTH_ERROR_CODES.AUTH_REQUIRED
      : status === 429
        ? AUTH_ERROR_CODES.RATE_LIMITED
        : status === 503
          ? AUTH_ERROR_CODES.AUTH_UNAVAILABLE
          : `HTTP_${status}`,
    status,
    retryAfter,
  );
}

/**
 * Initiates user login via username/password or dev-mode credentials.
 * Returns either an MFA challenge (for authProtocol 2 password accounts)
 * or an immediate session (for dev/no-auth mode).
 */
export async function login(
  baseUrl: string,
  credentials: { username?: string; password?: string },
  signal?: AbortSignal,
): Promise<LoginResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/auth/login`;
  const bodyContent =
    credentials.username !== undefined || credentials.password !== undefined
      ? {
          username: credentials.username ?? "",
          password: credentials.password ?? "",
        }
      : {};

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(bodyContent),
      signal,
    });
  } catch (err) {
    throw new AuthClientError(
      err instanceof Error ? err.message : "Network error during login",
      AUTH_ERROR_CODES.NETWORK_ERROR,
      0,
    );
  }

  if (!res.ok) {
    throw await parseErrorResponse(res, "Login failed");
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") {
    throw new AuthClientError(
      "Invalid login response format from server",
      AUTH_ERROR_CODES.INCOMPATIBLE_PROTOCOL,
      res.status,
    );
  }

  // Check for MFA challenge response
  if (
    typeof data.challengeToken === "string" &&
    typeof data.challengeExpiresAt === "string" &&
    (data.state === "enrollmentRequired" || data.state === "mfaRequired")
  ) {
    if (typeof data.authProtocol !== "number" || data.authProtocol < AUTH_PROTOCOL_VERSION) {
      throw new AuthClientError(
        `Server returned authProtocol ${String(data.authProtocol)}; expected at least ${AUTH_PROTOCOL_VERSION}`,
        AUTH_ERROR_CODES.INCOMPATIBLE_PROTOCOL,
        res.status,
      );
    }
    return {
      kind: "challenge",
      data: {
        state: data.state as "enrollmentRequired" | "mfaRequired",
        challengeToken: data.challengeToken,
        challengeExpiresAt: data.challengeExpiresAt,
        authProtocol: data.authProtocol,
      },
    };
  }

  // Check for dev-mode / no-auth direct token response
  if (typeof data.token === "string" && (data.dev_mode || data.devMode || !data.state)) {
    return {
      kind: "session",
      data: {
        token: data.token,
        user: typeof data.user === "string" ? data.user : undefined,
        role: data.role === "admin" ? "admin" : "user",
        expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : undefined,
        dev_mode: Boolean(data.dev_mode ?? data.devMode),
        devMode: Boolean(data.devMode ?? data.dev_mode),
        authProtocol: typeof data.authProtocol === "number" ? data.authProtocol : undefined,
      },
    };
  }

  // Unknown response shape
  throw new AuthClientError(
    "Incompatible authentication response from server",
    AUTH_ERROR_CODES.INCOMPATIBLE_PROTOCOL,
    res.status,
  );
}

/**
 * Fetches TOTP setup parameters (QR URI, secret key, issuer, digits, period)
 * using an enrollment challenge token.
 */
export async function fetchMfaSetup(
  baseUrl: string,
  challengeToken: string,
  signal?: AbortSignal,
): Promise<MfaSetupResponse> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/auth/mfa/setup`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ challengeToken }),
      signal,
    });
  } catch (err) {
    throw new AuthClientError(
      err instanceof Error ? err.message : "Network error during MFA setup",
      AUTH_ERROR_CODES.NETWORK_ERROR,
      0,
    );
  }

  if (!res.ok) {
    throw await parseErrorResponse(res, "Failed to retrieve MFA setup parameters");
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !data ||
    typeof data.secret !== "string" ||
    typeof data.otpauthUri !== "string" ||
    typeof data.issuer !== "string" ||
    typeof data.accountName !== "string" ||
    typeof data.algorithm !== "string" ||
    typeof data.digits !== "number" ||
    typeof data.period !== "number"
  ) {
    throw new AuthClientError(
      "Incompatible MFA setup response from server",
      AUTH_ERROR_CODES.INCOMPATIBLE_PROTOCOL,
      res.status,
    );
  }

  return {
    secret: data.secret,
    otpauthUri: data.otpauthUri,
    issuer: data.issuer,
    accountName: data.accountName,
    algorithm: data.algorithm,
    digits: data.digits,
    period: data.period,
  };
}

/**
 * Confirms initial TOTP enrollment with first code and returns full session credentials.
 */
export async function confirmMfaEnrollment(
  baseUrl: string,
  challengeToken: string,
  code: string,
  signal?: AbortSignal,
): Promise<AuthSessionResponse> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/auth/mfa/confirm`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        challengeToken,
        code: code.trim(),
      }),
      signal,
    });
  } catch (err) {
    throw new AuthClientError(
      err instanceof Error ? err.message : "Network error during MFA confirmation",
      AUTH_ERROR_CODES.NETWORK_ERROR,
      0,
    );
  }

  if (!res.ok) {
    throw await parseErrorResponse(res, "MFA code verification failed");
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !data ||
    data.state !== "authenticated" ||
    typeof data.token !== "string" ||
    typeof data.expiresAt !== "string" ||
    typeof data.mfaDueAt !== "string" ||
    typeof data.user !== "string" ||
    typeof data.authProtocol !== "number" ||
    data.authProtocol < AUTH_PROTOCOL_VERSION
  ) {
    throw new AuthClientError(
      "Incompatible authenticated session response from server",
      AUTH_ERROR_CODES.INCOMPATIBLE_PROTOCOL,
      res.status,
    );
  }

  return {
    state: "authenticated",
    token: data.token,
    expiresAt: data.expiresAt,
    mfaDueAt: data.mfaDueAt,
    user: data.user,
    role: data.role === "admin" ? "admin" : "user",
    authProtocol: data.authProtocol,
  };
}

/**
 * Verifies a login MFA challenge or step-up challenge and returns updated session credentials.
 */
export async function verifyMfa(
  baseUrl: string,
  challengeToken: string,
  code: string,
  signal?: AbortSignal,
): Promise<AuthSessionResponse> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/auth/mfa/verify`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        challengeToken,
        code: code.trim(),
      }),
      signal,
    });
  } catch (err) {
    throw new AuthClientError(
      err instanceof Error ? err.message : "Network error during MFA verification",
      AUTH_ERROR_CODES.NETWORK_ERROR,
      0,
    );
  }

  if (!res.ok) {
    throw await parseErrorResponse(res, "MFA code verification failed");
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !data ||
    data.state !== "authenticated" ||
    typeof data.token !== "string" ||
    typeof data.expiresAt !== "string" ||
    typeof data.mfaDueAt !== "string" ||
    typeof data.user !== "string" ||
    typeof data.authProtocol !== "number" ||
    data.authProtocol < AUTH_PROTOCOL_VERSION
  ) {
    throw new AuthClientError(
      "Incompatible authenticated session response from server",
      AUTH_ERROR_CODES.INCOMPATIBLE_PROTOCOL,
      res.status,
    );
  }

  return {
    state: "authenticated",
    token: data.token,
    expiresAt: data.expiresAt,
    mfaDueAt: data.mfaDueAt,
    user: data.user,
    role: data.role === "admin" ? "admin" : "user",
    authProtocol: data.authProtocol,
  };
}

/**
 * Requests an in-session step-up MFA challenge using the profile's current (possibly stale) Bearer token.
 */
export async function requestMfaStepUpChallenge(
  baseUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<MfaChallengeResponse> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/auth/mfa/challenge`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal,
    });
  } catch (err) {
    throw new AuthClientError(
      err instanceof Error ? err.message : "Network error requesting step-up challenge",
      AUTH_ERROR_CODES.NETWORK_ERROR,
      0,
    );
  }

  if (!res.ok) {
    throw await parseErrorResponse(res, "Failed to request MFA step-up challenge");
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !data ||
    typeof data.challengeToken !== "string" ||
    typeof data.challengeExpiresAt !== "string" ||
    typeof data.authProtocol !== "number" ||
    data.authProtocol < AUTH_PROTOCOL_VERSION
  ) {
    throw new AuthClientError(
      "Incompatible MFA step-up challenge response from server",
      AUTH_ERROR_CODES.INCOMPATIBLE_PROTOCOL,
      res.status,
    );
  }

  return {
    challengeToken: data.challengeToken,
    challengeExpiresAt: data.challengeExpiresAt,
    authProtocol: data.authProtocol,
  };
}

/**
 * Checks authentication status and workbench protocol for a server endpoint.
 */
export async function checkAuthStatus(
  baseUrl: string,
  token?: string | null,
  signal?: AbortSignal,
): Promise<AuthStatusResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/auth/status`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers,
      credentials: "omit",
      signal,
    });
  } catch (err) {
    throw new AuthClientError(
      err instanceof Error ? err.message : "Network error checking auth status",
      AUTH_ERROR_CODES.NETWORK_ERROR,
      0,
    );
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  if (res.status === 200 && data) {
    return {
      authenticated: true,
      user: typeof data.user === "string" ? data.user : "",
      role: data.role === "admin" ? "admin" : "user",
      workbenchProtocol:
        typeof data.workbenchProtocol === "number" ? data.workbenchProtocol : 0,
      authProtocol:
        typeof data.authProtocol === "number" ? data.authProtocol : undefined,
      issuedAt: typeof data.issuedAt === "string" ? data.issuedAt : undefined,
      expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : undefined,
      mfaDueAt: typeof data.mfaDueAt === "string" ? data.mfaDueAt : undefined,
      dev_mode: Boolean(data.dev_mode ?? data.devMode),
      devMode: Boolean(data.devMode ?? data.dev_mode),
    };
  }

  if (res.status === 401 && data && data.code === "MFA_REQUIRED") {
    return {
      authenticated: false,
      code: "MFA_REQUIRED",
      error: typeof data.error === "string" ? data.error : "MFA verification required",
      user: typeof data.user === "string" ? data.user : undefined,
      expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : undefined,
      mfaDueAt: typeof data.mfaDueAt === "string" ? data.mfaDueAt : undefined,
      workbenchProtocol:
        typeof data.workbenchProtocol === "number" ? data.workbenchProtocol : 2,
      authProtocol:
        typeof data.authProtocol === "number" ? data.authProtocol : undefined,
    };
  }

  if (res.status === 401 && data) {
    return {
      authenticated: false,
      code: typeof data.code === "string" ? data.code : AUTH_ERROR_CODES.AUTH_REQUIRED,
      error: typeof data.error === "string" ? data.error : "Authentication required",
      workbenchProtocol:
        typeof data.workbenchProtocol === "number" ? data.workbenchProtocol : 2,
      authProtocol:
        typeof data.authProtocol === "number" ? data.authProtocol : undefined,
    };
  }

  if (!res.ok) {
    throw await parseErrorResponse(res, "Auth status check failed");
  }

  throw new AuthClientError(
    "Unexpected status response format from server",
    AUTH_ERROR_CODES.INCOMPATIBLE_PROTOCOL,
    res.status,
  );
}

/**
 * Logs out of the current session on the server.
 */
export async function logout(
  baseUrl: string,
  token?: string | null,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/auth/logout`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    await fetch(url, {
      method: "POST",
      headers,
      credentials: "omit",
      signal,
    });
  } catch {
    // Logout is best-effort and idempotent
  }
}
