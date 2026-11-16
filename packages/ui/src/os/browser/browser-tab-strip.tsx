import { useEffect, useRef, type KeyboardEvent, type ReactElement } from "react";
import { ExternalLink, Globe, Plus, X } from "lucide-react";
import type { BrowserTabRuntime } from "./browser-tab-types.js";

export interface BrowserTabStripProps {
  windowId: string;
  tabs: readonly BrowserTabRuntime[];
  activeTabId: string;
  privacyMasked: boolean;
  ownerMismatch?: boolean;
  closingWindow?: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}

export function getBrowserTabIds(windowId: string, tabId: string): { tabDomId: string; panelDomId: string } {
  return { tabDomId: `os-browser-tab-${windowId}-${tabId}`, panelDomId: `os-browser-tabpanel-${windowId}-${tabId}` };
}

function resolveTabLabel(tab: BrowserTabRuntime, masked: boolean): string {
  if (masked) return "Hidden tab";
  if (tab.title?.trim()) return tab.title.trim();
  const url = tab.committedUrl || tab.snapshot?.url;
  if (url) { try { return new URL(url).hostname || "New Tab"; } catch { /* ignore */ } }
  return "New Tab";
}

export function BrowserTabStrip({
  windowId, tabs, activeTabId, privacyMasked, ownerMismatch = false, closingWindow = false,
  onSelectTab, onCloseTab, onNewTab,
}: BrowserTabStripProps): ReactElement {
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pendingCloseFocusRef = useRef<{ closingTabId: string; removedIndex: number } | null>(null);
  const maskDetails = privacyMasked || ownerMismatch;

  useEffect(() => {
    tabRefs.current.get(activeTabId)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  useEffect(() => {
    if (!pendingCloseFocusRef.current || tabs.length === 0) return;
    const { closingTabId, removedIndex } = pendingCloseFocusRef.current;
    const stillPresent = tabs.find((t) => t.tabId === closingTabId);
    if (stillPresent) {
      if (stillPresent.phase === "close-unknown") pendingCloseFocusRef.current = null;
      return;
    }
    pendingCloseFocusRef.current = null;
    const target = tabs.find((t) => t.tabId === activeTabId) ?? tabs[Math.min(removedIndex, tabs.length - 1)];
    if (target) tabRefs.current.get(target.tabId)?.focus();
  }, [tabs, activeTabId]);

  const handleTabListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const targetEl = e.target as HTMLElement | null;
    if (targetEl && (targetEl instanceof HTMLInputElement || targetEl instanceof HTMLTextAreaElement ||
      targetEl instanceof HTMLSelectElement || targetEl.isContentEditable)) return;
    const tabEl = targetEl?.closest?.("[role='tab']") as HTMLElement | null;
    const focusedId = tabEl?.getAttribute("data-tab-id") ?? activeTabId;
    const idx = tabs.findIndex((t) => t.tabId === focusedId);
    if (idx < 0 || tabs.length === 0) return;

    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = tabs.length - 1;

    if (nextIdx !== null) {
      e.preventDefault();
      e.stopPropagation();
      const nextTab = tabs[nextIdx];
      if (nextTab) { tabRefs.current.get(nextTab.tabId)?.focus(); onSelectTab(nextTab.tabId); }
      return;
    }
    if (e.key === "Delete") {
      const targetTab = tabs[idx];
      if (!targetTab || closingWindow || ownerMismatch || targetTab.phase === "closing") return;
      e.preventDefault();
      e.stopPropagation();
      pendingCloseFocusRef.current = { closingTabId: targetTab.tabId, removedIndex: idx };
      onCloseTab(targetTab.tabId);
    }
  };

  return (
    <div className="os-browser-tab-strip" data-testid={`browser-tab-strip-${windowId}`}>
      <div role="tablist" aria-label="Browser tabs" onKeyDown={handleTabListKeyDown} className="os-browser-tab-scroll">
        {tabs.map((tab, index) => {
          const isActive = tab.tabId === activeTabId;
          const { tabDomId, panelDomId } = getBrowserTabIds(windowId, tab.tabId);
          const label = resolveTabLabel(tab, maskDetails);
          const isPending = tab.phase === "creating" || tab.phase === "connecting" || tab.phase === "closing";
          return (
            <div key={tab.tabId} className={`os-browser-tab-item ${isActive ? "workbench-selection os-browser-tab-item-active" : ""}`} data-active={isActive ? "true" : "false"}>
              <button
                ref={(el) => { if (el) tabRefs.current.set(tab.tabId, el); else tabRefs.current.delete(tab.tabId); }}
                type="button" role="tab" id={tabDomId} data-tab-id={tab.tabId} data-testid={`browser-tab-${tab.tabId}`}
                aria-selected={isActive} aria-controls={panelDomId} tabIndex={isActive ? 0 : -1}
                title={maskDetails ? undefined : label} onClick={() => onSelectTab(tab.tabId)} className="os-browser-tab-btn"
              >
                {tab.kind === "popup" ? <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-80" aria-hidden="true" /> : <Globe className="w-3.5 h-3.5 shrink-0 opacity-80" aria-hidden="true" />}
                {isPending && <span data-testid={`browser-tab-pending-${tab.tabId}`} className="os-browser-tab-pending" aria-label="Pending" />}
                <span className="truncate">{label}</span>
              </button>
              <button
                type="button" data-testid={`browser-tab-close-${tab.tabId}`}
                aria-label={maskDetails ? "Close tab" : `Close ${label}`} title={maskDetails ? "Close tab" : `Close ${label}`}
                disabled={closingWindow || ownerMismatch || tab.phase === "closing"}
                onClick={() => { pendingCloseFocusRef.current = { closingTabId: tab.tabId, removedIndex: index }; onCloseTab(tab.tabId); }}
                className="os-browser-tab-close"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" data-testid="browser-new-tab-btn" aria-label="New Tab" title="New Tab" disabled={closingWindow || ownerMismatch} onClick={onNewTab} className="os-browser-new-tab-btn">
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
