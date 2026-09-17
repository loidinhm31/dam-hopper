import { useEffect } from "react";
import { create } from "zustand";
import type {
  AlertSeverity,
  HostResourceAlert,
  HostResourceResourceAlert,
} from "@/api/client.js";

const MAX_PRESENTED_INCIDENTS = 50;

type PresentableAlert = HostResourceAlert | HostResourceResourceAlert;

type AlertVersion = {
  incidentId?: string | null;
  resource: boolean;
  state: string;
  severity: AlertSeverity;
};

interface ProfileAlertPresentation {
  versions: AlertVersion[];
  unreadIds: string[];
}

interface HostResourceAlertPresentationState {
  versions: AlertVersion[];
  unreadIds: string[];
  byProfile: Record<string, ProfileAlertPresentation>;
  recordAlert: (alert?: PresentableAlert | null, profileId?: string) => void;
  recordSnapshotAlerts: (
    alert?: HostResourceAlert | null,
    resourceAlerts?: HostResourceResourceAlert[],
    profileId?: string,
  ) => void;
  markRead: (profileId?: string) => void;
  reset: (profileId?: string) => void;
}

function reduceAlert(
  currentVersions: AlertVersion[],
  currentUnreadIds: string[],
  alert: PresentableAlert,
): { versions: AlertVersion[]; unreadIds: string[] } {
  const incidentId = alert.incidentId;
  if (!incidentId) return { versions: currentVersions, unreadIds: currentUnreadIds };
  if ("resolvedAt" in alert && alert.resolvedAt != null) {
    return {
      versions: currentVersions.filter((v) => v.incidentId !== incidentId),
      unreadIds: currentUnreadIds.filter((id) => id !== incidentId),
    };
  }
  const previous = currentVersions.find((v) => v.incidentId === incidentId);
  const changed =
    !previous ||
    previous.state !== alert.state ||
    previous.severity !== alert.severity;
  const versions = [
    ...currentVersions.filter((v) => v.incidentId !== incidentId),
    {
      incidentId,
      resource: "kind" in alert,
      state: alert.state,
      severity: alert.severity,
    },
  ].slice(-MAX_PRESENTED_INCIDENTS);
  const unreadIds = changed
    ? currentUnreadIds.includes(incidentId)
      ? currentUnreadIds
      : [...currentUnreadIds, incidentId].slice(-MAX_PRESENTED_INCIDENTS)
    : currentUnreadIds;
  return { versions, unreadIds };
}

function reduceSnapshotAlerts(
  currentVersions: AlertVersion[],
  currentUnreadIds: string[],
  alert?: HostResourceAlert | null,
  resourceAlerts?: HostResourceResourceAlert[],
): { versions: AlertVersion[]; unreadIds: string[] } {
  const nextAlerts = [
    ...(alert ? [alert] : []),
    ...(resourceAlerts ?? []),
  ];
  let versions = currentVersions;
  let unreadIds = currentUnreadIds;

  for (const nextAlert of nextAlerts) {
    const res = reduceAlert(versions, unreadIds, nextAlert);
    versions = res.versions;
    unreadIds = res.unreadIds;
  }

  if (resourceAlerts !== undefined) {
    const activeIds = new Set(resourceAlerts.map((item) => item.incidentId));
    const removedIds = versions
      .filter((v) => v.resource && !activeIds.has(v.incidentId ?? ""))
      .map((v) => v.incidentId)
      .filter((id): id is string => id != null);
    versions = versions.filter(
      (v) => !v.resource || activeIds.has(v.incidentId ?? ""),
    );
    unreadIds = unreadIds.filter((id) => !removedIds.includes(id));
  }

  return { versions, unreadIds };
}

export const useHostResourceAlertPresentationStore =
  create<HostResourceAlertPresentationState>((set) => ({
    versions: [],
    unreadIds: [],
    byProfile: {},
    recordAlert: (alert, profileId) => {
      const incidentId = alert?.incidentId;
      if (!alert || !incidentId) return;
      set((current) => {
        const globalRes = reduceAlert(current.versions, current.unreadIds, alert);
        const byProfile = { ...current.byProfile };
        if (profileId) {
          const profilePrev = current.byProfile[profileId] ?? { versions: [], unreadIds: [] };
          byProfile[profileId] = reduceAlert(profilePrev.versions, profilePrev.unreadIds, alert);
        }
        return { versions: globalRes.versions, unreadIds: globalRes.unreadIds, byProfile };
      });
    },
    recordSnapshotAlerts: (alert, resourceAlerts, profileId) => {
      set((current) => {
        const globalRes = reduceSnapshotAlerts(
          current.versions,
          current.unreadIds,
          alert,
          resourceAlerts,
        );
        const byProfile = { ...current.byProfile };
        if (profileId) {
          const profilePrev = current.byProfile[profileId] ?? { versions: [], unreadIds: [] };
          byProfile[profileId] = reduceSnapshotAlerts(
            profilePrev.versions,
            profilePrev.unreadIds,
            alert,
            resourceAlerts,
          );
        }
        return { versions: globalRes.versions, unreadIds: globalRes.unreadIds, byProfile };
      });
    },
    markRead: (profileId) =>
      set((current) => {
        if (profileId && current.byProfile[profileId]) {
          const nextByProfile = {
            ...current.byProfile,
            [profileId]: {
              ...current.byProfile[profileId],
              unreadIds: [],
            },
          };
          return { unreadIds: [], byProfile: nextByProfile };
        }
        return { unreadIds: [] };
      }),
    reset: (profileId) =>
      set((current) => {
        if (profileId) {
          const nextByProfile = { ...current.byProfile };
          delete nextByProfile[profileId];
          return { versions: [], unreadIds: [], byProfile: nextByProfile };
        }
        return { versions: [], unreadIds: [], byProfile: {} };
      }),
  }));

export function useHostResourceAlertPresentation(
  alert?: HostResourceAlert | null,
  resourceAlerts?: HostResourceResourceAlert[],
  profileId?: string,
) {
  const recordSnapshotAlerts = useHostResourceAlertPresentationStore(
    (state) => state.recordSnapshotAlerts,
  );
  const unreadCount = useHostResourceAlertPresentationStore((state) =>
    profileId
      ? (state.byProfile[profileId]?.unreadIds.length ?? 0)
      : state.unreadIds.length,
  );
  const markReadStore = useHostResourceAlertPresentationStore(
    (state) => state.markRead,
  );
  const markRead = () => markReadStore(profileId);

  useEffect(() => {
    recordSnapshotAlerts(alert, resourceAlerts, profileId);
  }, [alert, resourceAlerts, profileId, recordSnapshotAlerts]);

  return { unreadCount, markRead };
}
