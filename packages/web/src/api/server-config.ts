/**
 * Server connection configuration — persists backend URL and auth token across sessions.
 *
 * URL: localStorage (survives tab close, shared across tabs)
 * Token: sessionStorage (cleared on tab close, isolated per tab)
 *
 * Priority for URL: localStorage → VITE_DAM_HOPPER_SERVER_URL env → same-origin fallback
 */

const KEY_URL = "damhopper_server_url";
const KEY_TOKEN = "damhopper_auth_token";
const KEY_USERNAME = "damhopper_auth_username";

/** Returns the configured server URL, stripping trailing slash. */
export function getServerUrl(): string {
  try {
    const stored = localStorage.getItem(KEY_URL);
    if (stored) return stored;
  } catch {
    // localStorage may be unavailable in some environments
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const envUrl = (import.meta as any).env?.VITE_DAM_HOPPER_SERVER_URL as string | undefined;
  if (envUrl) {
    // In dev mode, let Vite's proxy forward /api/* and /ws to the remote server.
    // This avoids cross-origin requests entirely — no CORS configuration needed on the server.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((import.meta as any).env?.DEV) {
      return `${location.protocol}//${location.host}`;
    }
    return envUrl.replace(/\/$/, "");
  }
  return `${location.protocol}//${location.host}`;
}

/**
 * Persist server URL. Normalizes format: strips trailing slash, auto-prepends
 * `http://` if no protocol detected (e.g., `localhost:4800` → `http://localhost:4800`).
 */
export function setServerUrl(url: string): void {
  try {
    let normalized = url.trim().replace(/\/$/, "");
    if (normalized && !/^https?:\/\//i.test(normalized)) {
      normalized = `http://${normalized}`;
    }
    localStorage.setItem(KEY_URL, normalized);
  } catch {
    // ignore
  }
}

/** Remove the persisted URL override (reverts to env var or same-origin). */
export function clearServerUrl(): void {
  try {
    localStorage.removeItem(KEY_URL);
  } catch {
    // ignore
  }
}

/** Whether an explicit server URL has been configured (not same-origin default). */
export function hasServerUrl(): boolean {
  try {
    return !!localStorage.getItem(KEY_URL);
  } catch {
    return false;
  }
}

/** Returns the auth token stored in sessionStorage, or null if not set. */
export function getAuthToken(): string | null {
  try {
    return sessionStorage.getItem(KEY_TOKEN);
  } catch {
    return null;
  }
}

/** Persist auth token in sessionStorage (cleared on tab close). */
export function setAuthToken(token: string): void {
  try {
    sessionStorage.setItem(KEY_TOKEN, token);
  } catch {
    // ignore
  }
}

/** Remove stored auth token (logout). */
export function clearAuthToken(): void {
  try {
    sessionStorage.removeItem(KEY_TOKEN);
  } catch {
    // ignore
  }
}

/** Returns the auth username stored in sessionStorage, or empty string if not set. */
export function getAuthUsername(): string {
  try {
    return sessionStorage.getItem(KEY_USERNAME) || "";
  } catch {
    return "";
  }
}

/** Persist auth username in sessionStorage. */
export function setAuthUsername(username: string): void {
  try {
    sessionStorage.setItem(KEY_USERNAME, username);
  } catch {
    // ignore
  }
}

/** Remove stored auth username. */
export function clearAuthUsername(): void {
  try {
    sessionStorage.removeItem(KEY_USERNAME);
  } catch {
    // ignore
  }
}

/**
 * Whether the configured server is cross-origin relative to the current page.
 * Same-origin: cookies work, no special auth headers needed.
 * Cross-origin: must use Bearer token in Authorization header.
 */
export function isCrossOriginServer(serverUrl: string): boolean {
  try {
    return new URL(serverUrl).origin !== location.origin;
  } catch {
    return false;
  }
}

/** Build auth headers for fetch calls. Returns empty object if no token set. */
export function buildAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
