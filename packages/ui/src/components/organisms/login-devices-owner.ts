import { useMemo, useSyncExternalStore } from "react";
import {
  getAuthToken, getProfileChangeVersion, getProfiles, isSameOriginProfile,
  normalizeServerUrl, subscribeToProfileChanges,
} from "@/api/server-config.js";
import {
  disconnectProfile, getConnectionSnapshot, subscribeConnections,
} from "@/api/connections.js";
import { clearAuthToken } from "@/api/server-config.js";

export interface LoginDevicesOwner {
  readonly profileId: string;
  readonly serverUrl: string;
  readonly token: string | null;
  readonly generation: number | null;
  readonly authType: "basic" | "none";
}

export function useLoginDevicesOwner(profileId: string | null): LoginDevicesOwner | null {
  useSyncExternalStore(subscribeToProfileChanges, getProfileChangeVersion, () => 0);
  const snapshot = useSyncExternalStore(subscribeConnections,
    () => profileId ? getConnectionSnapshot(profileId) : null, () => null);
  const profile = getProfiles().find((item) => item.id === profileId);
  const serverUrl = profile ? normalizeServerUrl(profile.url) : "";
  const token = profile ? getAuthToken(profile.id) : null;
  const generation = snapshot?.owner.generation ?? null;
  const authType = profile?.authType;
  const supported = profile ? isSameOriginProfile(profile) : false;
  return useMemo(() => profileId && serverUrl && authType && supported
    ? { profileId, serverUrl, token, generation, authType } : null,
  [profileId, serverUrl, token, generation, authType, supported]);
}

/** Saved target identity, without granting credential/runtime cleanup authority. */
export function isLoginDevicesOwnerTargetCurrent(owner: LoginDevicesOwner): boolean {
  const profile = getProfiles().find((item) => item.id === owner.profileId);
  return Boolean(profile && normalizeServerUrl(profile.url) === owner.serverUrl &&
    profile.authType === owner.authType);
}

export function isLoginDevicesOwnerCurrent(owner: LoginDevicesOwner): boolean {
  const profile = getProfiles().find((item) => item.id === owner.profileId);
  return Boolean(profile && normalizeServerUrl(profile.url) === owner.serverUrl &&
    profile.authType === owner.authType && getAuthToken(owner.profileId) === owner.token &&
    (getConnectionSnapshot(owner.profileId)?.owner.generation ?? null) === owner.generation);
}

/** WS 4401 may retire the login before its acknowledged DELETE arrives. */
export function isLoginDevicesOwnerRetired(owner: LoginDevicesOwner): boolean {
  const profile = getProfiles().find((item) => item.id === owner.profileId);
  const snapshot = getConnectionSnapshot(owner.profileId);
  return Boolean(profile && normalizeServerUrl(profile.url) === owner.serverUrl &&
    profile.authType === owner.authType && getAuthToken(owner.profileId) === null &&
    snapshot?.status === "login-required" && snapshot.authCode === "AUTH_REQUIRED" &&
    owner.generation !== null && snapshot.owner.generation > owner.generation);
}

/** Synchronous exact-owner cleanup; never clears a replacement login or another profile. */
export function completeLoginDeviceSelfRevoke(owner: LoginDevicesOwner): void {
  if (!isLoginDevicesOwnerCurrent(owner) || !owner.token) return;
  // Token notification can retire the connection synchronously. Clear first so a
  // storage failure is still reported to the original owner, not a retired one.
  clearAuthToken(owner.profileId);
  const remaining = getAuthToken(owner.profileId);
  if (remaining === owner.token) {
    throw new Error("Session revoked, but unable to clear its saved login token. Remove it in server settings.");
  }
  const profile = getProfiles().find((item) => item.id === owner.profileId);
  if (remaining === null && owner.generation !== null &&
      profile && normalizeServerUrl(profile.url) === owner.serverUrl &&
      profile.authType === owner.authType &&
      getConnectionSnapshot(owner.profileId)?.owner.generation === owner.generation) {
    disconnectProfile(owner.profileId);
  }
}
