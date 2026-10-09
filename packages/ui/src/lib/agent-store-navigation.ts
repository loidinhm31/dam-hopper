export type AgentStoreTab = "store" | "memory" | "settings" | "import";

export type AgentStoreProfileRequest =
  | { readonly kind: "default" }
  | { readonly kind: "choose" }
  | { readonly kind: "explicit"; readonly profileId: string }
  | { readonly kind: "invalid" };

export interface AgentStoreLocation {
  readonly tab: AgentStoreTab;
  readonly profile: AgentStoreProfileRequest;
}

export function buildAgentSettingsHref(profileId: string | null): string {
  return profileId === null
    ? "/agent-store?tab=settings"
    : `/agent-store?tab=settings&profileId=${encodeURIComponent(profileId)}`;
}

export function parseAgentStoreLocation(search: string): AgentStoreLocation {
  const params = new URLSearchParams(search);
  const tabs = params.getAll("tab");
  const requestedTab = tabs.length === 1 ? tabs[0] : undefined;
  const tab: AgentStoreTab =
    requestedTab === "memory" ||
    requestedTab === "settings" ||
    requestedTab === "import"
      ? requestedTab
      : "store";
  const profiles = params.getAll("profileId");
  if (profiles.length === 0) {
    return { tab, profile: { kind: tab === "settings" ? "choose" : "default" } };
  }
  const profileId = profiles[0];
  if (profiles.length !== 1 || profileId === undefined || profileId === "") {
    return { tab, profile: { kind: "invalid" } };
  }
  return { tab, profile: { kind: "explicit", profileId } };
}
