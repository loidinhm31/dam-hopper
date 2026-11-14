import { useQuery } from "@tanstack/react-query";
import { getConnectionSnapshot } from "./connections.js";
import type { ConnectionRef } from "./ownership.js";
import { requestBrowserHostJson } from "./browser-host-client.js";
import { profileQueryKey } from "./query-client.js";
import { getActiveProfileId } from "./server-config.js";

/**
 * Subset of `GET /api/browser/capabilities` the Settings page needs.
 * Mirrors the server `BrowserCapabilitiesDto` (camelCase): the host manager
 * snapshots `[server.browser]` at startup, so this reflects the RUNNING host,
 * not the saved config.
 */
export interface BrowserHostLiveStatus {
  available: boolean;
  unavailableReason?: string | null;
  engineQualified?: boolean;
  managedProfilePresent?: boolean;
}

/** Explicit target owner, else the active profile's current connection. */
function resolveLiveStatusOwner(owner?: ConnectionRef): ConnectionRef | undefined {
  if (owner) return owner;
  const activeId = getActiveProfileId();
  return activeId ? (getConnectionSnapshot(activeId)?.owner ?? undefined) : undefined;
}

export function useBrowserHostLiveStatus(
  targetOwner: ConnectionRef | undefined,
  enabled: boolean,
) {
  const owner = resolveLiveStatusOwner(targetOwner);
  return useQuery<BrowserHostLiveStatus>({
    queryKey: owner
      ? profileQueryKey(owner, "browser-host", "live-status")
      : ["browser-host", "live-status", "no-owner"],
    queryFn: ({ signal }) =>
      requestBrowserHostJson<BrowserHostLiveStatus>(
        owner as ConnectionRef,
        "/api/browser/capabilities",
        { signal },
      ),
    enabled: enabled && Boolean(owner),
    staleTime: 5_000,
    retry: false,
  });
}
