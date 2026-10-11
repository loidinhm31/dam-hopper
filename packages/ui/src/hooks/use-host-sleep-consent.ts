import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  ApiRequestError,
  type ConsentDecision,
  type ConsentState,
  type IdleSuspendAgentFreeStatusV1,
  type IdleSuspendClientPresenceStatusV1,
  type IdleSuspendConsentStatusV1,
  type IdleSuspendStatusV1,
} from "@/api/client.js";
import {
  getAllConnectionSnapshots,
  getApi,
  getConnectionSnapshot,
  getUiConnectionReceipt,
  isCurrentConnection,
  subscribeConnections,
  subscribeUiConnectionReceipt,
} from "@/api/connections.js";
import { connectionKey, type ConnectionRef } from "@/api/ownership.js";
import { profileQueryKey } from "@/api/query-client.js";
import {
  getHostResourceSource,
  subscribeHostResourceSource,
} from "@/api/host-resource-stream-coordinator.js";
import { getProfiles, subscribeToProfileChanges } from "@/api/server-config.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HostSleepConsentActionTarget {
  readonly owner: ConnectionRef;
  readonly requestId: string;
  readonly requestRevision: number;
  readonly connectionId: string | null;
}

export interface HostSleepConsentQueueItem {
  readonly key: string;
  readonly dedupeKey: string;
  readonly owner: ConnectionRef;
  readonly profileId: string;
  readonly profileName: string;
  readonly endpointLabel: string;
  readonly aliasProfileNames: readonly string[];
  readonly serverEpoch: string | null;
  readonly status: IdleSuspendStatusV1;
  readonly agentFree: IdleSuspendAgentFreeStatusV1;
  readonly clientPresence: IdleSuspendClientPresenceStatusV1;
  readonly consent: IdleSuspendConsentStatusV1;
  readonly effectiveState: ConsentState;
  readonly effectiveDecision: ConsentDecision | null;
  readonly isSettled: boolean;
  readonly hasReceipt: boolean;
  readonly actionTarget: HostSleepConsentActionTarget;
  readonly isSubmitting: boolean;
  readonly pendingDecision: ConsentDecision | null;
  readonly errorMessage: string | null;
  readonly uncertaintyMessage: string | null;
}

export interface UseHostSleepConsentResult {
  readonly queue: readonly HostSleepConsentQueueItem[];
  readonly activeItem: HostSleepConsentQueueItem | null;
  readonly otherPendingCount: number;
  readonly approve: (target: HostSleepConsentActionTarget) => Promise<void>;
  readonly deny: (target: HostSleepConsentActionTarget) => Promise<void>;
  readonly dismiss: (target: HostSleepConsentActionTarget) => Promise<void>;
}

interface LocalRequestState {
  isSubmitting?: boolean;
  pendingDecision?: ConsentDecision | null;
  settledState?: ConsentState;
  settledDecision?: ConsentDecision | null;
  errorMessage?: string | null;
  uncertaintyMessage?: string | null;
}

export function useHostSleepConsent(enabled = true): UseHostSleepConsentResult {
  const qc = useQueryClient();
  const agentProfiles = useAgentStatusStore((s) => s.profiles);
  const [localStates, setLocalStates] = useState<
    Record<string, LocalRequestState>
  >({});
  const [dismissedKeys, setDismissedKeys] = useState<Record<string, true>>({});
  const seenActiveKeysRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const prevReceiptsRef = useRef<Map<string, string | null>>(new Map());

  const profileSig = useSyncExternalStore(
    subscribeToProfileChanges,
    () => JSON.stringify(getProfiles().map((p) => [p.id, p.name, p.url])),
    () => "[]",
  );
  const connSig = useSyncExternalStore(
    subscribeConnections,
    () =>
      JSON.stringify(
        getAllConnectionSnapshots().map((s) => [
          s.owner.profileId,
          s.status,
          s.owner.generation,
          s.serverUrl,
        ]),
      ),
    () => "[]",
  );

  const connectedTargets = useMemo(() => {
    const profiles = getProfiles();
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const result: Array<{
      profileId: string;
      profileName: string;
      endpointLabel: string;
      owner: ConnectionRef;
    }> = [];
    const added = new Set<string>();
    for (const p of profiles) {
      const snap = getConnectionSnapshot(p.id);
      if (
        snap &&
        snap.status === "connected" &&
        isCurrentConnection(snap.owner)
      ) {
        added.add(p.id);
        result.push({
          profileId: p.id,
          profileName: p.name || p.id,
          endpointLabel: snap.serverUrl || p.url || p.name || p.id,
          owner: snap.owner,
        });
      }
    }
    for (const snap of getAllConnectionSnapshots()) {
      const profId = snap.owner.profileId;
      if (
        !added.has(profId) &&
        snap.status === "connected" &&
        isCurrentConnection(snap.owner)
      ) {
        const p = byId.get(profId);
        result.push({
          profileId: profId,
          profileName: p?.name || profId,
          endpointLabel: snap.serverUrl || p?.url || profId,
          owner: snap.owner,
        });
      }
    }
    return result;
  }, [profileSig, connSig]);

  const receiptSig = useSyncExternalStore(
    useCallback(
      (notify) => {
        const unsubs = connectedTargets.map((t) =>
          subscribeUiConnectionReceipt(t.owner, () => notify()),
        );
        for (const t of connectedTargets) {
          unsubs.push(subscribeHostResourceSource(t.owner, qc, notify));
        }
        return () => unsubs.forEach((u) => u());
      },
      [connectedTargets, qc],
    ),
    () =>
      connectedTargets
        .map((t) => {
          const r = getUiConnectionReceipt(t.owner);
          const s = getHostResourceSource(t.owner, qc);
          return `${connectionKey(t.owner)}:${r?.connectionId ?? ""}:${s.freshness.serverEpoch ?? ""}:${s.freshness.isSnapshotFresh}`;
        })
        .join("|"),
    () => "",
  );

  useEffect(() => {
    if (!enabled) return;
    const activeOwnerPrefixes = new Set(
      connectedTargets.map((t) => `${connectionKey(t.owner)}:`),
    );
    for (const key of Array.from(seenActiveKeysRef.current)) {
      const prefix = key.slice(0, key.lastIndexOf(":") + 1);
      if (!activeOwnerPrefixes.has(prefix))
        seenActiveKeysRef.current.delete(key);
    }
    const currentOwnerKeys = new Set<string>();
    for (const t of connectedTargets) {
      const oKey = connectionKey(t.owner);
      currentOwnerKeys.add(oKey);
      const connId = getUiConnectionReceipt(t.owner)?.connectionId ?? null;
      const prev = prevReceiptsRef.current.get(oKey);
      if (prev !== connId) {
        prevReceiptsRef.current.set(oKey, connId);
        if (connId !== null && isCurrentConnection(t.owner)) {
          void qc.invalidateQueries({
            queryKey: profileQueryKey(
              t.owner,
              "system",
              "idle-suspend",
              "v1",
              "status",
            ),
          });
        }
      }
    }
    for (const k of Array.from(prevReceiptsRef.current.keys())) {
      if (!currentOwnerKeys.has(k)) prevReceiptsRef.current.delete(k);
    }
  }, [connectedTargets, enabled, qc, receiptSig]);

  const queries = useQueries({
    queries: connectedTargets.map((t) => ({
      queryKey: profileQueryKey(
        t.owner,
        "system",
        "idle-suspend",
        "v1",
        "status",
      ),
      queryFn: () => getApi(t.owner).system.idleSuspendStatus(),
      enabled: enabled && isCurrentConnection(t.owner),
      staleTime: 5_000,
      retry: false,
    })),
  });

  const queue = useMemo<HostSleepConsentQueueItem[]>(() => {
    if (!enabled) return [];
    const byDedupe = new Map<
      string,
      HostSleepConsentQueueItem & { mutableAliases: string[] }
    >();
    for (let i = 0; i < connectedTargets.length; i++) {
      const target = connectedTargets[i];
      if (!isCurrentConnection(target.owner)) continue;
      const status = queries[i]?.data;
      if (
        !status ||
        status.automaticPolicy !== "agent-free" ||
        !status.agentFree ||
        !status.clientPresence ||
        !status.consent
      ) {
        continue;
      }
      const consent = status.consent;
      const itemKey = `${connectionKey(target.owner)}:${consent.requestId}`;
      const isLiveHandoff =
        consent.state === "approved" &&
        (status.agentFree.phase === "approved" ||
          status.agentFree.phase === "finalCheck" ||
          status.agentFree.phase === "handedOff");
      if (consent.state === "pending" || isLiveHandoff) {
        seenActiveKeysRef.current.add(itemKey);
      }
      const local = localStates[itemKey];
      if (!seenActiveKeysRef.current.has(itemKey) && !local) continue;

      const resSource = getHostResourceSource(target.owner, qc);
      const resEpoch = resSource.freshness.isSnapshotFresh
        ? resSource.freshness.serverEpoch
        : null;
      const agentProf = agentProfiles.get(target.profileId);
      const agentEpoch =
        agentProf &&
        agentProf.owner.generation === target.owner.generation &&
        agentProf.availability === "ready" &&
        agentProf.epoch !== null
          ? String(agentProf.epoch)
          : null;
      const serverEpoch = resEpoch ?? agentEpoch ?? null;
      const dedupeKey =
        serverEpoch !== null && UUID_REGEX.test(consent.requestId)
          ? `server-instance:${serverEpoch}:${consent.requestId}`
          : `owner:${itemKey}`;

      if (dismissedKeys[itemKey] || dismissedKeys[dedupeKey]) continue;

      const effectiveState: ConsentState =
        consent.state !== "pending"
          ? consent.state
          : (local?.settledState ?? "pending");
      const effectiveDecision: ConsentDecision | null =
        consent.decision ?? local?.settledDecision ?? null;
      const isSettled = effectiveState !== "pending";
      const receipt = getUiConnectionReceipt(target.owner);

      const existing = byDedupe.get(dedupeKey);
      if (existing) {
        if (!existing.mutableAliases.includes(target.profileName)) {
          existing.mutableAliases.push(target.profileName);
        }
        continue;
      }
      const mutableAliases = [target.profileName];
      byDedupe.set(dedupeKey, {
        key: itemKey,
        dedupeKey,
        owner: target.owner,
        profileId: target.profileId,
        profileName: target.profileName,
        endpointLabel: target.endpointLabel,
        aliasProfileNames: mutableAliases,
        serverEpoch,
        status,
        agentFree: status.agentFree,
        clientPresence: status.clientPresence,
        consent,
        effectiveState,
        effectiveDecision,
        isSettled,
        hasReceipt: receipt !== null,
        actionTarget: Object.freeze({
          owner: target.owner,
          requestId: consent.requestId,
          requestRevision: consent.requestRevision,
          connectionId: receipt?.connectionId ?? null,
        }),
        isSubmitting: Boolean(local?.isSubmitting),
        pendingDecision: local?.pendingDecision ?? null,
        errorMessage: local?.errorMessage ?? null,
        uncertaintyMessage: local?.uncertaintyMessage ?? null,
        mutableAliases,
      });
    }
    return Array.from(byDedupe.values()).sort((a, b) => {
      if (a.consent.requestedAtMs !== b.consent.requestedAtMs) {
        return a.consent.requestedAtMs - b.consent.requestedAtMs;
      }
      const pCmp = a.owner.profileId.localeCompare(b.owner.profileId);
      if (pCmp !== 0) return pCmp;
      if (a.owner.generation !== b.owner.generation)
        return a.owner.generation - b.owner.generation;
      return a.consent.requestId.localeCompare(b.consent.requestId);
    });
  }, [
    enabled,
    connectedTargets,
    queries,
    localStates,
    dismissedKeys,
    qc,
    agentProfiles,
    receiptSig,
  ]);

  const submitDecision = useCallback(
    async (
      target: HostSleepConsentActionTarget,
      decision: ConsentDecision,
      source: "button" | "dismiss",
      dedupeKey?: string,
    ) => {
      if (useCognitoModeStore.getState().active) return;
      if (!isCurrentConnection(target.owner)) return;
      const itemKey = `${connectionKey(target.owner)}:${target.requestId}`;
      if (inFlightRef.current.has(itemKey)) return;

      const receipt = getUiConnectionReceipt(target.owner);
      if (
        !receipt ||
        (target.connectionId !== null &&
          receipt.connectionId !== target.connectionId)
      ) {
        setLocalStates((prev) => ({
          ...prev,
          [itemKey]: {
            ...prev[itemKey],
            isSubmitting: false,
            pendingDecision: null,
            errorMessage:
              "Socket capability changed or is not yet ready. Reconciling server status.",
          },
        }));
        if (isCurrentConnection(target.owner)) {
          void qc.invalidateQueries({
            queryKey: profileQueryKey(
              target.owner,
              "system",
              "idle-suspend",
              "v1",
              "status",
            ),
          });
        }
        return;
      }

      inFlightRef.current.add(itemKey);
      setLocalStates((prev) => ({
        ...prev,
        [itemKey]: {
          ...prev[itemKey],
          isSubmitting: true,
          pendingDecision: decision,
          errorMessage: null,
          uncertaintyMessage: null,
        },
      }));

      try {
        const resp = await getApi(target.owner).system.submitConsentDecision({
          requestId: target.requestId,
          requestRevision: target.requestRevision,
          connectionId: receipt.connectionId,
          decisionCapability: receipt.decisionCapability,
          decision,
        });
        if (
          !isCurrentConnection(target.owner) ||
          getUiConnectionReceipt(target.owner)?.connectionId !==
            receipt.connectionId
        ) {
          return;
        }
        setLocalStates((prev) => ({
          ...prev,
          [itemKey]: {
            isSubmitting: false,
            pendingDecision: null,
            settledState: resp.decision === "approve" ? "approved" : "denied",
            settledDecision: resp.decision,
            errorMessage: null,
            uncertaintyMessage: null,
          },
        }));
        if (source === "dismiss" && resp.decision === "deny") {
          setDismissedKeys((prev) => ({
            ...prev,
            [itemKey]: true,
            ...(dedupeKey ? { [dedupeKey]: true } : {}),
          }));
        }
        void qc.invalidateQueries({
          queryKey: profileQueryKey(
            target.owner,
            "system",
            "idle-suspend",
            "v1",
            "status",
          ),
        });
      } catch (err) {
        if (!isCurrentConnection(target.owner)) return;
        void qc.invalidateQueries({
          queryKey: profileQueryKey(
            target.owner,
            "system",
            "idle-suspend",
            "v1",
            "status",
          ),
        });
        if (err instanceof ApiRequestError && err.status === 409) {
          const code = err.code;
          const contraryDecision: ConsentDecision | null =
            code === "decisionAlreadySettled"
              ? decision === "approve"
                ? "deny"
                : "approve"
              : null;
          const settledState: ConsentState =
            code === "consentExpired"
              ? "expired"
              : code === "consentCancelled" || code === "consentUnavailable"
                ? "cancelled"
                : code === "idleSuspendHandoffInProgress"
                  ? "approved"
                  : contraryDecision === "deny"
                    ? "denied"
                    : "approved";
          setLocalStates((prev) => ({
            ...prev,
            [itemKey]: {
              isSubmitting: false,
              pendingDecision: null,
              settledState,
              settledDecision:
                contraryDecision ??
                (code === "idleSuspendHandoffInProgress" ? "approve" : null),
              errorMessage:
                code === "idleSuspendHandoffInProgress"
                  ? "Host suspend handoff is already in progress and cannot be cancelled."
                  : code === "decisionAlreadySettled"
                    ? "Decision was already settled by another session. Showing accepted server decision."
                    : err.message || "Consent request is no longer pending.",
              uncertaintyMessage: null,
            },
          }));
          return;
        }
        const isUncertain =
          !(err instanceof ApiRequestError) ||
          err.status === 503 ||
          err.status === 504 ||
          err.status === 408 ||
          err.code === "presenceUnavailable" ||
          err.code === "consentUnavailable";
        setLocalStates((prev) => ({
          ...prev,
          [itemKey]: {
            ...prev[itemKey],
            isSubmitting: false,
            pendingDecision: null,
            errorMessage: isUncertain
              ? null
              : err instanceof Error
                ? err.message
                : "Failed to submit consent decision.",
            uncertaintyMessage: isUncertain
              ? "Outcome uncertain due to timeout or server unavailability. Reconciling authoritative status."
              : null,
          },
        }));
      } finally {
        inFlightRef.current.delete(itemKey);
      }
    },
    [qc],
  );

  const approve = useCallback(
    (target: HostSleepConsentActionTarget) =>
      submitDecision(target, "approve", "button"),
    [submitDecision],
  );
  const deny = useCallback(
    (target: HostSleepConsentActionTarget) =>
      submitDecision(target, "deny", "button"),
    [submitDecision],
  );
  const dismiss = useCallback(
    async (target: HostSleepConsentActionTarget) => {
      if (useCognitoModeStore.getState().active) return;
      const itemKey = `${connectionKey(target.owner)}:${target.requestId}`;
      const matched = queue.find(
        (q) =>
          q.key === itemKey ||
          (q.owner.profileId === target.owner.profileId &&
            q.consent.requestId === target.requestId),
      );
      if (!matched || matched.isSettled) {
        setDismissedKeys((prev) => ({
          ...prev,
          [itemKey]: true,
          ...(matched ? { [matched.dedupeKey]: true } : {}),
        }));
        return;
      }
      await submitDecision(target, "deny", "dismiss", matched.dedupeKey);
    },
    [queue, submitDecision],
  );

  const activeItem = queue[0] ?? null;
  const otherPendingCount = useMemo(
    () => queue.slice(1).filter((item) => !item.isSettled).length,
    [queue],
  );

  return { queue, activeItem, otherPendingCount, approve, deny, dismiss };
}
