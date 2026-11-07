import { useCallback } from "react";
import type { OsWindow } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { PortsPanel } from "@/components/organisms/PortsPanel.js";
import { dispatchIntent, createIntent } from "../intents.js";
import type { TunnelInfo } from "@/api/client.js";

export interface PortsTunnelsAppProps {
  window: OsWindow;
}

export function PortsTunnelsApp({ window }: PortsTunnelsAppProps) {
  const owner = useWindowOwner();
  const profileId = owner.profileId;

  const handleOpenTunnelInBrowser = useCallback(
    (url: string, tunnel: TunnelInfo, rowProfileId?: string) => {
      const sourceProfileId =
        rowProfileId ??
        (tunnel &&
        typeof tunnel === "object" &&
        "profileId" in tunnel &&
        typeof tunnel.profileId === "string"
          ? tunnel.profileId
          : profileId);
      void dispatchIntent(
        createIntent(
          "browser:open",
          {
            profileId: sourceProfileId,
            url,
          },
          window.id,
        ),
      );
    },
    [profileId, window.id],
  );

  return (
    <div
      data-os-ports-tunnels-app={window.id}
      data-testid={`ports-tunnels-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <PortsPanel
          profileId={profileId}
          onOpenTunnelInBrowser={handleOpenTunnelInBrowser}
        />
      </div>
    </div>
  );
}
