import {
  isNativeWindowsHost,
  type ServerProfile,
} from "@dam-hopper/ui/api/server-config";

/**
 * Checks whether a server profile is supported on this native host.
 * Browser/Windows allow current HTTP(S) remote transport; non-Windows native stays exact same-origin-only.
 * Unsupported profiles remain editable/listed and produce no fallback traffic.
 */
export function isProfileSupportedOnNative(profile: ServerProfile): boolean {
  if (isNativeWindowsHost()) {
    return true;
  }
  try {
    const parsed = new URL(profile.url);
    const hostOrigin =
      typeof location !== "undefined" ? location.origin : "";
    return parsed.origin === hostOrigin;
  } catch {
    return false;
  }
}
