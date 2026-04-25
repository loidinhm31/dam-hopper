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
const KEY_PROFILES = "damhopper_server_profiles";
const KEY_ACTIVE_PROFILE = "damhopper_active_profile_id";

/** Server profile interface */
export interface ServerProfile {
  id: string;                    // UUID v4
  name: string;                  // "Local Dev", "Production", etc.
  url: string;                   // "http://localhost:4800"
  authType: "basic" | "none";    // Authentication method
  username?: string;             // For basic auth display (password never stored)
  createdAt: number;             // Unix timestamp
}

/** Returns the configured server URL, stripping trailing slash. */
export function getServerUrl(): string {
  // Priority 1: Active profile
  const activeProfile = getActiveProfile();
  if (activeProfile) {
    return activeProfile.url.replace(/\/$/, "");
  }
  
  // Priority 2: Legacy localStorage (for migration period)
  try {
    const stored = localStorage.getItem(KEY_URL);
    if (stored) return stored;
  } catch {
    // localStorage may be unavailable in some environments
  }
  
  // Priority 3: Env var
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
  
  // Fallback: same origin
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

/** Get token storage key for profile-aware storage */
function tokenKey(profileId?: string): string {
  const id = profileId || getActiveProfileId();
  return id ? `damhopper_auth_token_${id}` : KEY_TOKEN;
}

/** Returns the auth token stored in sessionStorage, or null if not set. */
export function getAuthToken(profileId?: string): string | null {
  try {
    return sessionStorage.getItem(tokenKey(profileId));
  } catch {
    return null;
  }
}

/** Persist auth token in sessionStorage (cleared on tab close). */
export function setAuthToken(token: string, profileId?: string): void {
  try {
    sessionStorage.setItem(tokenKey(profileId), token);
  } catch {
    // ignore
  }
}

/** Remove stored auth token (logout). */
export function clearAuthToken(profileId?: string): void {
  try {
    sessionStorage.removeItem(tokenKey(profileId));
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

/**
 * Whether the hostname is a local loopback address.
 */
function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0"
  );
}

/**
 * Whether the configured server is running on the same host as the browser.
 * When true, "Open localhost" shortcuts are shown in the Ports panel.
 */
export function isLocalServer(): boolean {
  try {
    const serverUrl = getServerUrl();
    const serverHostname = new URL(serverUrl).hostname;
    // Both page and backend must be on loopback for it to be considered local
    return isLoopback(location.hostname) && isLoopback(serverHostname);
  } catch {
    // If URL parsing fails, fallback to just checking location.hostname
    return isLoopback(location.hostname);
  }
}

/** Build auth headers for fetch calls. Returns empty object if no token set. */
export function buildAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ===========================
// Multi-Server Profile Management
// ===========================

/** Generate UUID v4 */
function uuid(): string {
  return crypto.randomUUID();
}

/** Get all server profiles from localStorage */
export function getProfiles(): ServerProfile[] {
  try {
    const stored = localStorage.getItem(KEY_PROFILES);
    if (stored) return JSON.parse(stored) as ServerProfile[];
  } catch {
    // ignore parse errors
  }
  return [];
}

/** Save all profiles to localStorage */
export function saveProfiles(profiles: ServerProfile[]): void {
  try {
    localStorage.setItem(KEY_PROFILES, JSON.stringify(profiles));
  } catch {
    // ignore
  }
}

/** Get active profile ID */
export function getActiveProfileId(): string | null {
  try {
    return localStorage.getItem(KEY_ACTIVE_PROFILE);
  } catch {
    return null;
  }
}

/** Get the currently active profile */
export function getActiveProfile(): ServerProfile | null {
  const id = getActiveProfileId();
  if (!id) return null;
  return getProfiles().find(p => p.id === id) ?? null;
}

/** Set the active profile by ID */
export function setActiveProfile(id: string): void {
  try {
    localStorage.setItem(KEY_ACTIVE_PROFILE, id);
  } catch {
    // ignore
  }
}

/** Create a new server profile */
export function createProfile(data: Omit<ServerProfile, "id" | "createdAt">): ServerProfile {
  const profile: ServerProfile = {
    ...data,
    id: uuid(),
    createdAt: Date.now(),
  };
  const profiles = getProfiles();
  profiles.push(profile);
  saveProfiles(profiles);
  return profile;
}

/** Update an existing profile by ID */
export function updateProfile(id: string, data: Partial<Omit<ServerProfile, "id" | "createdAt">>): void {
  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.id === id);
  if (idx >= 0) {
    profiles[idx] = { ...profiles[idx], ...data };
    saveProfiles(profiles);
  }
}

/** Delete a profile by ID */
export function deleteProfile(id: string): void {
  const profiles = getProfiles().filter(p => p.id !== id);
  saveProfiles(profiles);
  // If deleted active profile, clear active
  if (getActiveProfileId() === id) {
    try {
      localStorage.removeItem(KEY_ACTIVE_PROFILE);
    } catch {
      // ignore
    }
  }
}

/** Migrate legacy single-server config to profile system */
export function migrateToProfiles(): void {
  if (getProfiles().length > 0) return; // Already migrated
  
  const existingUrl = localStorage.getItem(KEY_URL);
  const existingUsername = getAuthUsername();
  
  if (existingUrl && existingUrl !== `${location.protocol}//${location.host}`) {
    const profile = createProfile({
      name: "Default Server",
      url: existingUrl,
      authType: "basic",
      username: existingUsername || undefined,
    });
    setActiveProfile(profile.id);
  }
}

