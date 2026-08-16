/**
 * Server connection configuration — persists backend URL and auth token across sessions.
 *
 * URL: localStorage (survives tab close, shared across tabs)
 * Token: localStorage, scoped by profile ID (survives browser/app recreation)
 *
 * Priority for URL: localStorage → VITE_DAM_HOPPER_SERVER_URL env → same-origin fallback
 */

const KEY_URL = "damhopper_server_url";
const KEY_TOKEN = "damhopper_auth_token";
const KEY_USERNAME = "damhopper_auth_username";
const KEY_PROFILES = "damhopper_server_profiles";
const KEY_ACTIVE_PROFILE = "damhopper_active_profile_id";
const PROFILE_CHANGED_EVENT = "damhopper:profile-changed";
let profileChangeVersion = 0;

export type KnownServerProfiles =
  | { status: "available"; profiles: ServerProfile[] }
  | { status: "unavailable" };
export type ServerProfileChange =
  | { type: "activeChanged"; activeProfileId: string | null }
  | {
      type: "deleted";
      deletedProfileId: string;
      knownProfileIds: { status: "available"; ids: string[] } | { status: "unavailable" };
    };
const profileChangeListeners = new Set<(event: ServerProfileChange) => void>();

/** Server profile interface */
export interface ServerProfile {
  id: string; // UUID v4
  name: string; // "Local Dev", "Production", etc.
  url: string; // "http://localhost:4800"
  authType: "basic" | "none"; // Authentication method
  username?: string; // For basic auth display (password never stored)
  createdAt: number; // Unix timestamp
}

function hasUnsupportedUrlScheme(url: string): boolean {
  const trimmed = url.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return false;
  return !/^(?:[a-z\d.-]+|\[[0-9a-f:]+\]):\d+(?:[/?#]|$)/i.test(trimmed);
}

function isHttpServerUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return (
      (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
      Boolean(parsedUrl.hostname)
    );
  } catch {
    return false;
  }
}

function getConfiguredServerUrl(): string | null {
  const env = (
    import.meta as ImportMeta & {
      env?: {
        DEV?: boolean;
        VITE_DAM_HOPPER_SERVER_URL?: string;
      };
    }
  ).env;
  const envUrl = env?.VITE_DAM_HOPPER_SERVER_URL;
  if (!envUrl?.trim()) return null;

  // In development, Vite's proxy keeps the browser same-origin.
  const candidate =
    env?.DEV && typeof location !== "undefined"
      ? `${location.protocol}//${location.host}`
      : envUrl;
  const normalized = normalizeServerUrl(candidate);
  return isHttpServerUrl(normalized) ? normalized : null;
}

/** Returns the configured server URL, stripping trailing slash. */
export function getServerUrl(): string {
  // Priority 1: Active profile
  const activeProfile = getActiveProfile();
  if (activeProfile) {
    return activeProfile.url.replace(/\/$/, "");
  }

  // Native mobile and unknown native hosts stay same-origin until a native
  // HTTP/WebSocket transport exists. Windows desktop uses the existing
  // browser transport with an exact backend CORS allowlist.
  if (isNativeBrowserHost() && !isNativeWindowsHost()) {
    return `${location.protocol}//${location.host}`;
  }

  // Priority 2: Legacy localStorage (for migration period)
  try {
    const stored = localStorage.getItem(KEY_URL);
    const normalizedStored = stored ? normalizeServerUrl(stored) : "";
    if (isHttpServerUrl(normalizedStored)) return normalizedStored;
  } catch {
    // localStorage may be unavailable in some environments
  }

  // Priority 3: Env var
  const configuredUrl = getConfiguredServerUrl();
  if (configuredUrl) return configuredUrl;

  // Fallback: same origin
  return `${location.protocol}//${location.host}`;
}

/** Normalize a server URL for storage and security-sensitive comparisons. */
export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim();
  if (hasUnsupportedUrlScheme(trimmed)) return "";
  let normalized = trimmed.replace(/\/+$/, "");
  if (normalized && !/^https?:\/\//i.test(normalized)) {
    normalized = `http://${normalized}`;
  }
  return normalized;
}

/** Whether two server URLs identify different backend endpoints. */
export function haveServerUrlsChanged(
  previousUrl: string,
  nextUrl: string,
): boolean {
  return normalizeServerUrl(previousUrl) !== normalizeServerUrl(nextUrl);
}

/**
 * Whether an unchanged token must be discarded after a server URL change.
 * A replacement token entered for the new server is allowed to be stored.
 */
export function shouldClearAuthTokenForUrlChange(
  previousUrl: string,
  nextUrl: string,
  previousToken: string | null,
  nextToken: string,
): boolean {
  return (
    haveServerUrlsChanged(previousUrl, nextUrl) &&
    (previousToken ?? "").trim() === nextToken.trim()
  );
}

/**
 * Persist server URL. Normalizes format: strips trailing slash, auto-prepends
 * `http://` if no protocol detected (e.g., `localhost:4800` → `http://localhost:4800`).
 */
export function setServerUrl(url: string): boolean {
  try {
    const normalized = normalizeServerUrl(url);
    if (!normalized || !isHttpServerUrl(normalized)) return false;
    localStorage.setItem(KEY_URL, normalized);
    return localStorage.getItem(KEY_URL) === normalized;
  } catch {
    return false;
  }
}

/** Remove the persisted URL override (reverts to env var or same-origin). */
export function clearServerUrl(): boolean {
  try {
    localStorage.removeItem(KEY_URL);
    return localStorage.getItem(KEY_URL) === null;
  } catch {
    return false;
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

/** Get token storage key. Undefined is reserved for legacy single-server mode. */
function tokenKey(profileId?: string): string {
  return profileId ? `damhopper_auth_token_${profileId}` : KEY_TOKEN;
}

function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return localStorage.getItem(key) === value;
  } catch {
    return false;
  }
}

function removeLocalStorage(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return localStorage.getItem(key) === null;
  } catch {
    return false;
  }
}

function readSessionStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeSessionStorage(key: string): boolean {
  try {
    sessionStorage.removeItem(key);
    return sessionStorage.getItem(key) === null;
  } catch {
    return false;
  }
}

/** Returns the profile-scoped auth token, migrating old session storage when found. */
export function getAuthToken(profileId?: string): string | null {
  const key = tokenKey(profileId);
  const persistent = readLocalStorage(key);
  if (persistent) return persistent;

  const legacySessionToken = readSessionStorage(key);
  if (legacySessionToken && writeLocalStorage(key, legacySessionToken)) {
    removeSessionStorage(key);
  }
  return legacySessionToken;
}

/** Persist auth token in profile-scoped localStorage. */
export function setAuthToken(token: string, profileId?: string): boolean {
  const key = tokenKey(profileId);
  if (writeLocalStorage(key, token)) {
    removeSessionStorage(key);
    notifyProfileChange();
    return true;
  }
  return false;
}

/** Remove stored auth token from both current and legacy storage. */
export function clearAuthToken(profileId?: string): boolean {
  const key = tokenKey(profileId);
  const localStorageCleared = removeLocalStorage(key);
  const sessionStorageCleared = removeSessionStorage(key);
  notifyProfileChange();
  return localStorageCleared && sessionStorageCleared;
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
 * Cross-origin API access requires the server's exact CORS allowlist entry.
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
export function buildAuthHeaders(profileId?: string): Record<string, string> {
  const token = getAuthToken(profileId);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ===========================
// Multi-Server Profile Management
// ===========================

/** Generate UUID v4 */
function uuid(): string {
  return crypto.randomUUID();
}

/** Reads profiles without confusing unavailable storage with an empty list. */
export function readServerProfiles(): KnownServerProfiles {
  try {
    const stored = localStorage.getItem(KEY_PROFILES);
    if (!stored) return { status: "available", profiles: [] };
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return { status: "available", profiles: [] };
    const seenIds = new Set<string>();
    const profiles = parsed
      .filter(isServerProfile)
      .map((profile) => ({ ...profile, url: normalizeServerUrl(profile.url) }))
      .filter((profile) => !seenIds.has(profile.id) && Boolean(seenIds.add(profile.id)));
    return { status: "available", profiles };
  } catch {
    return { status: "unavailable" };
  }
}

/** Get all server profiles from localStorage, preserving legacy empty fallback. */
export function getProfiles(): ServerProfile[] {
  const result = readServerProfiles();
  return result.status === "available" ? result.profiles : [];
}

function isServerProfile(value: unknown): value is ServerProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<ServerProfile>;
  const normalizedUrl =
    typeof profile.url === "string" ? normalizeServerUrl(profile.url) : "";
  return (
    typeof profile.id === "string" &&
    profile.id.trim().length > 0 &&
    typeof profile.name === "string" &&
    profile.name.trim().length > 0 &&
    typeof profile.url === "string" &&
    isHttpServerUrl(normalizedUrl) &&
    (profile.authType === "basic" || profile.authType === "none") &&
    (profile.username === undefined || typeof profile.username === "string") &&
    typeof profile.createdAt === "number" &&
    Number.isFinite(profile.createdAt)
  );
}

/** Save all profiles to localStorage */
export function saveProfiles(profiles: ServerProfile[]): boolean {
  try {
    const serialized = JSON.stringify(profiles);
    localStorage.setItem(KEY_PROFILES, serialized);
    if (localStorage.getItem(KEY_PROFILES) !== serialized) return false;
    notifyProfileChange();
    return true;
  } catch {
    return false;
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

function isNativeBrowserHost(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset.appHost === "native"
  );
}

/** Whether this is the supported Windows desktop native host. */
export function isNativeWindowsHost(): boolean {
  return (
    isNativeBrowserHost() &&
    document.documentElement.dataset.appPlatform === "windows"
  );
}

function isSameOriginProfile(profile: ServerProfile): boolean {
  if (!isNativeBrowserHost() || isNativeWindowsHost()) return true;
  if (typeof window === "undefined") return true;

  try {
    return (
      new URL(normalizeServerUrl(profile.url), window.location.href).origin ===
      window.location.origin
    );
  } catch {
    return false;
  }
}

/** Get the currently active profile */
export function getActiveProfile(): ServerProfile | null {
  const id = getActiveProfileId();
  if (!id) return null;
  return (
    getProfiles().find((p) => p.id === id && isSameOriginProfile(p)) ?? null
  );
}

/** Set the active profile by ID */
export function setActiveProfile(id: string): boolean {
  if (!getProfiles().some((profile) => profile.id === id)) return false;
  try {
    localStorage.setItem(KEY_ACTIVE_PROFILE, id);
    if (localStorage.getItem(KEY_ACTIVE_PROFILE) !== id) return false;
    notifyProfileChange({ type: "activeChanged", activeProfileId: id });
    return true;
  } catch {
    return false;
  }
}

export function clearActiveProfile(): boolean {
  try {
    localStorage.removeItem(KEY_ACTIVE_PROFILE);
    if (localStorage.getItem(KEY_ACTIVE_PROFILE) !== null) return false;
    notifyProfileChange({ type: "activeChanged", activeProfileId: null });
    return true;
  } catch {
    return false;
  }
}

/** Create a new server profile */
export function createProfile(
  data: Omit<ServerProfile, "id" | "createdAt">,
): ServerProfile {
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
export function updateProfile(
  id: string,
  data: Partial<Omit<ServerProfile, "id" | "createdAt">>,
): boolean {
  const profiles = getProfiles();
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx >= 0) {
    profiles[idx] = { ...profiles[idx], ...data };
    return saveProfiles(profiles);
  }
  return false;
}

/** Delete a profile by ID */
export function deleteProfile(id: string): boolean {
  const previousProfiles = getProfiles();
  const profile = previousProfiles.find((candidate) => candidate.id === id);
  if (!profile) return false;

  const previousActiveId = getActiveProfileId();
  const previousToken = getAuthToken(id);
  const nextProfiles = previousProfiles.filter(
    (candidate) => candidate.id !== id,
  );
  const restoreToken = () => {
    if (!previousToken) return clearAuthToken(id);
    return (
      setAuthToken(previousToken, id) && getAuthToken(id) === previousToken
    );
  };

  if (!clearAuthToken(id)) {
    restoreToken();
    return false;
  }

  if (!saveProfiles(nextProfiles)) {
    restoreToken();
    return false;
  }

  if (previousActiveId === id) {
    const activeUpdated = nextProfiles[0]
      ? setActiveProfile(nextProfiles[0].id)
      : clearActiveProfile();
    if (!activeUpdated) {
      const profilesRestored = saveProfiles(previousProfiles);
      const activeRestored = previousActiveId
        ? setActiveProfile(previousActiveId)
        : clearActiveProfile();
      const tokenRestored = restoreToken();
      if (!profilesRestored || !activeRestored || !tokenRestored) return false;
      return false;
    }
  }
  const profiles = readServerProfiles();
  notifyProfileChange({
    type: "deleted",
    deletedProfileId: id,
    knownProfileIds: profiles.status === "available"
      ? { status: "available", ids: profiles.profiles.map((candidate) => candidate.id) }
      : { status: "unavailable" },
  });
  return true;
}

/** Migrate legacy single-server config to profile system */
export function migrateToProfiles(): void {
  const profiles = getProfiles();
  if (profiles.length > 0) {
    const activeId = getActiveProfileId();
    const activeProfile = profiles.find((profile) => profile.id === activeId);
    const targetProfile = activeProfile ?? profiles[0];
    if (!activeProfile) setActiveProfile(targetProfile.id);

    let legacyUrl: string | null = null;
    try {
      legacyUrl = localStorage.getItem(KEY_URL);
    } catch {
      // ignore
    }
    const existingToken = getAuthToken();
    const legacyMatchesTarget =
      legacyUrl !== null &&
      !haveServerUrlsChanged(legacyUrl, targetProfile.url);
    if (existingToken) {
      if (!legacyMatchesTarget) {
        // An unbound legacy token must not be copied to an unrelated profile.
        clearAuthToken();
        return;
      }
      if (!getAuthToken(targetProfile.id)) {
        setAuthToken(existingToken, targetProfile.id);
      }
      if (getAuthToken(targetProfile.id)) clearAuthToken();
    }
    return;
  }

  let persistedUrl: string | null = null;
  try {
    persistedUrl = localStorage.getItem(KEY_URL);
  } catch {
    persistedUrl = null;
  }
  const existingUsername = getAuthUsername();
  const existingToken = getAuthToken();
  const existingUrl = persistedUrl ?? getConfiguredServerUrl();

  if (existingUrl && isHttpServerUrl(normalizeServerUrl(existingUrl))) {
    const profile = createProfile({
      name: "Default Server",
      url: normalizeServerUrl(existingUrl),
      authType: "basic",
      username: existingUsername || undefined,
    });
    setActiveProfile(profile.id);
    if (existingToken && persistedUrl) {
      setAuthToken(existingToken, profile.id);
      if (getAuthToken(profile.id)) clearAuthToken();
    } else if (existingToken) {
      // Environment configuration does not bind an old legacy token safely.
      clearAuthToken();
    }
  } else if (existingToken) {
    // Without a URL there is no safe backend binding for a legacy token.
    clearAuthToken();
  }
}

function notifyProfileChange(event?: ServerProfileChange): void {
  profileChangeVersion += 1;
  if (event) for (const listener of profileChangeListeners) listener(event);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT));
}

/** Monotonic revision for active profile, profile metadata, and token changes. */
export function getProfileChangeVersion(): number {
  return profileChangeVersion;
}

/** Subscribe to active-profile and profile-list changes in this tab and other tabs. */
export function subscribeToProfileChanges(callback: (event: ServerProfileChange) => void): () => void {
  if (typeof window === "undefined") return () => {};

  profileChangeListeners.add(callback);
  const onProfileChange = () => callback({ type: "activeChanged", activeProfileId: getActiveProfileId() });
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === KEY_ACTIVE_PROFILE ||
      event.key === KEY_PROFILES ||
      event.key === KEY_TOKEN ||
      event.key?.startsWith(`${KEY_TOKEN}_`)
    ) {
      profileChangeVersion += 1;
      callback({ type: "activeChanged", activeProfileId: getActiveProfileId() });
    }
  };
  window.addEventListener(PROFILE_CHANGED_EVENT, onProfileChange);
  window.addEventListener("storage", onStorage);
  return () => {
    profileChangeListeners.delete(callback);
    window.removeEventListener(PROFILE_CHANGED_EVENT, onProfileChange);
    window.removeEventListener("storage", onStorage);
  };
}
