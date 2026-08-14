import { useCallback, useEffect, useRef, useState } from "react";
import { useSshForwardHost } from "@/contexts/SshForwardHostContext.js";
import { wireCounterToBigInt, type SshForwardSnapshot } from "@/lib/ssh-forward-host.js";

/** Maintains native-authoritative snapshots and bounds hint-triggered refreshes. */
export function useSshForward() {
  const { host } = useSshForwardHost();
  const [snapshot, setSnapshot] = useState<SshForwardSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refreshing = useRef(false);
  const trailing = useRef(false);
  const refresh = useCallback(async (): Promise<SshForwardSnapshot | null> => {
    if (!host) return null;
    if (refreshing.current) { trailing.current = true; return null; }
    refreshing.current = true;
    try {
      const next = await host.snapshot();
      setSnapshot(next);
      setError(null);
      return next;
    } catch (nextError) {
      setError(nextError);
      return null;
    } finally {
      refreshing.current = false;
      if (trailing.current) { trailing.current = false; void refresh(); }
    }
  }, [host]);
  useEffect(() => {
    if (!host) { setSnapshot(null); return; }
    const unsubscribe = host.subscribe((event) => {
      const current = snapshot;
      const hint = event.hint;
      if (!current || hint.desktopInstanceId !== current.context.desktopInstanceId || hint.managerSessionId !== current.context.managerSessionId || hint.clientEpoch !== current.context.clientEpoch || hint.activationToken !== current.activationToken || hint.scopeId !== current.scopeId) return;
      if (wireCounterToBigInt(hint.scopeGeneration) < wireCounterToBigInt(current.scopeGeneration) || wireCounterToBigInt(hint.profilesRevision) < wireCounterToBigInt(current.profilesRevision) || wireCounterToBigInt(hint.trustRevision) < wireCounterToBigInt(current.trustRevision)) return;
      const hintedSnapshot = event.snapshot;
      if (hintedSnapshot &&
        hintedSnapshot.context.desktopInstanceId === current.context.desktopInstanceId &&
        hintedSnapshot.context.managerSessionId === current.context.managerSessionId &&
        hintedSnapshot.context.clientEpoch === current.context.clientEpoch &&
        hintedSnapshot.context.desktopInstanceId === hint.desktopInstanceId &&
        hintedSnapshot.context.managerSessionId === hint.managerSessionId &&
        hintedSnapshot.context.clientEpoch === hint.clientEpoch &&
        hintedSnapshot.activationToken === hint.activationToken &&
        hintedSnapshot.scopeId === hint.scopeId &&
        wireCounterToBigInt(hintedSnapshot.scopeGeneration) >= wireCounterToBigInt(hint.scopeGeneration) &&
        wireCounterToBigInt(hintedSnapshot.profilesRevision) >= wireCounterToBigInt(hint.profilesRevision) &&
        wireCounterToBigInt(hintedSnapshot.trustRevision) >= wireCounterToBigInt(hint.trustRevision)) {
        setSnapshot(hintedSnapshot);
        setError(null);
        return;
      }
      void refresh();
    });
    return unsubscribe;
  }, [host, refresh, snapshot]);
  return { snapshot, error, refresh };
}
