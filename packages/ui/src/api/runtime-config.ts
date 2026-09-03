/**
 * Bounded runtime configuration fetching and validation for web deployments.
 */

export const RUNTIME_CONFIG_ENDPOINT = "/__dam-hopper/runtime-config.json";
export const MAX_RUNTIME_CONFIG_BYTES = 4096;
const DEFAULT_FETCH_TIMEOUT_MS = 2000;

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RuntimeConfig {
  schemaVersion: 1;
  releaseVersion: string;
  profileId: string;
  apiUrl: string;
}

/**
 * Validate a candidate runtime configuration object against strict security rules.
 */
export function validateRuntimeConfig(data: unknown): RuntimeConfig | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }

  const candidate = data as Record<string, unknown>;

  if (candidate.schemaVersion !== 1) {
    return null;
  }

  if (
    typeof candidate.releaseVersion !== "string" ||
    candidate.releaseVersion.trim().length === 0
  ) {
    return null;
  }

  if (
    typeof candidate.profileId !== "string" ||
    !UUID_V4_REGEX.test(candidate.profileId)
  ) {
    return null;
  }

  if (typeof candidate.apiUrl !== "string") {
    return null;
  }

  const normalizedApiUrl = validateAndNormalizeApiUrl(candidate.apiUrl);
  if (!normalizedApiUrl) {
    return null;
  }

  return {
    schemaVersion: 1,
    releaseVersion: candidate.releaseVersion.trim(),
    profileId: candidate.profileId.toLowerCase(),
    apiUrl: normalizedApiUrl,
  };
}

/**
 * Validates that an API URL is an exact HTTP(S) origin with no credentials, query, or fragment.
 */
export function validateAndNormalizeApiUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    if (parsed.username || parsed.password) {
      return null;
    }

    if (parsed.search || parsed.hash) {
      return null;
    }

    if (parsed.pathname !== "" && parsed.pathname !== "/") {
      return null;
    }

    // Return origin (strips trailing slash and normalizes host/port)
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Fetch and strictly validate the reserved runtime configuration.
 *
 * Fails closed (returns null) on missing config (404), timeouts, size violations,
 * or validation errors without throwing.
 */
export async function fetchRuntimeConfig(
  endpoint = RUNTIME_CONFIG_ENDPOINT,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<RuntimeConfig | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RUNTIME_CONFIG_BYTES) {
      return null;
    }

    const text = await response.text();
    if (text.length > MAX_RUNTIME_CONFIG_BYTES) {
      return null;
    }

    const json = JSON.parse(text);
    return validateRuntimeConfig(json);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
