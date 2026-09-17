import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveProfileId, getExistingNativeScopeId } from "@/api/server-config.js";
import {
  useSshForwardHost,
  type SshForwardHostReadiness,
} from "@/contexts/SshForwardHostContext.js";
import {
  wireCounterToBigInt,
  type NativeScopeRef,
  type SshConnectionProfile,
  type SshForwardError,
  type SshForwardHost,
  type SshForwardRule,
  type SshForwardSnapshot,
  type WireCounter,
} from "@/lib/ssh-forward-host.js";
import { toSshForwardError } from "@/lib/ssh-forward-error-copy.js";

const REFRESHABLE_CONFLICT_CODES = new Set<SshForwardError["code"]>([
  "SCOPE_GENERATION_CONFLICT",
  "PROFILES_REVISION_CONFLICT",
  "CONNECTIONS_REVISION_CONFLICT",
  "RULES_REVISION_CONFLICT",
  "TRUST_REVISION_CONFLICT",
  "GENERATION_CONFLICT",
  "STALE_CONNECTION_GENERATION",
  "STALE_RULE_GENERATION",
  "HOST_KEY_CHALLENGE_NOT_FOUND",
  "HOST_KEY_CHALLENGE_EXPIRED",
]);

function sameSnapshotContext(
  left: SshForwardSnapshot,
  right: SshForwardSnapshot,
) {
  return (
    left.context.desktopInstanceId === right.context.desktopInstanceId &&
    left.context.managerSessionId === right.context.managerSessionId &&
    left.context.clientEpoch === right.context.clientEpoch &&
    left.activationToken === right.activationToken &&
    left.scopeId === right.scopeId
  );
}

function isSnapshotAtLeast(
  next: SshForwardSnapshot,
  current: SshForwardSnapshot,
) {
  return (
    wireCounterToBigInt(next.scopeGeneration) >=
      wireCounterToBigInt(current.scopeGeneration) &&
    wireCounterToBigInt(next.connectionsRevision) >=
      wireCounterToBigInt(current.connectionsRevision) &&
    wireCounterToBigInt(next.rulesRevision) >=
      wireCounterToBigInt(current.rulesRevision) &&
    wireCounterToBigInt(next.profilesRevision) >=
      wireCounterToBigInt(current.profilesRevision) &&
    wireCounterToBigInt(next.trustRevision) >=
      wireCounterToBigInt(current.trustRevision)
  );
}

interface MutationIdentity {
  host: SshForwardHost | null;
  readiness: SshForwardHostReadiness;
  readinessEpoch: number;
  context: SshForwardSnapshot["context"] | null;
  activationToken: WireCounter | null;
  scopeId: string | null;
  scopeGeneration: WireCounter | null;
}

function snapshotMatchesMutationIdentity(
  snapshot: SshForwardSnapshot | null,
  identity: MutationIdentity,
): boolean {
  if (!identity.context || !identity.activationToken || !identity.scopeId) {
    return true;
  }
  return (
    snapshot !== null &&
    snapshot.context.desktopInstanceId === identity.context.desktopInstanceId &&
    snapshot.context.managerSessionId === identity.context.managerSessionId &&
    snapshot.context.clientEpoch === identity.context.clientEpoch &&
    snapshot.activationToken === identity.activationToken &&
    snapshot.scopeId === identity.scopeId &&
    identity.scopeGeneration !== null &&
    snapshot.scopeGeneration === identity.scopeGeneration
  );
}
function extractScopeRef(
  snapshot: SshForwardSnapshot | null,
): NativeScopeRef | null {
  if (!snapshot) return null;
  return {
    context: snapshot.context,
    activationToken: snapshot.activationToken,
    scopeId: snapshot.scopeId,
    scopeGeneration: snapshot.scopeGeneration,
  };
}


export function useSshForward(scopeInput?: NativeScopeRef | string | null) {
  const { host, readiness, readinessError, retryInitialization } =
    useSshForwardHost();
  const [scopeRef, setScopeRef] = useState<NativeScopeRef | null>(
    typeof scopeInput === "object" && scopeInput ? scopeInput : null,
  );
  const scopeRefRef = useRef<NativeScopeRef | null>(scopeRef);
  scopeRefRef.current = scopeRef;
  const [snapshot, setSnapshot] = useState<SshForwardSnapshot | null>(null);
  const [error, setError] = useState<SshForwardError | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const preserveConnectTimeoutRef = useRef(false);
  const snapshotRef = useRef<SshForwardSnapshot | null>(null);
  const pendingActionRef = useRef<string | null>(null);
  const pendingIdentityRef = useRef<MutationIdentity | null>(null);
  const refreshing = useRef(false);
  const trailing = useRef(false);
  const mutationQueue = useRef(Promise.resolve());
  const queuedMutationCount = useRef(0);
  const hostRef = useRef(host);
  const readinessRef = useRef(readiness);
  const readinessEpochRef = useRef(0);
  const previousReadinessIdentity = useRef({ host, readiness });
  if (
    previousReadinessIdentity.current.host !== host ||
    previousReadinessIdentity.current.readiness !== readiness
  ) {
    readinessEpochRef.current += 1;
    previousReadinessIdentity.current = { host, readiness };
  }
  hostRef.current = host;
  readinessRef.current = readiness;

  const targetScopeId = useMemo(() => {
    if (typeof scopeInput === "string") return scopeInput;
    if (typeof scopeInput === "object" && scopeInput) return scopeInput.scopeId;
    if (scopeInput === null) return null;
    const active = getActiveProfileId();
    return active ? (getExistingNativeScopeId(active) ?? active) : null;
  }, [scopeInput]);
  const getEffectiveScopeRef = useCallback((): NativeScopeRef => {
    const current = scopeRefRef.current;
    if (current) return current;
    const snap = snapshotRef.current;
    if (snap) {
      return {
        context: snap.context,
        activationToken: snap.activationToken,
        scopeId: snap.scopeId,
        scopeGeneration: snap.scopeGeneration,
      };
    }
    return {
      context: {
        desktopInstanceId: "",
        managerSessionId: "",
        clientEpoch: "0" as WireCounter,
      },
      scopeId: "",
      scopeGeneration: "0" as WireCounter,
      activationToken: "0" as WireCounter,
    };
  }, []);

  const captureMutationIdentity = useCallback(
    (
      capturedHost: SshForwardHost | null,
      capturedReadiness: SshForwardHostReadiness,
    ) => {
      const current = snapshotRef.current;
      return {
        host: capturedHost,
        readiness: capturedReadiness,
        readinessEpoch: readinessEpochRef.current,
        context: current?.context ?? null,
        activationToken: current?.activationToken ?? null,
        scopeId: current?.scopeId ?? null,
        scopeGeneration: current?.scopeGeneration ?? null,
      } satisfies MutationIdentity;
    },
    [],
  );

  const isMutationIdentityCurrent = useCallback(
    (identity: MutationIdentity) =>
      hostRef.current === identity.host &&
      readinessRef.current === identity.readiness &&
      readinessEpochRef.current === identity.readinessEpoch &&
      snapshotMatchesMutationIdentity(snapshotRef.current, identity),
    [],
  );

  const commitSnapshot = useCallback(
    (next: SshForwardSnapshot, allowContextChange: boolean) => {
      const current = snapshotRef.current;
      if (current) {
        if (sameSnapshotContext(next, current)) {
          if (!isSnapshotAtLeast(next, current)) return false;
        } else if (!allowContextChange) {
          return false;
        }
      }
      snapshotRef.current = next;
      setSnapshot(next);
      return true;
    },
    [],
  );
  useEffect(() => {
    if (typeof scopeInput === "object" && scopeInput) {
      setScopeRef(scopeInput);
      return;
    }
    if (
      !host ||
      typeof host.openScope !== "function" ||
      readiness !== "ready" ||
      !targetScopeId
    ) {
      return;
    }
    let cancelled = false;
    host
      .openScope(targetScopeId)
      .then((handle) => {
        if (!cancelled) {
          setScopeRef(handle.ref);
          commitSnapshot(handle.snapshot, true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(toSshForwardError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [host, readiness, targetScopeId, scopeInput, commitSnapshot]);

  const refresh = useCallback(async (): Promise<SshForwardSnapshot | null> => {
    const currentHost = hostRef.current;
    const currentReadiness = readinessRef.current;
    if (!currentHost || refreshing.current) {
      if (currentHost) trailing.current = true;
      return null;
    }
    if (pendingActionRef.current !== null || queuedMutationCount.current > 0) {
      trailing.current = true;
      return null;
    }
    if (currentReadiness === "initializing") {
      setError(toSshForwardError(null));
      return null;
    }
    if (currentReadiness === "failed") {
      const retryIdentity = captureMutationIdentity(
        currentHost,
        currentReadiness,
      );
      try {
        await retryInitialization();
      } catch (nextError) {
        const parsed = toSshForwardError(nextError);
        if (isMutationIdentityCurrent(retryIdentity)) setError(parsed);
        return null;
      }
      if (hostRef.current !== currentHost || readinessRef.current !== "ready")
        return null;
    }
    const refreshIdentity = captureMutationIdentity(
      currentHost,
      readinessRef.current,
    );
    refreshing.current = true;
    const refreshBase = snapshotRef.current;
    pendingActionRef.current = "snapshot";
    pendingIdentityRef.current = refreshIdentity;
    setPendingAction("snapshot");
    try {
      const next = await currentHost.snapshot(getEffectiveScopeRef());
      if (!isMutationIdentityCurrent(refreshIdentity)) return null;
      const current = snapshotRef.current;
      if (
        current &&
        ((refreshBase && !sameSnapshotContext(refreshBase, current)) ||
          (!refreshBase && !sameSnapshotContext(next, current)))
      )
        return null;
      const committed = commitSnapshot(next, true);
      if (committed) {
        setScopeRef(extractScopeRef(next));
        if (!preserveConnectTimeoutRef.current) setError(null);
      }
      return committed ? next : null;
    } catch (nextError) {
      const parsed = toSshForwardError(nextError);
      if (isMutationIdentityCurrent(refreshIdentity)) setError(parsed);
      return null;
    } finally {
      refreshing.current = false;
      if (
        pendingActionRef.current === "snapshot" &&
        pendingIdentityRef.current === refreshIdentity
      ) {
        pendingActionRef.current = null;
        pendingIdentityRef.current = null;
        setPendingAction(null);
      }
      if (trailing.current) {
        trailing.current = false;
        void refresh();
      }
    }
  }, [
    captureMutationIdentity,
    commitSnapshot,
    getEffectiveScopeRef,
    isMutationIdentityCurrent,
    retryInitialization,
  ]);

  const runMutation = useCallback(
    <T>(
      action: string,
      identity: MutationIdentity,
      operation: () => Promise<T>,
      acceptSnapshot: (value: T) => SshForwardSnapshot | null,
    ): Promise<T> => {
      queuedMutationCount.current += 1;
      const execute = async (): Promise<T> => {
        try {
          if (!identity.host) throw toSshForwardError(null);
          if (!isMutationIdentityCurrent(identity)) {
            throw toSshForwardError(null);
          }
          if (
            identity.readiness !== "unmanaged" &&
            identity.readiness !== "ready"
          ) {
            const parsed = toSshForwardError(readinessError);
            if (isMutationIdentityCurrent(identity)) setError(parsed);
            throw parsed;
          }
          pendingActionRef.current = action;
          pendingIdentityRef.current = identity;
          setPendingAction(action);
          preserveConnectTimeoutRef.current = false;
          setError(null);
          const result = await operation();
          const next = acceptSnapshot(result);
          if (next && isMutationIdentityCurrent(identity))
            commitSnapshot(next, false);
          return result;
        } catch (nextError) {
          const parsed = toSshForwardError(nextError);
          // Refresh once after stale state settles. The failed operation is never
          // replayed; callers must decide whether and how to retry it.
          if (
            isMutationIdentityCurrent(identity) &&
            REFRESHABLE_CONFLICT_CODES.has(parsed.code)
          )
            trailing.current = true;
          preserveConnectTimeoutRef.current =
            parsed.code === "SSH_CONNECT_TIMEOUT";
          if (isMutationIdentityCurrent(identity)) setError(parsed);
          throw parsed;
        } finally {
          queuedMutationCount.current -= 1;
          if (queuedMutationCount.current === 0) {
            if (
              pendingActionRef.current === action &&
              pendingIdentityRef.current === identity
            ) {
              pendingActionRef.current = null;
              pendingIdentityRef.current = null;
              setPendingAction(null);
            }
            if (trailing.current) {
              trailing.current = false;
              void refresh();
            }
          }
        }
      };
      const queued = mutationQueue.current.then(execute, execute);
      mutationQueue.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [commitSnapshot, isMutationIdentityCurrent, readinessError, refresh],
  );

  const mutate = useCallback(
    <T>(
      action: string,
      operation: (nativeHost: SshForwardHost) => Promise<T>,
      accept: (value: T) => SshForwardSnapshot | null = (value) =>
        value as SshForwardSnapshot,
    ) => {
      const identity = captureMutationIdentity(host, readiness);
      return runMutation(
        action,
        identity,
        () => {
          if (!identity.host || hostRef.current !== identity.host)
            throw toSshForwardError(null);
          return operation(identity.host);
        },
        accept,
      );
    },
    [captureMutationIdentity, host, readiness, runMutation],
  );

  const createConnection = useCallback(
    (connection: SshConnectionProfile) =>
      mutate("createConnection", (nativeHost) =>
        nativeHost.createConnection(getEffectiveScopeRef(), connection),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const updateConnection = useCallback(
    (
      connectionProfileId: string,
      expectedGeneration: WireCounter,
      connection: SshConnectionProfile,
    ) =>
      mutate("updateConnection", (nativeHost) =>
        nativeHost.updateConnection(
          getEffectiveScopeRef(),
          connectionProfileId,
          expectedGeneration,
          connection,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const deleteConnection = useCallback(
    (connectionProfileId: string, expectedGeneration: WireCounter) =>
      mutate("deleteConnection", (nativeHost) =>
        nativeHost.deleteConnection(
          getEffectiveScopeRef(),
          connectionProfileId,
          expectedGeneration,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const createRule = useCallback(
    (
      connectionProfileId: string,
      expectedConnectionGeneration: WireCounter,
      rule: SshForwardRule,
    ) =>
      mutate("createRule", (nativeHost) =>
        nativeHost.createRule(
          getEffectiveScopeRef(),
          connectionProfileId,
          expectedConnectionGeneration,
          rule,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const updateRule = useCallback(
    (
      connectionProfileId: string,
      expectedConnectionGeneration: WireCounter,
      ruleId: string,
      expectedRuleGeneration: WireCounter,
      rule: SshForwardRule,
    ) =>
      mutate("updateRule", (nativeHost) =>
        nativeHost.updateRule(
          getEffectiveScopeRef(),
          connectionProfileId,
          expectedConnectionGeneration,
          ruleId,
          expectedRuleGeneration,
          rule,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const deleteRule = useCallback(
    (
      connectionProfileId: string,
      expectedConnectionGeneration: WireCounter,
      ruleId: string,
      expectedRuleGeneration: WireCounter,
    ) =>
      mutate("deleteRule", (nativeHost) =>
        nativeHost.deleteRule(
          getEffectiveScopeRef(),
          connectionProfileId,
          expectedConnectionGeneration,
          ruleId,
          expectedRuleGeneration,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const connect = useCallback(
    (
      connectionProfileId: string,
      expectedGeneration: WireCounter,
      credentialAttemptId?: string,
    ) =>
      mutate("connect", (nativeHost) =>
        nativeHost.connect(
          getEffectiveScopeRef(),
          connectionProfileId,
          expectedGeneration,
          credentialAttemptId,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const disconnect = useCallback(
    (connectionProfileId: string, expectedGeneration: WireCounter) =>
      mutate("disconnect", (nativeHost) =>
        nativeHost.disconnect(
          getEffectiveScopeRef(),
          connectionProfileId,
          expectedGeneration,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const setRuleEnabled = useCallback(
    (
      connectionProfileId: string,
      expectedConnectionGeneration: WireCounter,
      ruleId: string,
      expectedRuleGeneration: WireCounter,
      enabled: boolean,
    ) =>
      mutate("setRuleEnabled", (nativeHost) =>
        nativeHost.setRuleEnabled(
          getEffectiveScopeRef(),
          connectionProfileId,
          expectedConnectionGeneration,
          ruleId,
          expectedRuleGeneration,
          enabled,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const listKeys = useCallback(
    () =>
      mutate(
        "listKeys",
        (nativeHost) => nativeHost.listKeys(getEffectiveScopeRef()),
        () => null,
      ),
    [mutate, getEffectiveScopeRef],
  );
  const loadKey = useCallback(
    (
      connectionProfileId: string,
      keyId: string,
      passphrase: string,
      expectedGeneration?: WireCounter,
      rememberForDays: 0 | 30 = 0,
    ) =>
      mutate("loadKey", (nativeHost) =>
        nativeHost.loadKey(
          getEffectiveScopeRef(),
          connectionProfileId,
          keyId,
          passphrase,
          expectedGeneration,
          rememberForDays,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const loadPassword = useCallback(
    (
      connectionProfileId: string,
      username: string,
      password: string,
      credentialAttemptId: string,
      expectedGeneration?: WireCounter,
      rememberForDays: 0 | 30 = 0,
    ) =>
      mutate("loadPassword", (nativeHost) =>
        nativeHost.loadPassword(
          getEffectiveScopeRef(),
          connectionProfileId,
          username,
          password,
          credentialAttemptId,
          expectedGeneration,
          rememberForDays,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const approveHost = useCallback(
    (
      connectionProfileId: string,
      expectedGeneration: WireCounter,
      challengeId: string,
      algorithm: string,
      fingerprint: string,
    ) =>
      mutate("approveHost", (nativeHost) =>
        nativeHost.approveHost(
          getEffectiveScopeRef(),
          connectionProfileId,
          expectedGeneration,
          challengeId,
          algorithm,
          fingerprint,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );
  const forgetCredential = useCallback(
    (connectionProfileId: string, expectedGeneration: WireCounter) =>
      mutate("forgetCredential", (nativeHost) =>
        nativeHost.forgetCredential(
          getEffectiveScopeRef(),
          connectionProfileId,
          expectedGeneration,
        ),
      ),
    [mutate, getEffectiveScopeRef],
  );

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    pendingActionRef.current = null;
    pendingIdentityRef.current = null;
    setPendingAction(null);
  }, [host, readiness]);

  useEffect(() => {
    if (!host || readiness === "unmanaged") return;
    if (readiness === "failed") {
      setError(toSshForwardError(readinessError));
      return;
    }
    if (readiness === "ready") void refresh();
  }, [host, readiness, readinessError, refresh]);

  useEffect(() => {
    if (readiness !== "initializing" && readiness !== "failed") return;
    snapshotRef.current = null;
    setSnapshot(null);
  }, [readiness]);

  useEffect(() => {
    if (!host) {
      snapshotRef.current = null;
      setSnapshot(null);
      preserveConnectTimeoutRef.current = false;
      setError(null);
      return;
    }
    return host.subscribe((event) => {
      const current = snapshotRef.current;
      if (!current || readiness === "initializing" || readiness === "failed")
        return;
      const hint = event.hint;
      if (
        hint.scopeId !== current.scopeId ||
        hint.desktopInstanceId !== current.context.desktopInstanceId ||
        hint.managerSessionId !== current.context.managerSessionId ||
        hint.clientEpoch !== current.context.clientEpoch ||
        hint.activationToken !== current.activationToken ||
        wireCounterToBigInt(hint.scopeGeneration) <
          wireCounterToBigInt(current.scopeGeneration) ||
        wireCounterToBigInt(hint.connectionsRevision) <
          wireCounterToBigInt(current.connectionsRevision) ||
        wireCounterToBigInt(hint.rulesRevision) <
          wireCounterToBigInt(current.rulesRevision) ||
        wireCounterToBigInt(hint.profilesRevision) <
          wireCounterToBigInt(current.profilesRevision) ||
        wireCounterToBigInt(hint.trustRevision) <
          wireCounterToBigInt(current.trustRevision)
      )
        return;
      const hinted = event.snapshot;
      if (
        hinted &&
        hinted.context.desktopInstanceId ===
          current.context.desktopInstanceId &&
        hinted.context.managerSessionId === current.context.managerSessionId &&
        hinted.context.clientEpoch === current.context.clientEpoch &&
        hinted.activationToken === hint.activationToken &&
        hinted.scopeId === hint.scopeId &&
        wireCounterToBigInt(hinted.scopeGeneration) >=
          wireCounterToBigInt(hint.scopeGeneration) &&
        wireCounterToBigInt(hinted.connectionsRevision) >=
          wireCounterToBigInt(hint.connectionsRevision) &&
        wireCounterToBigInt(hinted.rulesRevision) >=
          wireCounterToBigInt(hint.rulesRevision) &&
        wireCounterToBigInt(hinted.profilesRevision) >=
          wireCounterToBigInt(hint.profilesRevision) &&
        wireCounterToBigInt(hinted.trustRevision) >=
          wireCounterToBigInt(hint.trustRevision)
      ) {
        commitSnapshot(hinted, false);
        if (!preserveConnectTimeoutRef.current) setError(null);
        return;
      }
      void refresh();
    });
  }, [commitSnapshot, host, readiness, refresh]);

  return {
    scopeRef,
    snapshot,
    error,
    pending: pendingAction !== null,
    pendingAction,
    refresh,
    createConnection,
    updateConnection,
    deleteConnection,
    createRule,
    updateRule,
    deleteRule,
    connect,
    disconnect,
    setRuleEnabled,
    listKeys,
    loadKey,
    loadPassword,
    approveHost,
    forgetCredential,
  };
}
