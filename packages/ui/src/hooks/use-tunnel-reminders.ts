import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  getProfiles,
  subscribeToProfileChanges,
  type ServerProfile,
} from "@/api/server-config.js";
import {
  getConnectionSnapshot,
  getTransport as getBoundTransport,
  isCurrentConnection,
  subscribeConnections,
} from "@/api/connections.js";
import { profileTunnelsQueryKey } from "@/api/query-client.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { TunnelInfo } from "@/api/client.js";
import { subscribeTunnelCacheEvents } from "./tunnel-cache-events.js";
import {
  dismissTunnelReminder,
  isTunnelReminderDismissed,
  subscribeTunnelReminderDismissals,
} from "@/lib/tunnel-reminder-dismissal.js";

const EMPTY_PROFILES: ServerProfile[] = [];
const getEmptyProfiles = () => EMPTY_PROFILES;

let connectionRevision = 0;
const subscribeConnectionRevision = (listener: () => void) => {
  return subscribeConnections(() => {
    connectionRevision += 1;
    listener();
  });
};
const getConnectionRevision = () => connectionRevision;

let dismissalRevision = 0;
const subscribeDismissalRevision = (listener: () => void) => {
  return subscribeTunnelReminderDismissals(() => {
    dismissalRevision += 1;
    listener();
  });
};
const getDismissalRevision = () => dismissalRevision;

export interface DueTunnelReminder {
  tunnelId: string;
  profileId: string;
  port: number;
  url?: string;
  label: string;
  startedAt: number;
  capturedOwner: ConnectionRef;
}

export interface TunnelReminderController {
  reminders: DueTunnelReminder[];
  stopTunnel: (reminder: DueTunnelReminder) => Promise<void>;
  dismissReminder: (reminder: DueTunnelReminder) => void;
}

export function useTunnelReminders(): TunnelReminderController {
  const qc = useQueryClient();

  const profiles = useSyncExternalStore(
    subscribeToProfileChanges,
    getProfiles,
    getEmptyProfiles,
  );

  // Subscribe to connection changes (generation updates on reconnect)
  const connectionsRevision = useSyncExternalStore(
    subscribeConnectionRevision,
    getConnectionRevision,
    getConnectionRevision,
  );

  // Subscribe to dismissal storage changes
  const dismissalsRevision = useSyncExternalStore(
    subscribeDismissalRevision,
    getDismissalRevision,
    getDismissalRevision,
  );

  const targetProfiles = profiles;

  const tunnelQueries = useQueries({
    queries: targetProfiles.map((p) => {
      const snap = getConnectionSnapshot(p.id);
      const conn: ConnectionRef = snap?.owner ?? { profileId: p.id, generation: 0 };
      return {
        queryKey: profileTunnelsQueryKey(conn),
        enabled: !!snap && isCurrentConnection(conn),
        queryFn: () => getBoundTransport(conn).invoke<TunnelInfo[]>("tunnel:list"),
      };
    }),
  });

  useEffect(() => subscribeTunnelCacheEvents(qc), [qc]);

  const reminders = useMemo<DueTunnelReminder[]>(() => {
    const list: DueTunnelReminder[] = [];
    for (let i = 0; i < targetProfiles.length; i++) {
      const profileId = targetProfiles[i].id;
      const snap = getConnectionSnapshot(profileId);
      if (!snap || !isCurrentConnection(snap.owner)) continue;
      const conn = snap.owner;
      const tunnels = (tunnelQueries[i]?.data as TunnelInfo[] | undefined) ?? [];

      for (const t of tunnels) {
        if (t.reminderDue && t.status === "ready") {
          if (!isTunnelReminderDismissed(profileId, t.id)) {
            list.push({
              tunnelId: t.id,
              profileId,
              port: t.port,
              url: t.url,
              label: t.label,
              startedAt: t.startedAt,
              capturedOwner: conn,
            });
          }
        }
      }
    }
    return list;
  }, [targetProfiles, tunnelQueries, connectionsRevision, dismissalsRevision]);

  const stopTunnel = useCallback(
    async (reminder: DueTunnelReminder): Promise<void> => {
      if (!isCurrentConnection(reminder.capturedOwner)) {
        throw new Error(
          `Cannot stop tunnel: connection for profile "${reminder.profileId}" is stale or disconnected`,
        );
      }
      const boundTransport = getBoundTransport(reminder.capturedOwner);
      await boundTransport.invoke("tunnel:stop", { id: reminder.tunnelId });
      await qc.cancelQueries({ queryKey: profileTunnelsQueryKey(reminder.capturedOwner), exact: true });
      if (!isCurrentConnection(reminder.capturedOwner)) return;
      qc.setQueryData<TunnelInfo[]>(
        profileTunnelsQueryKey(reminder.capturedOwner),
        (prev = []) => prev.filter((item) => item.id !== reminder.tunnelId),
      );
    },
    [qc],
  );

  const dismissReminder = useCallback((reminder: DueTunnelReminder): void => {
    dismissTunnelReminder(reminder.profileId, reminder.tunnelId);
  }, []);

  return {
    reminders,
    stopTunnel,
    dismissReminder,
  };
}
