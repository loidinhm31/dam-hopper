// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostResourceAlert } from "@/api/client.js";
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

function Harness({ alert }: { alert?: HostResourceAlert }) {
  const presentation = useHostResourceAlertPresentation(alert);
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
