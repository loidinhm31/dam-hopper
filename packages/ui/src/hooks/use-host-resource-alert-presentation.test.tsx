// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  HostResourceAlert,
  HostResourceResourceAlert,
} from "@/api/client.js";
import {
  useHostResourceAlertPresentation,
  useHostResourceAlertPresentationStore,
} from "./use-host-resource-alert-presentation.js";

const alert: HostResourceAlert = {
  incidentId: "incident-1",
  state: "memoryPressure",
  severity: "warning",
  updatedAt: 1,
  durationSeconds: 1,
  scope: "host",
  confidence: "high",
  threshold: "available memory",
  evidence: { cgroupOomDelta: false },
  nextAction: "Inspect workload.",
};

function Harness({
  alert,
  resourceAlerts,
}: {
  alert?: HostResourceAlert;
  resourceAlerts?: HostResourceResourceAlert[];
}) {
  const presentation = useHostResourceAlertPresentation(alert, resourceAlerts);
  return (
    <button type="button" onClick={presentation.markRead}>
      {presentation.unreadCount}
    </button>
  );
}

describe("useHostResourceAlertPresentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useHostResourceAlertPresentationStore.getState().reset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useHostResourceAlertPresentationStore.getState().reset();
  });

  it("deduplicates an escalation by incident ID and permits marking it read", async () => {
    await act(async () => root.render(<Harness alert={alert} />));
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("1");

    await act(async () =>
      root.render(
        <Harness alert={{ ...alert, severity: "critical", updatedAt: 2 }} />,
      ),
    );
    expect(button.textContent).toBe("1");

    await act(async () => button.click());
    expect(button.textContent).toBe("0");
  });

  it("retains concurrent target incidents and removes a recovered target", () => {
    const diskAlert: HostResourceResourceAlert = {
      kind: "disk",
      key: "disk:/data",
      state: "diskFull",
      severity: "critical",
      incidentId: "disk-1",
      openedAt: 1,
      updatedAt: 1,
      durationSeconds: 0,
      scope: "disk:/data",
      threshold: "usage>=95%",
      nextAction: "Free space.",
      evidence: { diskMountPoint: "/data", diskUsagePercent: 95 },
    };
    const temperatureAlert: HostResourceResourceAlert = {
      kind: "temperature",
      key: "temperature:thermal_zone0",
      state: "temperatureHigh",
      severity: "critical",
      incidentId: "temperature-1",
      openedAt: 1,
      updatedAt: 1,
      durationSeconds: 0,
      scope: "temperature:thermal_zone0",
      threshold: "celsius>60C for 5 minutes",
      nextAction: "Inspect cooling.",
      evidence: { temperatureSource: "thermal_zone0", temperatureCelsius: 61 },
    };
    const store = useHostResourceAlertPresentationStore.getState();
    store.recordAlert(diskAlert);
    store.recordAlert(temperatureAlert);
    expect(useHostResourceAlertPresentationStore.getState().unreadIds).toEqual([
      "disk-1",
      "temperature-1",
    ]);

    useHostResourceAlertPresentationStore
      .getState()
      .recordAlert({ ...diskAlert, resolvedAt: 2 });
    expect(useHostResourceAlertPresentationStore.getState().unreadIds).toEqual([
      "temperature-1",
    ]);
  });

  it("retains resource incidents when an older server omits currentAlerts", async () => {
    const resourceAlert: HostResourceResourceAlert = {
      kind: "disk",
      key: "disk:/data",
      state: "diskFull",
      severity: "critical",
      incidentId: "disk-1",
      openedAt: 1,
      updatedAt: 1,
      durationSeconds: 0,
      scope: "disk:/data",
      threshold: "usage>=95%",
      nextAction: "Free space.",
      evidence: { diskMountPoint: "/data", diskUsagePercent: 95 },
    };

    await act(async () =>
      root.render(<Harness alert={alert} resourceAlerts={[resourceAlert]} />),
    );
    expect(useHostResourceAlertPresentationStore.getState().unreadIds).toEqual([
      "incident-1",
      "disk-1",
    ]);

    await act(async () => root.render(<Harness alert={alert} />));
    expect(useHostResourceAlertPresentationStore.getState().unreadIds).toEqual([
      "incident-1",
      "disk-1",
    ]);
  });

  it("removes only resource incidents absent from an authoritative currentAlerts list", async () => {
    const diskAlert: HostResourceResourceAlert = {
      kind: "disk",
      key: "disk:/data",
      state: "diskFull",
      severity: "critical",
      incidentId: "disk-1",
      openedAt: 1,
      updatedAt: 1,
      durationSeconds: 0,
      scope: "disk:/data",
      threshold: "usage>=95%",
      nextAction: "Free space.",
      evidence: { diskMountPoint: "/data", diskUsagePercent: 95 },
    };

    await act(async () =>
      root.render(<Harness alert={alert} resourceAlerts={[diskAlert]} />),
    );
    await act(async () =>
      root.render(<Harness alert={alert} resourceAlerts={[]} />),
    );
    expect(useHostResourceAlertPresentationStore.getState().unreadIds).toEqual([
      "incident-1",
    ]);
  });

  it("clears retained incidents for a server-profile switch", () => {
    useHostResourceAlertPresentationStore.getState().recordAlert(alert);
    expect(useHostResourceAlertPresentationStore.getState().unreadIds).toEqual([
      "incident-1",
    ]);

    useHostResourceAlertPresentationStore.getState().reset();
    expect(useHostResourceAlertPresentationStore.getState().unreadIds).toEqual(
      [],
    );
  });
});
