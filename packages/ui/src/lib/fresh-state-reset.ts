/**
 * Fresh-state reset implementation per Unified Multi-Profile Workbench (Phase 02 / G0).
 *
 * Discards legacy browser resource records (selected-project, editor, tree, search,
 * terminal layout, pin, history, browser-history) and associated old quarantine backups.
 * Preserves saved profiles, endpoint-bound auth v2 records, native scope aliases,
 * presentation-only settings, and server data.
 *
 * Never calls localStorage.clear(). Idempotent per store.
 */

const KEY_RESET_MARKER = "dam-hopper:fresh-reset-v2-applied";
const KEY_RESET_NOTICE = "dam-hopper:fresh-reset-notice-pending";


export interface FreshResetResult {
  applied: boolean;
  keysRemoved: string[];
  error?: string;
}

/**
 * Validates whether a key should be discarded during fresh-state reset.
 */
export function isLegacyResourceKey(key: string): boolean {
  if (key === "dam-hopper:active-project") return true;
  if (key === "dam-hopper:terminal-pins") return true;
  if (key.includes(":legacy-unowned")) return true;
  if (key.includes("quarantine")) return true;

  if (key.startsWith("dam-hopper:terminal-layout:") && !key.startsWith("dam-hopper:terminal-layout:v3:")) {
    return true;
  }

  // Versioned store checks
  if (key === "dam-hopper:command-history") {
    try {
      const val = JSON.parse(localStorage.getItem(key) || "{}");
      if (!val || val.version !== 3) return true;
    } catch {
      return true;
    }
  }

  if (key === "dam-hopper:browser-debug-address-history") {
    try {
      const val = JSON.parse(localStorage.getItem(key) || "{}");
      if (!val || val.version !== 2) return true;
    } catch {
      return true;
    }
  }

  if (key === "dam-hopper:editor-state") {
    try {
      const val = JSON.parse(localStorage.getItem(key) || "{}");
      if (!val || val.version !== 2) return true;
    } catch {
      return true;
    }
  }

  if (key === "dam-hopper:explorer-tree-state") {
    try {
      const val = JSON.parse(localStorage.getItem(key) || "{}");
      if (!val || val.version !== 1) return true;
    } catch {
      return true;
    }
  }

  return false;
}

/**
 * Performs idempotent fresh-state reset of browser-local resource records.
 */
export function performFreshStateReset(): FreshResetResult {
  const removed: string[] = [];

  try {
    const keysToCheck: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) keysToCheck.push(key);
    }

    for (const key of keysToCheck) {
      if (isLegacyResourceKey(key)) {
        try {
          localStorage.removeItem(key);
          removed.push(key);
        } catch {
          // ignore individual removal error
        }
      }
    }

    const wasAlreadyApplied = localStorage.getItem(KEY_RESET_MARKER) === "true";
    if (!wasAlreadyApplied) {
      localStorage.setItem(KEY_RESET_MARKER, "true");
      if (removed.length > 0) {
        localStorage.setItem(KEY_RESET_NOTICE, "true");
      }
    }

    return { applied: true, keysRemoved: removed };
  } catch (error) {
    return {
      applied: false,
      keysRemoved: removed,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Returns whether the informational upgrade notice should be presented.
 */
export function shouldShowFreshResetNotice(): boolean {
  try {
    return localStorage.getItem(KEY_RESET_NOTICE) === "true";
  } catch {
    return false;
  }
}

/**
 * Dismisses the informational upgrade notice.
 */
export function dismissFreshResetNotice(): void {
  try {
    localStorage.removeItem(KEY_RESET_NOTICE);
  } catch {
    // ignore
  }
}

export interface LegacyDeepLinkCheck {
  isLegacy: boolean;
  guidance?: string;
}

/**
 * Rejects unqualified legacy links missing profileId.
 */
export function checkLegacyDeepLink(location: {
  search: string;
  hash: string;
}): LegacyDeepLinkCheck {
  try {
    const params = new URLSearchParams(location.search);
    const hasProject = params.has("project");
    const hasSession = params.has("session");
    const hasProfileId = params.has("profileId");

    if ((hasProject || hasSession) && !hasProfileId) {
      return {
        isLegacy: true,
        guidance:
          "Legacy unqualified link detected without profileId. Please use the unified workbench navigation to select your project or terminal session.",
      };
    }
  } catch {
    // ignore
  }

  return { isLegacy: false };
}
