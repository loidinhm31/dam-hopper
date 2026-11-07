import { useEffect, useRef, useState } from "react";
import type { OsWindow } from "../types.js";
import { SettingsPage } from "@/components/pages/SettingsPage.js";
import { DevicesPage } from "@/components/pages/DevicesPage.js";
import { useWindowStore } from "../window-store.js";

export interface SettingsAppProps {
  window: OsWindow;
}

export function SettingsApp({ window }: SettingsAppProps) {
  const requestedTab =
    (window.appState?.activeTab as "general" | "devices" | undefined) ??
    (window.appState?.tab as "general" | "devices" | undefined) ??
    "general";

  const [activeTab, setActiveTab] =
    useState<"general" | "devices">(requestedTab);

  const requestedSection =
    (window.appState?.settingsSection as string | undefined) ??
    (window.appState?.section as string | undefined);
  const deliveryId = window.appState?.deliveryId as string | undefined;
  const lastConsumedDeliveryRef = useRef<string | null>(null);

  useEffect(() => {
    if (deliveryId && deliveryId !== lastConsumedDeliveryRef.current) {
      lastConsumedDeliveryRef.current = deliveryId;
      if (requestedSection === "appearance") {
        setActiveTab("general");
        return;
      }
    }
    if (!deliveryId && requestedSection === "appearance" && lastConsumedDeliveryRef.current === null) {
      lastConsumedDeliveryRef.current = "initial";
      setActiveTab("general");
      return;
    }
    setActiveTab(requestedTab);
  }, [requestedTab, requestedSection, deliveryId]);

  const hasTargetProfile = "targetProfileId" in (window.appState ?? {});
  const targetProfileId: string | null = hasTargetProfile
    ? (window.appState?.targetProfileId as string | null)
    : (window.appState?.profileId as string | undefined) ??
      (window.ctx.profileId === "default" ? null : (window.ctx.profileId ?? null));

  const handleTabChange = (tab: "general" | "devices") => {
    setActiveTab(tab);
    useWindowStore.getState().updateAppState(window.id, { activeTab: tab });
  };

  const handleTargetProfileChange = (profileId: string | null) => {
    useWindowStore.getState().updateAppState(window.id, {
      targetProfileId: profileId,
      profileId: profileId ?? undefined,
    });
  };

  return (
    <div
      data-os-settings-app={window.id}
      data-testid={`settings-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] shrink-0 text-xs font-medium">
        <button
          type="button"
          onClick={() => handleTabChange("general")}
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
          onClick={() => handleTabChange("devices")}
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
        {activeTab === "general" && (
          <SettingsPage
            noLayout={true}
            targetProfileId={targetProfileId}
            onTargetProfileChange={handleTargetProfileChange}
            requestedSection={requestedSection}
            deliveryId={deliveryId}
          />
        )}
        {activeTab === "devices" && (
          <DevicesPage
            noLayout={true}
            profileId={targetProfileId}
            onProfileChange={handleTargetProfileChange}
          />
        )}
      </div>
    </div>
  );
}
