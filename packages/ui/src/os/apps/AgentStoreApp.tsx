import type { OsWindow } from "../types.js";
import { AgentStorePage } from "@/components/pages/AgentStorePage.js";

export interface AgentStoreAppProps {
  window: OsWindow;
}

export function AgentStoreApp({ window }: AgentStoreAppProps) {
  return (
    <div
      data-os-agent-store-app={window.id}
      data-testid={`agent-store-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <AgentStorePage
          noLayout={true}
          profileId={
            window.ctx.profileId === "default"
              ? undefined
              : window.ctx.profileId
          }
        />
      </div>
    </div>
  );
}
