import { create } from "zustand";
import type {
  AgentStatusAvailability,
  AgentStatusChangedPayload,
  AgentStatusRemovedPayload,
  AgentStatusSnapshotV1,
  TerminalAgentStatusRow,
} from "@/api/agent-status-types.js";
import type { ConnectionRef, TerminalRef } from "@/api/ownership.js";
import { deliverSemanticAgentAttention } from "@/lib/terminal-agent-notification-integration.js";

export type AgentStatusPresentationAvailability =
  | AgentStatusAvailability
  | "unsupported";

type AttentionCursor = { incarnation: number; revision: number };
interface ProfileStatus {
  owner: ConnectionRef;
  epoch: number | null;
  revision: number;
  availability: AgentStatusPresentationAvailability | null;
  rows: ReadonlyMap<string, TerminalAgentStatusRow>;
  cursors: ReadonlyMap<string, AttentionCursor>;
}
interface AgentStatusStore {
  profiles: ReadonlyMap<string, ProfileStatus>;
}

export const useAgentStatusStore = create<AgentStatusStore>(() => ({
  profiles: new Map(),
}));

function updateProfile(profileId: string, next: ProfileStatus | null): void {
  useAgentStatusStore.setState((state) => {
    const profiles = new Map(state.profiles);
    if (next) profiles.set(profileId, next);
    else profiles.delete(profileId);
    return { profiles };
  });
}

function current(owner: ConnectionRef): ProfileStatus | null {
  const profile = useAgentStatusStore.getState().profiles.get(owner.profileId);
  return profile?.owner.generation === owner.generation ? profile : null;
}

/** New generations retain last known rows only as unavailable until their silent baseline. */
export function beginAgentStatusConnection(owner: ConnectionRef): void {
  const previous = useAgentStatusStore.getState().profiles.get(owner.profileId);
  if (previous?.owner.generation === owner.generation) return;
  updateProfile(owner.profileId, {
    owner,
    epoch: previous?.epoch ?? null,
    revision: previous?.revision ?? -1,
    availability: previous ? "unavailable" : null,
    rows: previous?.rows ?? new Map(),
    cursors: previous?.cursors ?? new Map(),
  });
}

export function suspendAgentStatusConnection(owner: ConnectionRef): void {
  const profile = current(owner);
  if (profile && profile.availability !== "unsupported") {
    updateProfile(owner.profileId, { ...profile, availability: "unavailable" });
  }
}

export function disconnectAgentStatusConnection(owner: ConnectionRef): void {
  const profile = current(owner);
  if (profile)
    updateProfile(owner.profileId, { ...profile, availability: "unavailable" });
}

export function removeAgentStatusProfile(profileId: string): void {
  if (useAgentStatusStore.getState().profiles.has(profileId))
    updateProfile(profileId, null);
}

export function unsupportedAgentStatusConnection(owner: ConnectionRef): void {
  const profile = current(owner);
  if (profile) {
    updateProfile(owner.profileId, { ...profile, availability: "unsupported" });
  }
}

/** Snapshot is authoritative and silent, including reconnects and revision gaps. */
export function installAgentStatusSnapshot(
  owner: ConnectionRef,
  snapshot: AgentStatusSnapshotV1,
): void {
  const profile = current(owner);
  if (!profile || profile.availability === "unsupported") return;
  if (
    profile.epoch === snapshot.serverEpoch &&
    snapshot.revision < profile.revision
  )
    return;
  const sameEpoch = profile.epoch === snapshot.serverEpoch;
  const rows = new Map<string, TerminalAgentStatusRow>();
  const cursors = new Map<string, AttentionCursor>();
  for (const row of snapshot.terminals) {
    if (rows.has(row.id))
      throw new Error("Duplicate terminal agent status row");
    rows.set(row.id, row);
    const previous = sameEpoch ? profile.cursors.get(row.id) : undefined;
    cursors.set(row.id, {
      incarnation: row.incarnation,
      revision:
        previous?.incarnation === row.incarnation
          ? Math.max(previous.revision, row.attentionRevision)
          : row.attentionRevision,
    });
  }
  updateProfile(owner.profileId, {
    owner,
    epoch: snapshot.serverEpoch,
    revision: snapshot.revision,
    availability: snapshot.availability,
    rows,
    cursors,
  });
}

export type AgentStatusPushResult = "applied" | "ignored" | "gap";

/** Never deliver attention before atomically recording its stable terminal-local cursor. */
export function applyAgentStatusChanged(
  owner: ConnectionRef,
  event: AgentStatusChangedPayload,
  notify = true,
): AgentStatusPushResult {
  const profile = current(owner);
  if (!profile || profile.availability !== "ready") return "ignored";
  if (event.serverEpoch !== profile.epoch) return "gap";
  if (event.revision <= profile.revision) return "ignored";
  if (event.revision !== profile.revision + 1) return "gap";
  if (
    event.attention &&
    (event.attention.id !==
      `${event.serverEpoch}:${event.row.id}:${event.row.incarnation}:${event.row.attentionRevision}` ||
      event.attention.terminalId !== event.row.id ||
      event.attention.incarnation !== event.row.incarnation ||
      event.attention.agentSessionId !== event.row.agentSessionId ||
      event.attention.agentKind !== event.row.agentKind ||
      event.attention.attentionRevision !== event.row.attentionRevision)
  )
    return "gap";
  const prior = profile.rows.get(event.row.id);
  if (
    prior &&
    (event.row.incarnation < prior.incarnation ||
      (event.row.incarnation === prior.incarnation &&
        event.row.reporterEpoch < prior.reporterEpoch))
  )
    return "gap";
  const cursor = profile.cursors.get(event.row.id);
  if (
    cursor?.incarnation === event.row.incarnation &&
    event.row.attentionRevision < cursor.revision
  )
    return "gap";
  const rows = new Map(profile.rows);
  const cursors = new Map(profile.cursors);
  rows.set(event.row.id, event.row);
  const nextRevision =
    cursor?.incarnation === event.row.incarnation
      ? Math.max(cursor.revision, event.row.attentionRevision)
      : event.row.attentionRevision;
  cursors.set(event.row.id, {
    incarnation: event.row.incarnation,
    revision: nextRevision,
  });
  updateProfile(owner.profileId, {
    ...profile,
    rows,
    cursors,
    revision: event.revision,
  });
  if (
    notify &&
    event.attention &&
    (!cursor ||
      cursor.incarnation !== event.row.incarnation ||
      event.attention.attentionRevision > cursor.revision)
  ) {
    deliverSemanticAgentAttention(owner, event.row, event.attention);
  }
  return "applied";
}

export function applyAgentStatusRemoved(
  owner: ConnectionRef,
  event: AgentStatusRemovedPayload,
): AgentStatusPushResult {
  const profile = current(owner);
  if (
    !profile ||
    profile.availability === "unsupported" ||
    profile.epoch === null
  )
    return "ignored";
  if (event.serverEpoch !== profile.epoch) return "gap";
  if (event.revision <= profile.revision) return "ignored";
  if (event.revision !== profile.revision + 1) return "gap";
  const rows = new Map(profile.rows);
  const cursors = new Map(profile.cursors);
  const existing = rows.get(event.terminalId);
  if (existing?.incarnation === event.incarnation) {
    rows.delete(event.terminalId);
    cursors.delete(event.terminalId);
  } else if (existing && event.incarnation > existing.incarnation) {
    return "gap";
  }
  updateProfile(owner.profileId, {
    ...profile,
    rows,
    cursors,
    revision: event.revision,
  });
  return "applied";
}

export function useTerminalAgentStatus(
  ref: TerminalRef | undefined,
  incarnation?: number,
): TerminalAgentStatusRow | null {
  return useAgentStatusStore((state) => {
    const row = ref
      ? state.profiles.get(ref.profileId)?.rows.get(ref.id)
      : undefined;
    return row && (incarnation === undefined || row.incarnation === incarnation)
      ? row
      : null;
  });
}

export function useAgentStatusAvailability(
  profileId: string | undefined,
): AgentStatusPresentationAvailability | null {
  return useAgentStatusStore((state) =>
    profileId ? (state.profiles.get(profileId)?.availability ?? null) : null,
  );
}
