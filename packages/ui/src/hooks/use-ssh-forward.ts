import { useCallback, useEffect, useRef, useState } from "react";
import { useSshForwardHost } from "@/contexts/SshForwardHostContext.js";
import {
  wireCounterToBigInt,
  type SshForwardError,
  type SshForwardProfile,
  type SshForwardSnapshot,
  type WireCounter,
} from "@/lib/ssh-forward-host.js";
import { toSshForwardError } from "@/lib/ssh-forward-error-copy.js";

const REFRESHABLE_CONFLICT_CODES = new Set<SshForwardError["code"]>([
  "SCOPE_GENERATION_CONFLICT",
  "PROFILES_REVISION_CONFLICT",
  "TRUST_REVISION_CONFLICT",
  "GENERATION_CONFLICT",
  "HOST_KEY_CHALLENGE_NOT_FOUND",
  "HOST_KEY_CHALLENGE_EXPIRED",
]);

export function useSshForward() {
  const { host } = useSshForwardHost();
  const [snapshot, setSnapshot] = useState<SshForwardSnapshot | null>(null);
  const [error, setError] = useState<SshForwardError | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const snapshotRef = useRef<SshForwardSnapshot | null>(null);
  const pendingActionRef = useRef<string | null>(null);
  const refreshing = useRef(false);
  const trailing = useRef(false);

  const refresh = useCallback(async (): Promise<SshForwardSnapshot | null> => {
    if (!host || refreshing.current) {
      if (host) trailing.current = true;
      return null;
    }
    refreshing.current = true;
    const ownsPendingState = pendingActionRef.current === null;
    if (ownsPendingState) {
      pendingActionRef.current = "snapshot";
      setPendingAction("snapshot");
    }
    try {
      const next = await host.snapshot();
      setSnapshot(next);
      setError(null);
      return next;
    } catch (nextError) {
      const parsed = toSshForwardError(nextError);
      setError(parsed);
      return null;
    } finally {
      refreshing.current = false;
      if (ownsPendingState && pendingActionRef.current === "snapshot") {
        pendingActionRef.current = null;
        setPendingAction(null);
      }
      if (trailing.current) {
        trailing.current = false;
        void refresh();
      }
    }
  }, [host]);

  const runMutation = useCallback(
    async <T>(
      action: string,
      operation: () => Promise<T>,
      acceptSnapshot: (value: T) => SshForwardSnapshot | null,
    ): Promise<T> => {
      if (!host) throw toSshForwardError(null);
      pendingActionRef.current = action;
      setPendingAction(action);
      setError(null);
      try {
        const result = await operation();
        const next = acceptSnapshot(result);
        if (next) setSnapshot(next);
        return result;
      } catch (nextError) {
        const parsed = toSshForwardError(nextError);
        if (REFRESHABLE_CONFLICT_CODES.has(parsed.code)) await refresh();
        setError(parsed);
        throw parsed;
      } finally {
        if (pendingActionRef.current === action) {
          pendingActionRef.current = null;
          setPendingAction(null);
        }
      }
    },
    [host, refresh],
  );

  const snapshotResult = (value: SshForwardSnapshot) => value;
  const createProfile = useCallback(
    (profile: SshForwardProfile) =>
      runMutation("create", () => host!.createProfile(profile), snapshotResult),
    [host, runMutation],
  );
  const updateProfile = useCallback(
    (
      profileId: string,
      expectedGeneration: WireCounter,
      profile: SshForwardProfile,
    ) =>
      runMutation(
        "update",
        () => host!.updateProfile(profileId, expectedGeneration, profile),
        snapshotResult,
      ),
    [host, runMutation],
  );
  const deleteProfile = useCallback(
    (profileId: string, expectedGeneration: WireCounter) =>
      runMutation(
        "delete",
        () => host!.deleteProfile(profileId, expectedGeneration),
        snapshotResult,
      ),
    [host, runMutation],
  );
  const start = useCallback(
    (profileId: string, expectedGeneration: WireCounter) =>
      runMutation(
        "start",
        () => host!.start(profileId, expectedGeneration),
        snapshotResult,
      ),
    [host, runMutation],
  );
  const stop = useCallback(
    (profileId: string, expectedGeneration: WireCounter) =>
      runMutation(
        "stop",
        () => host!.stop(profileId, expectedGeneration),
        snapshotResult,
      ),
    [host, runMutation],
  );
  const restart = useCallback(
    (profileId: string, expectedGeneration: WireCounter) =>
      runMutation(
        "restart",
        () => host!.restart(profileId, expectedGeneration),
        snapshotResult,
      ),
    [host, runMutation],
  );
  const approveHost = useCallback(
    (
      profileId: string,
      expectedGeneration: WireCounter,
      challengeId: string,
      algorithm: string,
      fingerprint: string,
    ) =>
      runMutation(
        "approveHost",
        () =>
          host!.approveHost(
            profileId,
            expectedGeneration,
            challengeId,
            algorithm,
            fingerprint,
          ),
        snapshotResult,
      ),
    [host, runMutation],
  );
  const listKeys = useCallback(
    () =>
      runMutation(
        "listKeys",
        () => host!.listKeys(),
        () => null,
      ),
    [host, runMutation],
  );

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!host) {
      snapshotRef.current = null;
      setSnapshot(null);
      setError(null);
      return;
    }
    const unsubscribe = host.subscribe((event) => {
      const current = snapshotRef.current;
      const hint = event.hint;
      if (
        !current ||
        hint.desktopInstanceId !== current.context.desktopInstanceId ||
        hint.managerSessionId !== current.context.managerSessionId ||
        hint.clientEpoch !== current.context.clientEpoch ||
        hint.activationToken !== current.activationToken ||
        hint.scopeId !== current.scopeId
      )
        return;
      if (
        wireCounterToBigInt(hint.scopeGeneration) <
          wireCounterToBigInt(current.scopeGeneration) ||
        wireCounterToBigInt(hint.profilesRevision) <
          wireCounterToBigInt(current.profilesRevision) ||
        wireCounterToBigInt(hint.trustRevision) <
          wireCounterToBigInt(current.trustRevision)
      )
        return;
      const hintedSnapshot = event.snapshot;
      if (
        hintedSnapshot &&
        hintedSnapshot.context.desktopInstanceId ===
          current.context.desktopInstanceId &&
        hintedSnapshot.context.managerSessionId ===
          current.context.managerSessionId &&
        hintedSnapshot.context.clientEpoch === current.context.clientEpoch &&
        hintedSnapshot.activationToken === hint.activationToken &&
        hintedSnapshot.scopeId === hint.scopeId &&
        wireCounterToBigInt(hintedSnapshot.scopeGeneration) >=
          wireCounterToBigInt(hint.scopeGeneration) &&
        wireCounterToBigInt(hintedSnapshot.profilesRevision) >=
          wireCounterToBigInt(hint.profilesRevision) &&
        wireCounterToBigInt(hintedSnapshot.trustRevision) >=
          wireCounterToBigInt(hint.trustRevision)
      ) {
        setSnapshot(hintedSnapshot);
        setError(null);
        return;
      }
      void refresh();
    });
    return unsubscribe;
  }, [host, refresh]);

  return {
    snapshot,
    error,
    pending: pendingAction !== null,
    pendingAction,
    refresh,
    createProfile,
    updateProfile,
    deleteProfile,
    start,
    stop,
    restart,
    listKeys,
    approveHost,
  };
}
