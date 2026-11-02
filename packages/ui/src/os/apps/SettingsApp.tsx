import { useState } from "react";
import type { OsWindow } from "../types.js";
import { SettingsPage } from "@/components/pages/SettingsPage.js";
import { DevicesPage } from "@/components/pages/DevicesPage.js";

export interface SettingsAppProps {
  window: OsWindow;
}

export function SettingsApp({ window }: SettingsAppProps) {
  const [activeTab, setActiveTab] = useState<"general" | "devices">(
    (window.appState?.activeTab as "general" | "devices" | undefined) ?? "general",
  );

  return (
    <div
      data-os-settings-app={window.id}
      data-testid={`settings-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] shrink-0 text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={`px-3 py-1.5 rounded transition-colors ${
            activeTab === "general"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          General Settings
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("devices")}
          className={`px-3 py-1.5 rounded transition-colors ${
            activeTab === "devices"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          Login Devices
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {activeTab === "general" && <SettingsPage noLayout={true} />}
        {activeTab === "devices" && (
          <DevicesPage
            noLayout={true}
            profileId={window.ctx.profileId === "default" ? undefined : window.ctx.profileId}
          />
        )}
      </div>
    </div>
  );
}
