import type { OsWindow } from "../types.js";
import {
  AgentStorePage,
  type AgentStoreTab,
} from "@/components/pages/AgentStorePage.js";
import { useWindowStore } from "../window-store.js";
import { createIntent, dispatchIntent } from "../intents.js";

export interface AgentStoreAppProps {
  window: OsWindow;
}

export function AgentStoreApp({ window }: AgentStoreAppProps) {
  const currentTab =
    (window.appState?.tab as AgentStoreTab | undefined) ?? "store";
  const targetProfileId = window.ctx.profileId;

  const handleTabChange = (tab: AgentStoreTab) => {
    useWindowStore.getState().updateAppState(window.id, { tab });
  };

  const handleProfileChange = (newProfileId: string) => {
    if (newProfileId === window.ctx.profileId) return;
    void dispatchIntent(
      createIntent("agent-store:open", {
        profileId: newProfileId,
        tab: currentTab,
      }),
    );
  };

  return (
    <div
      data-os-agent-store-app={window.id}
      data-testid={`agent-store-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <AgentStorePage
          noLayout={true}
          profileId={targetProfileId}
          tab={currentTab}
          onTabChange={handleTabChange}
          onProfileChange={handleProfileChange}
        />
      </div>
    </div>
  );
}
