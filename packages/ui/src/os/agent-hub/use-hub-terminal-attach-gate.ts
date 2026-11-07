import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import {
  terminalTargetKey,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
import {
  formatClaimKey,
  globalResourceRegistry,
} from "@/os/resource-registry.js";
import type { ResourceClaimKey } from "@/os/types.js";
import { buildTerminalClaimKey } from "@/os/terminal-claim-key.js";
import { getTerminal, type TerminalEntry } from "@/lib/terminal-registry.js";
import { useWindowStore } from "@/os/window-store.js";
import type { TerminalAttachGate } from "@/components/organisms/MultiTerminalDisplay.js";
import { HubTerminalClaimPlaceholder } from "./HubTerminalClaimPlaceholder.js";

export interface UseHubTerminalAttachGateOptions {
  readonly hubWindowId: string;
  readonly sessionIds: readonly string[];
  resolveTarget(logicalKey: string): TerminalTarget | undefined;
}

interface DesiredEntry {
  readonly sessionId: string;
  readonly key: ResourceClaimKey;
  readonly target: TerminalTarget;
}

function findLegacyPresenterWindow(target: TerminalTarget): string | undefined {
  const windows = useWindowStore.getState().session.windows;
  for (const win of Object.values(windows)) {
    if (win.appId !== "terminals") continue;
    if (win.runtimeIdentity?.kind === "terminal" || win.appState?.target) {
      continue;
    }
    const profileId = win.ctx.profileId;
    const sid =
      (win.appState?.sessionId as string | undefined) ??
      (win.appState?.terminalId as string | undefined) ??
      `${profileId}:${win.id}`;
    if (profileId === target.profileId && sid === target.terminalId) {
      return win.id;
    }
  }
  return undefined;
}

export function useHubTerminalAttachGate(
  options: UseHubTerminalAttachGateOptions | null,
): TerminalAttachGate | undefined {
  const [revision, setRevision] = useState(0);

  const resolveTargetRef = useRef(options?.resolveTarget);
  resolveTargetRef.current = options?.resolveTarget;

  const currentOptionsRef = useRef(options);
  currentOptionsRef.current = options;

  const heldClaims = useRef<
    Map<string, { key: ResourceClaimKey; windowId: string }>
  >(new Map());
  const attemptedSessions = useRef<Set<string>>(new Set());
  const desiredEntriesRef = useRef<Map<string, DesiredEntry>>(new Map());
  const isSelfNotifyingRef = useRef(false);
  const lastWindowIdRef = useRef<string | undefined>(options?.hubWindowId);

  const sessionWindows = useWindowStore((s) => s.session.windows);

  const targetSignature = options
    ? options.sessionIds
        .map((sid) => {
          const t = resolveTargetRef.current?.(sid);
          return t ? `${sid}:${terminalTargetKey(t)}` : `${sid}:none`;
        })
        .join(";")
    : "";

  // ── Reconcile claims in layout effect (R5) ──────────────────────────────────
  useLayoutEffect(() => {
    if (!options) {
      if (heldClaims.current.size > 0) {
        isSelfNotifyingRef.current = true;
        try {
          for (const [, entry] of heldClaims.current) {
            globalResourceRegistry.release(entry.key, entry.windowId);
          }
          heldClaims.current.clear();
        } finally {
          isSelfNotifyingRef.current = false;
        }
        desiredEntriesRef.current.clear();
        attemptedSessions.current.clear();
        setRevision((r) => r + 1);
      }
      return;
    }

    const { hubWindowId, sessionIds } = options;
    const nextDesired = new Map<string, DesiredEntry>();

    for (const sid of sessionIds) {
      attemptedSessions.current.add(sid);
      const target = resolveTargetRef.current?.(sid);
      if (target) {
        if (findLegacyPresenterWindow(target)) {
          continue;
        }
        const key = buildTerminalClaimKey({ target });
        const formatted = formatClaimKey(key);
        nextDesired.set(formatted, { sessionId: sid, key, target });
      }
    }

    // Check if desired keys changed
    const prevDesired = desiredEntriesRef.current;
    const windowIdChanged = lastWindowIdRef.current !== hubWindowId;
    lastWindowIdRef.current = hubWindowId;

    let keysEqual =
      !windowIdChanged &&
      nextDesired.size === prevDesired.size &&
      [...nextDesired.keys()].every((k) => prevDesired.has(k));

    if (keysEqual) {
      return;
    }

    // Update desired set before releasing removed claims
    desiredEntriesRef.current = nextDesired;

    // Release removed claims held by this hub window
    for (const [heldFormatted, held] of heldClaims.current) {
      if (!nextDesired.has(heldFormatted) || windowIdChanged) {
        isSelfNotifyingRef.current = true;
        try {
          globalResourceRegistry.release(held.key, held.windowId);
        } finally {
          isSelfNotifyingRef.current = false;
        }
        heldClaims.current.delete(heldFormatted);
      }
    }

    // Claim added keys
    for (const [formatted, entry] of nextDesired) {
      if (!heldClaims.current.has(formatted)) {
        isSelfNotifyingRef.current = true;
        let result;
        try {
          result = globalResourceRegistry.claim(entry.key, hubWindowId);
        } finally {
          isSelfNotifyingRef.current = false;
        }
        if (result.success) {
          heldClaims.current.set(formatted, {
            key: entry.key,
            windowId: hubWindowId,
          });
        }
      }
    }
    setRevision((r) => r + 1);
  }, [options?.hubWindowId, targetSignature, sessionWindows]);

  // ── ResourceRegistry subscription (R5) ──────────────────────────────────
  useEffect(() => {
    if (!options) return;
    const { hubWindowId } = options;

    const unsubscribe = globalResourceRegistry.subscribe(() => {
      if (isSelfNotifyingRef.current) return;
      const currentOpts = currentOptionsRef.current;
      if (!currentOpts) return;

      let changed = false;
      for (const [formatted, { key }] of desiredEntriesRef.current) {
        if (!heldClaims.current.has(formatted)) {
          // Re-claim desired key only when currently unclaimed
          const currentClaim = globalResourceRegistry.getClaim(key);
          if (!currentClaim) {
            isSelfNotifyingRef.current = true;
            let result;
            try {
              result = globalResourceRegistry.claim(key, hubWindowId);
            } finally {
              isSelfNotifyingRef.current = false;
            }
            if (result.success) {
              heldClaims.current.set(formatted, {
                key,
                windowId: hubWindowId,
              });
              changed = true;
            }
          }
        } else {
          // Verify we still hold the claim
          const currentClaim = globalResourceRegistry.getClaim(key);
          const held = heldClaims.current.get(formatted);
          if (!currentClaim || (held && currentClaim.windowId !== held.windowId)) {
            heldClaims.current.delete(formatted);
            changed = true;
          }
        }
      }

      setRevision((r) => r + 1);
    });

    return () => {
      // Cleanup unsubscribes BEFORE releasing (R5)
      unsubscribe();
      if (heldClaims.current.size > 0) {
        isSelfNotifyingRef.current = true;
        try {
          for (const [, entry] of heldClaims.current) {
            globalResourceRegistry.release(entry.key, entry.windowId);
          }
          heldClaims.current.clear();
          desiredEntriesRef.current.clear();
          lastWindowIdRef.current = undefined;
        } finally {
          isSelfNotifyingRef.current = false;
        }
      }
    };
  }, [options?.hubWindowId]);

  // ── resolveTerminal (R6, R7 fail-closed) ────────────────────────────────
  const resolveTerminal = useCallback(
    (sessionId: string): TerminalEntry | undefined => {
      const opts = currentOptionsRef.current;
      if (!opts) return undefined;
      if (!opts.sessionIds.includes(sessionId)) return undefined;

      const target = resolveTargetRef.current?.(sessionId);
      if (!target || findLegacyPresenterWindow(target)) return undefined;
      const claimKey = buildTerminalClaimKey({ target });
      const formatted = formatClaimKey(claimKey);

      // Must be held by this hub window
      if (!heldClaims.current.has(formatted)) {
        return undefined;
      }

      return getTerminal(target);
    },
    [],
  );

  // ── renderPlaceholder (R6, R9) ──────────────────────────────────────────
  const renderPlaceholder = useCallback(
    (sessionId: string): ReactNode | null => {
      const opts = currentOptionsRef.current;
      if (!opts) return null;
      if (!opts.sessionIds.includes(sessionId)) return null;

      // Claim not yet attempted -> pending, return null (no denial flash)
      if (!attemptedSessions.current.has(sessionId)) {
        return null;
      }

      const target = resolveTargetRef.current?.(sessionId);
      if (!target) {
        return createElement(HubTerminalClaimPlaceholder, {
          reason: "unresolved",
          sessionLabel: sessionId,
        });
      }

      const legacyWinId = findLegacyPresenterWindow(target);
      if (legacyWinId) {
        return createElement(HubTerminalClaimPlaceholder, {
          reason: "legacy-presenter",
          holderWindowId: legacyWinId,
          sessionLabel: sessionId,
        });
      }

      const claimKey = buildTerminalClaimKey({ target });
      const formatted = formatClaimKey(claimKey);

      // Claim held by this hub window -> attachable, return null
      if (heldClaims.current.has(formatted)) {
        return null;
      }

      // Claim held by another window
      const claim = globalResourceRegistry.getClaim(claimKey);
      if (claim && claim.windowId !== opts.hubWindowId) {
        return createElement(HubTerminalClaimPlaceholder, {
          reason: "claimed-elsewhere",
          holderWindowId: claim.windowId,
          sessionLabel: sessionId,
        });
      }

      // If claim was attempted and failed but no other holder found yet
      return createElement(HubTerminalClaimPlaceholder, {
        reason: "claimed-elsewhere",
        sessionLabel: sessionId,
      });
    },
    [],
  );

  const hubWindowId = options?.hubWindowId;
  return useMemo(() => {
    if (!hubWindowId) {
      return undefined;
    }
    return {
      hubWindowId,
      resolveTerminal,
      renderPlaceholder,
      revision,
    };
  }, [hubWindowId, resolveTerminal, renderPlaceholder, revision]);
}
