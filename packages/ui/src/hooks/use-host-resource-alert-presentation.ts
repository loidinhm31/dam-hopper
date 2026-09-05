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

interface HostResourceAlertPresentationState {
  versions: AlertVersion[];
  unreadIds: string[];
  recordAlert: (alert?: PresentableAlert | null) => void;
  recordSnapshotAlerts: (
    alert?: HostResourceAlert | null,
    resourceAlerts?: HostResourceResourceAlert[],
  ) => void;
  markRead: () => void;
  reset: () => void;
}

/**
 * Keeps bounded presentation state only. React Query remains authoritative for
 * the snapshot and incident history, while repeated updates retain one ID.
 */
export const useHostResourceAlertPresentationStore =
  create<HostResourceAlertPresentationState>((set) => ({
    versions: [],
    unreadIds: [],
    recordAlert: (alert) => {
      const incidentId = alert?.incidentId;
      if (!alert || !incidentId) return;
      set((current) => {
        if ("resolvedAt" in alert && alert.resolvedAt != null) {
          return {
            versions: current.versions.filter(
              (version) => version.incidentId !== incidentId,
            ),
            unreadIds: current.unreadIds.filter((id) => id !== incidentId),
          };
        }
        const previous = current.versions.find(
          (version) => version.incidentId === incidentId,
        );
        const changed =
          !previous ||
          previous.state !== alert.state ||
          previous.severity !== alert.severity;
        const versions = [
          ...current.versions.filter(
            (version) => version.incidentId !== incidentId,
          ),
          {
            incidentId,
            resource: "kind" in alert,
            state: alert.state,
            severity: alert.severity,
          },
        ].slice(-MAX_PRESENTED_INCIDENTS);
        const unreadIds = changed
          ? current.unreadIds.includes(incidentId)
            ? current.unreadIds
            : [...current.unreadIds, incidentId].slice(-MAX_PRESENTED_INCIDENTS)
          : current.unreadIds;
        return { versions, unreadIds };
      });
    },
    recordSnapshotAlerts: (alert, resourceAlerts) => {
      set((current) => {
        const nextAlerts = [
          ...(alert ? [alert] : []),
          ...(resourceAlerts ?? []),
        ];
        let versions = current.versions;
        let unreadIds = current.unreadIds;

        for (const nextAlert of nextAlerts) {
          const incidentId = nextAlert.incidentId;
          if (!incidentId) continue;
          const resource = "kind" in nextAlert;
          const previous = versions.find(
            (version) => version.incidentId === incidentId,
          );
          const changed =
            !previous ||
            previous.state !== nextAlert.state ||
            previous.severity !== nextAlert.severity;
          versions = [
            ...versions.filter((version) => version.incidentId !== incidentId),
            {
              incidentId,
              resource,
              state: nextAlert.state,
              severity: nextAlert.severity,
            },
          ].slice(-MAX_PRESENTED_INCIDENTS);
          if (changed && !unreadIds.includes(incidentId)) {
            unreadIds = [...unreadIds, incidentId].slice(
              -MAX_PRESENTED_INCIDENTS,
            );
          }
        }

        // Undefined means an older server did not send the additive field.
        // An explicit array is authoritative for resource incidents only.
        if (resourceAlerts !== undefined) {
          const activeIds = new Set(
            resourceAlerts.map((item) => item.incidentId),
          );
          const removedIds = versions
            .filter(
              (version) =>
                version.resource && !activeIds.has(version.incidentId ?? ""),
            )
            .map((version) => version.incidentId)
            .filter((id): id is string => id != null);
          versions = versions.filter(
            (version) =>
              !version.resource || activeIds.has(version.incidentId ?? ""),
          );
          unreadIds = unreadIds.filter((id) => !removedIds.includes(id));
        }

        return { versions, unreadIds };
      });
    },
    markRead: () => set({ unreadIds: [] }),
    reset: () => set({ versions: [], unreadIds: [] }),
  }));

export function useHostResourceAlertPresentation(
  alert?: HostResourceAlert | null,
  resourceAlerts?: HostResourceResourceAlert[],
) {
  const recordSnapshotAlerts = useHostResourceAlertPresentationStore(
    (state) => state.recordSnapshotAlerts,
  );
  const unreadCount = useHostResourceAlertPresentationStore(
    (state) => state.unreadIds.length,
  );
  const markRead = useHostResourceAlertPresentationStore(
    (state) => state.markRead,
  );

  useEffect(() => {
    recordSnapshotAlerts(alert, resourceAlerts);
  }, [alert, resourceAlerts, recordSnapshotAlerts]);

  return { unreadCount, markRead };
}
