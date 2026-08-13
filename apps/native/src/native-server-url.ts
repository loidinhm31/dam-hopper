import {
  getActiveProfile,
  migrateToProfiles,
} from "@dam-hopper/ui/api/server-config";

export function getNativeServerUrl(): string | null {
  migrateToProfiles();

  const activeProfile = getActiveProfile();
  if (!activeProfile) return null;

  const serverUrl = activeProfile.url.replace(/\/$/, "");
  try {
    // The backend no longer emits CORS headers. Native browser transport can
    // connect only when the profile shares the packaged page origin.
    return new URL(serverUrl).origin === window.location.origin
      ? serverUrl
      : null;
  } catch {
    return null;
  }
}
