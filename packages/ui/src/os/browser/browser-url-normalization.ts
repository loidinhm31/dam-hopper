import { generateUUID } from "@/lib/utils.js";

/** Validate and normalize ordinary committed URLs (HTTP/HTTPS only; retain query/hash; reject userinfo). */
export function normalizeBrowserCommittedUrl(rawUrl?: unknown): string | undefined {
  if (typeof rawUrl !== "string") return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;

  let candidate = trimmed;
  // If no scheme delimiter (:// or known URI scheme like javascript:, mailto:, etc.)
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate) ||
    /^(javascript|mailto|data|blob|about|file):/i.test(candidate);

  if (!hasScheme) {
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(candidate);
    candidate = isLocal ? `http://${candidate}` : `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (!parsed.hostname || parsed.username || parsed.password) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

export function resolveActiveTabId(
  ordinaryTabs: readonly { tabId: string }[],
  allTabs: readonly { tabId: string; parentTabId?: string }[],
  activeTabId: string,
): string {
  if (ordinaryTabs.length === 0) return generateUUID();
  if (ordinaryTabs.some((t) => t.tabId === activeTabId)) return activeTabId;
  const activeTab = allTabs.find((t) => t.tabId === activeTabId);
  const parent = activeTab?.parentTabId;
  if (parent && ordinaryTabs.some((t) => t.tabId === parent)) return parent;
  return ordinaryTabs[0]!.tabId;
}
