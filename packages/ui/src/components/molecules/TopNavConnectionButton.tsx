import { useSyncExternalStore } from "react";
import {
  ConnectionDot,
  type ConnectionStatus,
} from "@/components/atoms/ConnectionDot.js";
import { cn } from "@/lib/utils.js";
import {
  getProfiles,
  subscribeToProfileChanges,
  getProfileChangeVersion,
} from "@/api/server-config.js";
import {
  getConnectionSnapshot,
  subscribeConnections,
} from "@/api/connections.js";

interface TopNavConnectionButtonProps {
  activeProfileName?: string;
  compactLabelClass: string;
  compactMobileMenuOpen: boolean;
  devMode: boolean;
  isCompactWorkspace: boolean;
  onClick: () => void;
  status: ConnectionStatus;
}

export function TopNavConnectionButton({
  activeProfileName,
  compactLabelClass,
  compactMobileMenuOpen,
  devMode,
  isCompactWorkspace,
  onClick,
  status: fallbackStatus,
}: TopNavConnectionButtonProps) {
  // Subscribe to profile list changes
  useSyncExternalStore(
    subscribeToProfileChanges,
    () => getProfileChangeVersion(),
    () => 0,
  );

  const profiles = getProfiles();

  // Subscribe to connection snapshots
  useSyncExternalStore(
    subscribeConnections,
    () => profiles.map((p) => getConnectionSnapshot(p.id)?.status ?? "none").join(":"),
    () => "",
  );

  const snapshots = profiles.map((p) => getConnectionSnapshot(p.id));
  const connectedCount = snapshots.filter((s) => s?.status === "connected").length;
  const connectingCount = snapshots.filter((s) => s?.status === "connecting").length;

  let overallStatus: ConnectionStatus = fallbackStatus;
  if (profiles.length === 0) {
    overallStatus = "disconnected";
  } else if (connectedCount > 0) {
    overallStatus = "connected";
  } else if (connectingCount > 0) {
    overallStatus = "connecting";
  } else {
    overallStatus = "disconnected";
  }

  const labelText = (() => {
    if (profiles.length === 0) return "No connections";
    if (profiles.length === 1) return profiles[0].name;
    return `${connectedCount}/${profiles.length} connected`;
  })();

  const titleText =
    profiles.length > 0
      ? `Server connections: ${connectedCount}/${profiles.length} connected (click to manage)`
      : "No server connections configured (click to add)";

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-sm px-2 py-1 transition-colors hover:bg-[var(--color-surface-2)]"
      title={titleText}
    >
      <ConnectionDot
        status={overallStatus}
        collapsed={isCompactWorkspace}
        devMode={devMode}
      />
      <span
        className={cn(
          "font-bold tracking-wider text-[var(--color-text-muted)] uppercase",
          isCompactWorkspace
            ? compactMobileMenuOpen
              ? compactLabelClass
              : "hidden"
            : "hidden text-[10px] xl:inline",
        )}
      >
        {labelText}
      </span>
    </button>
  );
}
