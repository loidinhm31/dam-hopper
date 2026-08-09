import { useEffect } from "react";
import { create } from "zustand";
import type { HostResourceAlert } from "@/api/client.js";

const MAX_PRESENTED_INCIDENTS = 50;

type AlertVersion = Pick<
  HostResourceAlert,
  "incidentId" | "state" | "severity"
>;

interface HostResourceAlertPresentationState {
  versions: AlertVersion[];
  unreadIds: string[];
  recordAlert: (alert?: HostResourceAlert) => void;
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
    markRead: () => set({ unreadIds: [] }),
    reset: () => set({ versions: [], unreadIds: [] }),
  }));

export function useHostResourceAlertPresentation(alert?: HostResourceAlert) {
  const recordAlert = useHostResourceAlertPresentationStore(
    (state) => state.recordAlert,
  );
  const unreadCount = useHostResourceAlertPresentationStore(
    (state) => state.unreadIds.length,
  );
  const markRead = useHostResourceAlertPresentationStore(
    (state) => state.markRead,
  );

  useEffect(() => {
    recordAlert(alert);
  }, [alert, recordAlert]);

  return { unreadCount, markRead };
}
