import {
  getActiveProfile,
  migrateToProfiles,
} from "@dam-hopper/ui/api/server-config";

export function getNativeServerUrl(): string | null {
  migrateToProfiles();

  const activeProfile = getActiveProfile();
  if (activeProfile) {
    return activeProfile.url.replace(/\/$/, "");
  }

  return null;
}
