import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { RefreshCw } from "lucide-react";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { useWindowStore } from "../window-store.js";
import { closeBrowserTarget } from "./browser-close-lifecycle.js";
import { readCanonicalBrowserWindowState, sanitizeBrowserError, writeCanonicalWindowState } from "./browser-navigation.js";
import { areBrowserOwnerScopesEqual, captureVerifiedBrowserOwner } from "./browser-owner-scope.js";
import { BROWSER_RECOVERY_STORAGE_KEY, loadBrowserRecoveryDisk, settleProvenRecoveryOperation, settleRecoveryOperationsIfAuthorized } from "./browser-recovery-store.js";
import { acknowledgeUnknownOperationRisk, closeSelectedInventorySession, commitTargetAdmission, getVerifiedBrowserSession, isOperationRiskAcknowledged, listVerifiedBrowserSessions } from "./browser-session-inventory.js";
import { removeBrowserTab, selectBrowserTab } from "./browser-tab-state.js";
import type { BrowserOwnerScope, BrowserRecoveryOperation, BrowserTabRuntime, BrowserWindowClosingState } from "./browser-tab-types.js";

export interface BrowserRecoveryPanelProps {
  windowId: string; owner: ConnectionRef; verifiedScope: BrowserOwnerScope | null;
  windowClosing?: BrowserWindowClosingState; activeTab: BrowserTabRuntime;
  privacyMasked: boolean; ownerMismatch: boolean;
  onAttachSession: (session: BrowserSessionDto) => void;
  onWindowStateUpdated: () => void; onCloseUnknownWindowAllowed?: () => void;
}
export function BrowserRecoveryPanel({
  windowId, owner, verifiedScope, windowClosing, activeTab, privacyMasked, ownerMismatch,
  onAttachSession, onWindowStateUpdated, onCloseUnknownWindowAllowed,
}: BrowserRecoveryPanelProps): ReactElement {
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [sessions, setSessions] = useState<BrowserSessionDto[] | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const masked = privacyMasked || ownerMismatch;
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === BROWSER_RECOVERY_STORAGE_KEY) setTick((n) => n + 1); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const diskState = useMemo(() => {
    void tick; void windowClosing?.operationId; void windowClosing?.status; void activeTab.phase; void activeTab.actionSequence;
    try { return { disk: loadBrowserRecoveryDisk(), error: null as string | null }; }
    catch (err) { return { disk: null, error: sanitizeBrowserError(err, "Recovery storage unreadable.") }; }
  }, [tick, windowClosing?.operationId, windowClosing?.status, activeTab.phase, activeTab.actionSequence]);
  const ownerOps = useMemo(() => (masked || !verifiedScope || !diskState.disk)
    ? [] as BrowserRecoveryOperation[]
    : diskState.disk.operations.filter((op) => areBrowserOwnerScopesEqual(op.ownerScope, verifiedScope)), [diskState.disk, masked, verifiedScope]);

  const removeTabIfPresent = useCallback((winId: string, expectedScope: BrowserOwnerScope, tabId?: string) => {
    const cur = tabId ? useWindowStore.getState().session?.windows?.[winId] : undefined;
    if (!cur || !tabId || cur.ctx.profileId !== owner.profileId) return;
    const curState = readCanonicalBrowserWindowState(cur.appState, activeTab.tabId);
    if (curState.ownerScope && !areBrowserOwnerScopesEqual(curState.ownerScope, expectedScope)) return;
    if (curState.tabs.some((t) => t.tabId === tabId)) writeCanonicalWindowState(winId, removeBrowserTab(curState, tabId));
  }, [activeTab.tabId, owner.profileId]);

  const isRetryOwnerCurrent = useCallback(
    (capturedOwner: ConnectionRef, capturedScope: BrowserOwnerScope): boolean => {
      const live = captureVerifiedBrowserOwner(owner.profileId);
      return Boolean(
        live &&
          live.owner.generation === capturedOwner.generation &&
          areBrowserOwnerScopesEqual(live.scope, capturedScope),
      );
    },
    [owner.profileId],
  );

  const tryFinalizeParentWindowOp = useCallback(
    async (
      op: BrowserRecoveryOperation,
      capturedOwner: ConnectionRef,
      capturedScope: BrowserOwnerScope,
    ): Promise<boolean> => {
      if (!isRetryOwnerCurrent(capturedOwner, capturedScope)) return false;
      const disk = loadBrowserRecoveryDisk();
      const childPending = disk.operations.some(
        (o) =>
          o.operationId !== op.operationId &&
          o.kind !== "close-window" &&
          o.windowId === op.windowId &&
          areBrowserOwnerScopesEqual(o.ownerScope, capturedScope),
      );
      if (childPending) return false;
      const curWin = useWindowStore.getState().session?.windows?.[op.windowId];
      if (curWin) {
        if (curWin.ctx.profileId !== capturedOwner.profileId) return false;
        const curState = readCanonicalBrowserWindowState(curWin.appState, activeTab.tabId);
        if (
          (curState.ownerScope && !areBrowserOwnerScopesEqual(curState.ownerScope, capturedScope)) ||
          curState.tabs.some((t) => Boolean(t.sessionId))
        ) {
          return false;
        }
      }
      const parentWinOp =
        op.kind === "close-window" && !op.sessionId
          ? op
          : disk.operations.find(
              (o) =>
                o.kind === "close-window" &&
                !o.sessionId &&
                o.windowId === op.windowId &&
                areBrowserOwnerScopesEqual(o.ownerScope, capturedScope),
            );
      if (!parentWinOp || !areBrowserOwnerScopesEqual(parentWinOp.ownerScope, capturedScope)) return false;
      if (curWin && readCanonicalBrowserWindowState(curWin.appState, activeTab.tabId).closing?.status === "pending") {
        return false;
      }
      const settled = await settleProvenRecoveryOperation(parentWinOp.operationId, capturedScope, () => {
        if (!isRetryOwnerCurrent(capturedOwner, capturedScope)) return false;
        const liveWin = useWindowStore.getState().session?.windows?.[parentWinOp.windowId];
        if (liveWin) {
          if (liveWin.ctx.profileId !== capturedOwner.profileId) return false;
          const liveState = readCanonicalBrowserWindowState(liveWin.appState, activeTab.tabId);
          if (liveState.ownerScope && !areBrowserOwnerScopesEqual(liveState.ownerScope, capturedScope)) return false;
          if (liveState.closing?.status === "pending") return false;
        }
        return true;
      });
      if (!settled || !isRetryOwnerCurrent(capturedOwner, capturedScope)) return false;
      const postWin = useWindowStore.getState().session?.windows?.[parentWinOp.windowId];
      if (parentWinOp.windowId === windowId) {
        if (!postWin || postWin.ctx.profileId !== capturedOwner.profileId) return false;
        const postState = readCanonicalBrowserWindowState(postWin.appState, activeTab.tabId);
        if (postState.ownerScope && !areBrowserOwnerScopesEqual(postState.ownerScope, capturedScope)) return false;
        acknowledgeUnknownOperationRisk(parentWinOp.operationId);
        if (postState.closing?.operationId === parentWinOp.operationId) {
          onCloseUnknownWindowAllowed?.();
        }
      } else {
        acknowledgeUnknownOperationRisk(parentWinOp.operationId);
      }
      return true;
    },
    [activeTab.tabId, isRetryOwnerCurrent, onCloseUnknownWindowAllowed, windowId],
  );

  const handleRetryClose = useCallback(async (op: BrowserRecoveryOperation) => {
    const verified = captureVerifiedBrowserOwner(owner.profileId);
    if (!verified || verified.owner.generation !== owner.generation || !areBrowserOwnerScopesEqual(verified.scope, op.ownerScope)) {
      setStatusMsg({ kind: "error", text: "Original verified owner is disconnected or changed." }); return;
    }
    setBusyId(op.operationId); setStatusMsg(null);
    try {
      if (op.kind === "close-window" && !op.sessionId) {
        const disk = loadBrowserRecoveryDisk(), handled = new Set<string>(); let blocked = false;
        for (const child of disk.operations.filter((o) => o.operationId !== op.operationId && o.kind !== "close-window" && o.windowId === op.windowId && areBrowserOwnerScopesEqual(o.ownerScope, verified.scope) && Boolean(o.sessionId))) {
          if (!isRetryOwnerCurrent(verified.owner, verified.scope)) {
            setStatusMsg({ kind: "error", text: "Original verified owner changed during retry." }); return;
          }
          handled.add(child.sessionId!);
          const out = await closeBrowserTarget({ owner: verified.owner, scope: verified.scope, sessionId: child.sessionId!, windowId: child.windowId, tabId: child.tabId, operationId: child.operationId, groupId: child.groupId ?? op.groupId });
          if (!isRetryOwnerCurrent(verified.owner, verified.scope)) {
            setStatusMsg({ kind: "error", text: "Original verified owner changed during retry." }); return;
          }
          if (out.kind === "closed" || out.kind === "released") {
            await settleProvenRecoveryOperation(child.operationId, verified.scope, () => isRetryOwnerCurrent(verified.owner, verified.scope));
            if (!isRetryOwnerCurrent(verified.owner, verified.scope)) {
              setStatusMsg({ kind: "error", text: "Original verified owner changed during retry." }); return;
            }
            removeTabIfPresent(child.windowId, verified.scope, child.tabId);
          } else {
            blocked = true; setStatusMsg({ kind: "error", text: sanitizeBrowserError(out.error, "Close check failed.") });
          }
        }
        const curWin = useWindowStore.getState().session?.windows?.[op.windowId];
        const curTabs = (curWin && curWin.ctx.profileId === verified.owner.profileId)
          ? (() => {
              const st = readCanonicalBrowserWindowState(curWin.appState, activeTab.tabId);
              if (st.ownerScope && !areBrowserOwnerScopesEqual(st.ownerScope, verified.scope)) return [];
              return st.tabs.filter((x) => Boolean(x.sessionId) && !handled.has(x.sessionId!));
            })()
          : [];
        for (const t of curTabs) {
          if (!isRetryOwnerCurrent(verified.owner, verified.scope)) {
            setStatusMsg({ kind: "error", text: "Original verified owner changed during retry." }); return;
          }
          const out = await closeBrowserTarget({ owner: verified.owner, scope: verified.scope, sessionId: t.sessionId!, windowId: op.windowId, tabId: t.tabId, groupId: op.groupId, runtime: t.snapshot });
          if (!isRetryOwnerCurrent(verified.owner, verified.scope)) {
            setStatusMsg({ kind: "error", text: "Original verified owner changed during retry." }); return;
          }
          if (out.kind === "closed" || out.kind === "released") removeTabIfPresent(op.windowId, verified.scope, t.tabId);
          else { blocked = true; setStatusMsg({ kind: "error", text: sanitizeBrowserError(out.error, "Close check failed.") }); }
        }
        if (!blocked) {
          const finalized = await tryFinalizeParentWindowOp(op, verified.owner, verified.scope);
          if (!isRetryOwnerCurrent(verified.owner, verified.scope)) {
            setStatusMsg({ kind: "error", text: "Original verified owner changed during retry." }); return;
          }
          setStatusMsg(finalized ? { kind: "info", text: "Window closure reconciled." } : { kind: "error", text: "Remaining recovery operations block window close." });
          if (finalized) onWindowStateUpdated();
        }
        return;
      }
      if (!op.sessionId) return;
      const outcome = await closeBrowserTarget({ owner: verified.owner, scope: verified.scope, sessionId: op.sessionId, windowId: op.windowId, tabId: op.tabId, operationId: op.operationId, groupId: op.groupId });
      if (!isRetryOwnerCurrent(verified.owner, verified.scope)) {
        setStatusMsg({ kind: "error", text: "Original verified owner changed during retry." }); return;
      }
      if (outcome.kind === "closed" || outcome.kind === "released") {
        await settleProvenRecoveryOperation(op.operationId, verified.scope, () => isRetryOwnerCurrent(verified.owner, verified.scope));
        if (!isRetryOwnerCurrent(verified.owner, verified.scope)) {
          setStatusMsg({ kind: "error", text: "Original verified owner changed during retry." }); return;
        }
        if (op.windowId === windowId) removeTabIfPresent(windowId, verified.scope, op.tabId);
        await tryFinalizeParentWindowOp(op, verified.owner, verified.scope);
        if (!isRetryOwnerCurrent(verified.owner, verified.scope)) return;
        setStatusMsg({ kind: "info", text: outcome.kind === "released" ? "View reference released." : "Remote page closed." });
        onWindowStateUpdated();
      } else setStatusMsg({ kind: "error", text: sanitizeBrowserError(outcome.error, "Close retry failed.") });
    } catch (err) { setStatusMsg({ kind: "error", text: sanitizeBrowserError(err, "Close retry failed.") }); }
    finally { setBusyId(null); setTick((n) => n + 1); }
  }, [activeTab.tabId, isRetryOwnerCurrent, onWindowStateUpdated, owner.generation, owner.profileId, removeTabIfPresent, tryFinalizeParentWindowOp, windowId]);

  const isWindowActivelyClosing = useCallback((targetWinId: string, statuses: readonly string[]): boolean => {
    const targetWin = useWindowStore.getState().session?.windows?.[targetWinId];
    if (!targetWin || targetWin.appId !== "browser" || !targetWin.appState) return false;
    const st = readCanonicalBrowserWindowState(targetWin.appState, activeTab.tabId);
    return Boolean(st.closing && statuses.includes(st.closing.status));
  }, [activeTab.tabId]);

  const dismissibleOps = useMemo(
    () => ownerOps.filter((op) => !isWindowActivelyClosing(op.windowId, ["pending", "unknown"])),
    [isWindowActivelyClosing, ownerOps],
  );

  const handleAck = useCallback(async (op: BrowserRecoveryOperation) => {
    const verified = captureVerifiedBrowserOwner(owner.profileId);
    if (!verified || verified.owner.generation !== owner.generation || !areBrowserOwnerScopesEqual(verified.scope, op.ownerScope)) {
      setStatusMsg({ kind: "error", text: "Original verified owner is disconnected or changed." }); return;
    }
    if (isWindowActivelyClosing(op.windowId, ["pending"])) {
      setStatusMsg({ kind: "error", text: "Window close is still pending." }); return;
    }
    if (windowClosing?.status === "unknown" && op.operationId === windowClosing.operationId && op.windowId === windowId) {
      acknowledgeUnknownOperationRisk(op.operationId); setTick((n) => n + 1);
      onCloseUnknownWindowAllowed?.();
      return;
    }
    setBusyId(op.operationId); setStatusMsg(null);
    try {
      const settled = await settleRecoveryOperationsIfAuthorized({
        operationIds: [op.operationId],
        expectedScope: verified.scope,
        allowUnknownClosingForWindowId: windowId,
        shouldSettle: () => {
          const live = captureVerifiedBrowserOwner(owner.profileId);
          return Boolean(live && live.owner.generation === owner.generation && areBrowserOwnerScopesEqual(live.scope, verified.scope));
        },
      });
      const postVerified = captureVerifiedBrowserOwner(owner.profileId);
      if (!postVerified || postVerified.owner.generation !== owner.generation || !areBrowserOwnerScopesEqual(postVerified.scope, verified.scope)) {
        setStatusMsg({ kind: "error", text: "Original verified owner changed before recovery settlement completed." });
        return;
      }
      if (settled.length === 0) {
        setStatusMsg({ kind: "error", text: "Operation cannot be dismissed while window close is active." });
        return;
      }
      acknowledgeUnknownOperationRisk(op.operationId);
      const curWin = op.tabId && op.windowId === windowId ? useWindowStore.getState().session?.windows?.[windowId] : undefined;
      if (curWin && curWin.ctx.profileId === owner.profileId && op.tabId) {
        const curState = readCanonicalBrowserWindowState(curWin.appState, activeTab.tabId);
        if ((!curState.ownerScope || areBrowserOwnerScopesEqual(curState.ownerScope, verified.scope)) &&
          curState.tabs.some((t) => t.tabId === op.tabId && (t.phase === "close-unknown" || t.phase === "create-unknown"))) {
          removeTabIfPresent(windowId, verified.scope, op.tabId);
        }
      }
      onWindowStateUpdated();
    } catch (err) {
      setStatusMsg({ kind: "error", text: sanitizeBrowserError(err, "Failed to dismiss recovery operation.") });
    } finally {
      setBusyId(null); setTick((n) => n + 1);
    }
  }, [activeTab.tabId, isWindowActivelyClosing, onCloseUnknownWindowAllowed, onWindowStateUpdated, owner.generation, owner.profileId, removeTabIfPresent, windowClosing, windowId]);

  const handleDismissAll = useCallback(async () => {
    if (dismissibleOps.length === 0) return;
    const verified = captureVerifiedBrowserOwner(owner.profileId);
    if (!verified || verified.owner.generation !== owner.generation) {
      setStatusMsg({ kind: "error", text: "Original verified owner is disconnected or changed." }); return;
    }
    setBusyId("__all__"); setStatusMsg(null);
    try {
      const settled = await settleRecoveryOperationsIfAuthorized({
        operationIds: dismissibleOps.map((o) => o.operationId),
        expectedScope: verified.scope,
        skipActiveClosingWindows: true,
        shouldSettle: () => {
          const live = captureVerifiedBrowserOwner(owner.profileId);
          return Boolean(live && live.owner.generation === owner.generation && areBrowserOwnerScopesEqual(live.scope, verified.scope));
        },
      });
      const postVerified = captureVerifiedBrowserOwner(owner.profileId);
      if (!postVerified || postVerified.owner.generation !== owner.generation || !areBrowserOwnerScopesEqual(postVerified.scope, verified.scope)) {
        setStatusMsg({ kind: "error", text: "Original verified owner changed before recovery settlement completed." });
        return;
      }
      for (const op of settled) {
        acknowledgeUnknownOperationRisk(op.operationId);
        const curWin = op.tabId && op.windowId === windowId ? useWindowStore.getState().session?.windows?.[windowId] : undefined;
        if (curWin && curWin.ctx.profileId === owner.profileId && op.tabId) {
          const curState = readCanonicalBrowserWindowState(curWin.appState, activeTab.tabId);
          if ((!curState.ownerScope || areBrowserOwnerScopesEqual(curState.ownerScope, verified.scope)) &&
            curState.tabs.some((t) => t.tabId === op.tabId && (t.phase === "close-unknown" || t.phase === "create-unknown"))) {
            removeTabIfPresent(windowId, verified.scope, op.tabId);
          }
        }
      }
      onWindowStateUpdated();
    } catch (err) {
      setStatusMsg({ kind: "error", text: sanitizeBrowserError(err, "Failed to dismiss recovery operations.") });
    } finally {
      setBusyId(null); setTick((n) => n + 1);
    }
  }, [activeTab.tabId, dismissibleOps, onWindowStateUpdated, owner.generation, owner.profileId, removeTabIfPresent, windowId]);

  const handleRefreshInventory = useCallback(async () => {
    const verified = captureVerifiedBrowserOwner(owner.profileId);
    if (!verified || verified.owner.generation !== owner.generation) { setStatusMsg({ kind: "error", text: "Connect and verify this profile before listing sessions." }); return; }
    setInvLoading(true); setStatusMsg(null);
    try { setSessions(await listVerifiedBrowserSessions(verified.owner, verified.scope)); }
    catch (err) { setStatusMsg({ kind: "error", text: sanitizeBrowserError(err, "Failed to list verified sessions.") }); }
    finally { setInvLoading(false); }
  }, [owner.profileId, owner.generation]);

  const findOpenMatch = useCallback((sessionId: string) => {
    for (const w of Object.values(useWindowStore.getState().session?.windows ?? {})) {
      if (w.appId !== "browser" || w.ctx.profileId !== owner.profileId) continue;
      const parsed = readCanonicalBrowserWindowState(w.appState, "tab-1");
      if (verifiedScope && parsed.ownerScope && !areBrowserOwnerScopesEqual(parsed.ownerScope, verifiedScope)) continue;
      const tab = parsed.tabs.find((t) => t.sessionId === sessionId);
      if (tab) return { win: w, state: parsed, tabId: tab.tabId };
    }
    return null;
  }, [owner.profileId, verifiedScope]);
  const handleRevealSelected = useCallback((sessionId: string) => {
    const m = findOpenMatch(sessionId); if (!m) return;
    const s = useWindowStore.getState(); writeCanonicalWindowState(m.win.id, selectBrowserTab(m.state, m.tabId));
    if (m.win.minimized) s.restoreWindow?.(m.win.id);
    if (s.session.activeDesktopId !== m.win.desktopId) s.switchDesktop?.(m.win.desktopId);
    s.focusWindow?.(m.win.id);
  }, [findOpenMatch]);
  const handleAttachSelected = useCallback(async (sess: BrowserSessionDto) => {
    const verified = captureVerifiedBrowserOwner(owner.profileId);
    if (!verified || verified.owner.generation !== owner.generation) return;
    setBusyId(sess.browserSessionId);
    try {
      const fresh = await getVerifiedBrowserSession(verified.owner, verified.scope, sess.browserSessionId);
      if (!fresh) { setStatusMsg({ kind: "error", text: "Selected target is closing or unavailable." }); return; }
      if (!commitTargetAdmission(verified.scope, fresh.browserSessionId, () => onAttachSession(fresh))) setStatusMsg({ kind: "error", text: "Selected target is blocked by an active close gate." });
    } finally { setBusyId(null); }
  }, [owner.profileId, owner.generation, onAttachSession]);

  const handleCloseSelected = useCallback(async (sess: BrowserSessionDto) => {
    const verified = captureVerifiedBrowserOwner(owner.profileId);
    if (!verified || verified.owner.generation !== owner.generation) return;
    setBusyId(sess.browserSessionId);
    try {
      const out = await closeSelectedInventorySession(verified.owner, verified.scope, sess.browserSessionId, windowId, sess);
      setStatusMsg({ kind: out.kind === "closed" || out.kind === "released" ? "info" : "error", text: out.kind === "closed" ? "Selected target closed." : out.kind === "released" ? "Reference released." : sanitizeBrowserError(out.error, "Close failed.") });
      await handleRefreshInventory();
    } finally { setBusyId(null); setTick((n) => n + 1); }
  }, [owner.profileId, owner.generation, windowId, handleRefreshInventory]);

  if (masked) return <div data-testid="browser-recovery-panel" className="text-[11px] text-[var(--color-text-muted)]">Recovery inventory hidden in privacy/locked or owner-mismatch mode.</div>;
  return (
    <div data-testid="browser-recovery-panel" className="space-y-2 border-t border-[var(--color-border)] pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">Recovery & Inventory</span>
        <button type="button" data-testid="browser-recovery-refresh-btn" disabled={invLoading || !verifiedScope} onClick={() => void handleRefreshInventory()} className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] hover:bg-[var(--color-surface)] disabled:opacity-40"><RefreshCw className="w-3 h-3" aria-hidden="true" />{invLoading ? "Refreshing…" : "Refresh Inventory"}</button>
      </div>
      {diskState.error && <p role="alert" data-testid="browser-recovery-disk-error" className="text-[11px] text-[var(--color-danger)]">{diskState.error}</p>}
      {statusMsg && <p role={statusMsg.kind === "error" ? "alert" : "status"} data-testid="browser-recovery-status" className={`text-[11px] ${statusMsg.kind === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{statusMsg.text}</p>}
      {ownerOps.length > 1 && (
        <div className="flex items-center justify-end">
          <button type="button" data-testid="browser-recovery-dismiss-all-btn" disabled={busyId !== null || dismissibleOps.length === 0} onClick={() => void handleDismissAll()} className="rounded border border-[var(--color-warning)]/50 bg-[var(--color-warning)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-warning)] hover:bg-[var(--color-warning)]/20 disabled:opacity-40">Dismiss all</button>
        </div>
      )}
      {ownerOps.map((op) => (
        <div key={op.operationId} data-testid={`browser-recovery-op-${op.operationId}`} className="rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2 space-y-1 text-[11px]">
          <div className="font-medium text-[var(--color-warning)]">{op.kind} ({op.status}){op.sessionId ? ` · ${op.sessionId.slice(0, 8)}` : ""}</div>
          <div className="flex flex-wrap gap-1.5">
            {((op.kind === "close-tab" && op.sessionId) || (op.kind === "close-window" && (op.sessionId || op.windowId === windowId))) && (
              <button type="button" data-testid={`browser-recovery-retry-${op.operationId}`} disabled={busyId !== null} onClick={() => void handleRetryClose(op)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[10px] hover:bg-[var(--color-surface-2)]">Check close status / Retry close</button>
            )}
            <button type="button" data-testid={`browser-recovery-ack-${op.operationId}`} disabled={busyId !== null} onClick={() => void handleAck(op)} className="rounded border border-[var(--color-warning)]/50 px-2 py-0.5 text-[10px] hover:bg-[var(--color-warning)]/20 disabled:opacity-40">{isOperationRiskAcknowledged(op.operationId) ? "Risk acknowledged (notice retained)" : "Acknowledge duplicate risk"}</button>
          </div>
        </div>
      ))}
      {sessions && (
        <div data-testid="browser-recovery-inventory-list" className="space-y-1">
          {sessions.length === 0 ? <p className="text-[11px] text-[var(--color-text-muted)]">No live server targets reported for this owner.</p> : sessions.map((s) => (
            <div key={s.browserSessionId} data-testid={`browser-inventory-item-${s.browserSessionId}`} className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[11px]">
              <span className="truncate font-mono">{s.title || s.url || s.browserSessionId.slice(0, 8)} ({s.status})</span>
              <div className="flex items-center gap-1 shrink-0">
                {findOpenMatch(s.browserSessionId) ? <button type="button" data-testid={`browser-inventory-reveal-${s.browserSessionId}`} onClick={() => handleRevealSelected(s.browserSessionId)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px]">Reveal</button> : <button type="button" data-testid={`browser-inventory-attach-${s.browserSessionId}`} disabled={busyId === s.browserSessionId} onClick={() => void handleAttachSelected(s)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px]">Attach</button>}
                <button type="button" data-testid={`browser-inventory-close-${s.browserSessionId}`} disabled={busyId === s.browserSessionId} onClick={() => void handleCloseSelected(s)} className="rounded border border-[var(--color-danger)]/50 px-1.5 py-0.5 text-[10px] text-[var(--color-danger)]">Close</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
