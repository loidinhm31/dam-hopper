import { useEffect } from "react";
import {
  getAllConnectionSnapshots,
  getApi,
  getTransport,
  isCurrentConnection,
  subscribeConnections,
} from "@/api/connections.js";
import { ApiRequestError, type ApiClient } from "@/api/client.js";
import {
  decodeAgentStatusChangedPayload,
  decodeAgentStatusInvalidatedPayload,
  decodeAgentStatusRemovedPayload,
  type AgentStatusSnapshotV1,
  type AgentStatusChangedPayload,
  type AgentStatusRemovedPayload,
  type AgentStatusInvalidatedPayload,
} from "@/api/agent-status-types.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { Transport } from "@/api/transport.js";
import {
  applyAgentStatusChanged,
  applyAgentStatusRemoved,
  beginAgentStatusConnection,
  disconnectAgentStatusConnection,
  installAgentStatusSnapshot,
  removeAgentStatusProfile,
  suspendAgentStatusConnection,
  unsupportedAgentStatusConnection,
} from "@/stores/agent-status.js";

const MAX_BASELINE_BUFFER = 256;
const RECONCILE_INTERVAL_MS = 15_000;
type Push =
  | { kind: "changed"; value: AgentStatusChangedPayload }
  | { kind: "removed"; value: AgentStatusRemovedPayload }
  | { kind: "invalidated"; value: AgentStatusInvalidatedPayload };

/** Subscriptions exist before the first snapshot request; live events never become catch-up alerts. */
export function watchAgentStatusConnection(
  owner: ConnectionRef,
  api: Pick<ApiClient["terminal"], "agentStatusSnapshot">,
  transport: Pick<Transport, "onEvent">,
  isCurrent: (owner: ConnectionRef) => boolean = isCurrentConnection,
): () => void {
  beginAgentStatusConnection(owner);
  let retired = false;
  let unsupported = false;
  let fetching = false;
  let requested = false;
  let buffering = true;
  let overflow = false;
  let buffer: Push[] = [];
  let suppressReplay = false;
  const isLive = () => !retired && !unsupported && isCurrent(owner);

  function requestBaseline(recovering = false): void {
    if (!isLive()) return;
    if (recovering) suppressReplay = true;
    if (fetching) {
      requested = true;
      return;
    }
    fetching = true;
    buffering = true;
    overflow = false;
    buffer = [];
    if (recovering) suspendAgentStatusConnection(owner);
    void api
      .agentStatusSnapshot()
      .then(
        (snapshot) => {
          if (!isLive()) return;
          try {
            installAgentStatusSnapshot(owner, snapshot);
            const replayable = canReplay(snapshot, buffer);
            if (!overflow && !requested && replayable) {
              for (const event of buffer) {
                if (event.value.revision <= snapshot.revision) continue;
                const result =
                  event.kind === "changed"
                    ? applyAgentStatusChanged(
                        owner,
                        event.value,
                        !suppressReplay,
                      )
                    : event.kind === "removed"
                      ? applyAgentStatusRemoved(owner, event.value)
                      : "gap";
                if (result === "gap") {
                  requested = true;
                  break;
                }
              }
            } else if (overflow || !replayable) {
              requested = true;
            }
            buffering = requested;
            if (requested) suspendAgentStatusConnection(owner);
            else suppressReplay = false;
          } catch {
            // A persistently malformed snapshot must not spin a fetch loop.
            requested = false;
            buffering = true;
            suspendAgentStatusConnection(owner);
          }
        },
        (error: unknown) => {
          if (!isLive()) return;
          if (error instanceof ApiRequestError && error.status === 404) {
            unsupported = true;
            unsupportedAgentStatusConnection(owner);
          } else {
            suspendAgentStatusConnection(owner);
          }
        },
      )
      .finally(() => {
        fetching = false;
        if (requested && isLive()) {
          requested = false;
          requestBaseline();
        }
      });
  }

  function receive(event: Push): void {
    if (!isLive()) return;
    if (event.kind === "invalidated") {
      requestBaseline(true);
      return;
    }
    if (buffering) {
      if (buffer.length === MAX_BASELINE_BUFFER) {
        overflow = true;
        buffer = [];
        requestBaseline(true);
      } else if (!overflow) {
        buffer.push(event);
      }
      return;
    }
    const result =
      event.kind === "changed"
        ? applyAgentStatusChanged(owner, event.value)
        : event.kind === "removed"
          ? applyAgentStatusRemoved(owner, event.value)
          : "gap";
    if (result === "gap") requestBaseline(true);
  }

  function onPush(kind: Push["kind"], payload: unknown): void {
    try {
      const event =
        kind === "changed"
          ? ({ kind, value: decodeAgentStatusChangedPayload(payload) } as const)
          : kind === "removed"
            ? ({
                kind,
                value: decodeAgentStatusRemovedPayload(payload),
              } as const)
            : ({
                kind,
                value: decodeAgentStatusInvalidatedPayload(payload),
              } as const);
      receive(event);
    } catch {
      requestBaseline(true);
    }
  }

  const unsubscribers = [
    transport.onEvent("terminal:agentStatusChanged", (payload) =>
      onPush("changed", payload),
    ),
    transport.onEvent("terminal:agentStatusRemoved", (payload) =>
      onPush("removed", payload),
    ),
    transport.onEvent("terminal:agentStatusInvalidated", (payload) =>
      onPush("invalidated", payload),
    ),
  ];
  const timer = setInterval(requestBaseline, RECONCILE_INTERVAL_MS);
  requestBaseline();
  return () => {
    retired = true;
    clearInterval(timer);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    disconnectAgentStatusConnection(owner);
  };
}

function canReplay(snapshot: AgentStatusSnapshotV1, buffer: Push[]): boolean {
  let revision = snapshot.revision;
  for (const event of buffer) {
    if (
      event.value.serverEpoch !== snapshot.serverEpoch ||
      event.kind === "invalidated"
    )
      return false;
    if (event.value.revision <= revision) continue;
    if (event.value.revision !== revision + 1) return false;
    revision = event.value.revision;
  }
  return true;
}

/** One root watcher per connected profile, independent of route and xterm mounting. */
export function useAgentStatusConnections(): void {
  useEffect(() => {
    const watchers = new Map<
      string,
      { generation: number; stop: () => void }
    >();
    const known = new Set<string>();
    function sync(): void {
      const snapshots = getAllConnectionSnapshots();
      const present = new Set(
        snapshots.map((snapshot) => snapshot.owner.profileId),
      );
      for (const [id, watcher] of watchers) {
        const snapshot = snapshots.find((item) => item.owner.profileId === id);
        if (
          !snapshot ||
          snapshot.status !== "connected" ||
          snapshot.owner.generation !== watcher.generation
        ) {
          watcher.stop();
          watchers.delete(id);
        }
      }
      for (const id of known)
        if (!present.has(id)) removeAgentStatusProfile(id);
      known.clear();
      for (const snapshot of snapshots) {
        const { owner } = snapshot;
        known.add(owner.profileId);
        if (snapshot.status !== "connected" || watchers.has(owner.profileId))
          continue;
        try {
          watchers.set(owner.profileId, {
            generation: owner.generation,
            stop: watchAgentStatusConnection(
              owner,
              getApi(owner).terminal,
              getTransport(owner),
            ),
          });
        } catch {
          // The connection changed during this synchronous scan; next snapshot retries.
        }
      }
    }
    const unsubscribe = subscribeConnections(sync);
    sync();
    return () => {
      unsubscribe();
      for (const watcher of watchers.values()) watcher.stop();
    };
  }, []);
}
