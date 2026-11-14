import type { DamHopperConfig } from "@/api/client.js";
import type { BrowserHostLiveStatus } from "@/api/browser-host-live-status.js";

/** Form state for the fields the Host Browser settings section owns. */
export interface HostBrowserDraft {
  enabled: boolean;
  executablePath: string;
  profileRoot: string;
  /** One origin per line. */
  originsText: string;
}

/** One origin per line; trimmed, blank lines dropped. */
export function parseOrigins(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function draftFromConfig(config?: DamHopperConfig): HostBrowserDraft {
  const browser = config?.server?.browser;
  return {
    enabled: browser?.enabled === true,
    executablePath: browser?.executablePath ?? "",
    profileRoot: browser?.profileRoot ?? "",
    originsText: (browser?.allowedTargetOrigins ?? []).join("\n"),
  };
}

export function isDraftDirty(
  draft: HostBrowserDraft,
  saved: HostBrowserDraft,
): boolean {
  return (
    draft.enabled !== saved.enabled ||
    draft.executablePath.trim() !== saved.executablePath.trim() ||
    draft.profileRoot.trim() !== saved.profileRoot.trim() ||
    parseOrigins(draft.originsText).join("\n") !==
      parseOrigins(saved.originsText).join("\n")
  );
}

/**
 * Applies the draft onto `config`, changing only the keys the form owns.
 * Hand-edited `budgets`, `deniedDestinations`, `allowedAssetOrigins`,
 * `allowedDevOrigins` and unrelated `server` keys are carried through as-is.
 * Empty executable/profile root are omitted so server defaults apply.
 */
export function applyDraftToConfig(
  config: DamHopperConfig,
  draft: HostBrowserDraft,
): DamHopperConfig {
  const existing = config.server?.browser;
  const browser: NonNullable<NonNullable<DamHopperConfig["server"]>["browser"]> = {
    ...existing,
    enabled: draft.enabled,
  };
  const executablePath = draft.executablePath.trim();
  const profileRoot = draft.profileRoot.trim();
  const origins = parseOrigins(draft.originsText);

  if (executablePath) browser.executablePath = executablePath;
  else delete browser.executablePath;
  if (profileRoot) browser.profileRoot = profileRoot;
  else delete browser.profileRoot;
  if (origins.length > 0 || existing?.allowedTargetOrigins !== undefined) {
    browser.allowedTargetOrigins = origins;
  }

  return { ...config, server: { ...config.server, browser } };
}

/** Compares saved config against the RUNNING host (manager snapshots config at startup). */
export function describeLiveStatus(
  savedEnabled: boolean,
  live: BrowserHostLiveStatus,
): string {
  if (live.available) {
    return savedEnabled
      ? "Running and available."
      : "Running now, but the saved config disables it. Restart the server to apply.";
  }
  if (!savedEnabled) return "Disabled.";
  const reason = live.unavailableReason ?? "unavailable";
  return /disabled in configuration/i.test(reason)
    ? "Enabled in the saved config but not running yet. Restart the server to apply."
    : `Not available: ${reason}. If you changed these settings, restart the server to apply.`;
}
