// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalInstanceKey, terminalKey } from "@/api/ownership.js";
import type { TraditionalTerminalAgentRow as RowModel } from "@/lib/traditional-terminal-agents.js";
import { TraditionalTerminalAgentRow } from "./traditional-terminal-agent-row.js";

function makeRow(profileId = "server-a"): RowModel {
  const terminalRef = { profileId, id: "terminal-1" };
  return {
    key: terminalInstanceKey({ ...terminalRef, incarnation: 2 }),
    sessionId: terminalKey(terminalRef),
    terminalRef,
    incarnation: 2,
    groupId: `project-${profileId}`,
    projectLabel: profileId === "server-a" ? "Editor" : "Website",
    profileLabel: profileId === "server-a" ? "Development" : "Production",
    terminalTitle: "Shared terminal title with a long descriptive suffix",
    harnessLabel: "Codex",
    statusOwner: { profileId, generation: 3 },
    availability: "ready",
    status: {
      id: terminalRef.id, incarnation: 2, agentKind: "codex",
      agentSessionId: "private-agent-id", reporterEpoch: 4,
      state: "working", source: "hook", attentionRevision: 0,
    },
    presentation: {
      label: "Working", reasonLabel: null, outcomeHint: null,
      sourceLabel: "Hook observation",
      coverageHint: "Hook observation (limited coverage; quiet reasoning and long waits become Unknown)",
    },
  };
}

describe("TraditionalTerminalAgentRow", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSelectAgent = vi.fn();

  beforeEach(() => {
    onSelectAgent.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderRow(row = makeRow(), active = false): HTMLButtonElement {
    act(() => root.render(
      <TraditionalTerminalAgentRow row={row} active={active} onSelectAgent={onSelectAgent} touchOptimized />,
    ));
    return container.querySelector("button")!;
  }

  it("exposes full context and selects the exact qualified terminal once", () => {
    const row = makeRow();
    const button = renderRow(row, true);
    expect(button.type).toBe("button");
    expect(button.getAttribute("role")).toBeNull();
    expect(button.getAttribute("aria-controls")).toBeNull();
    expect(button.getAttribute("aria-current")).toBe("true");
    for (const context of [row.terminalTitle, row.harnessLabel, row.projectLabel, row.profileLabel]) {
      expect(button.getAttribute("aria-label")).toContain(context);
      expect(button.textContent).toContain(context);
    }
    expect(button.textContent).not.toContain(row.status.agentSessionId);
    expect(button.getAttribute("aria-label")).not.toContain(row.sessionId);
    act(() => button.click());
    expect(onSelectAgent).toHaveBeenCalledExactlyOnceWith(row.sessionId);
    renderRow(row, false);
    expect(button.hasAttribute("aria-current")).toBe(false);
  });

  it("retains accessible hook coverage while the observed agent is unavailable", () => {
    const row = makeRow();
    const button = renderRow({
      ...row,
      availability: "unavailable",
      presentation: { ...row.presentation, label: "Unavailable" },
    });
    const description = document.getElementById(button.getAttribute("aria-describedby")!)!;
    expect(description.textContent).toMatch(/limited coverage/i);
    expect(description.textContent).toMatch(/quiet reasoning.*long waits.*Unknown/i);
    expect(description.textContent).not.toMatch(/task success|Done|ready/i);
    const source = Array.from(button.querySelectorAll("[title]"))
      .find((element) => element.textContent === row.presentation.sourceLabel)!;
    expect(source.getAttribute("title")).toMatch(/limited coverage/i);
  });
  it("keeps Idle primary and explains Done as unverified turn end", () => {
    const row = makeRow();
    const button = renderRow({ ...row, presentation: {
      label: "Idle", reasonLabel: null, outcomeHint: "Done (turn ended)",
      sourceLabel: "Lifecycle observation", coverageHint: null,
    } });
    expect(button.getAttribute("aria-label")).toContain("Idle");
    expect(button.getAttribute("aria-label")).not.toContain("Done");
    expect(button.textContent).toContain("Done (turn ended)");
    const hint = Array.from(button.querySelectorAll("[title]")).find((element) => element.textContent === "Done (turn ended)")!;
    expect(hint.getAttribute("title")).toContain("task success has not been verified");
    const description = document.getElementById(button.getAttribute("aria-describedby")!)!;
    expect(description.textContent).toContain("Lifecycle observation");
    expect(description.textContent).toContain("task success has not been verified");
  });

  it("distinguishes duplicate titles across project/profile and preserves focus on updates", () => {
    const first = makeRow();
    const second = makeRow("server-b");
    function renderRows(rows: readonly RowModel[]) {
      act(() => root.render(<>{rows.map((row) => (
        <TraditionalTerminalAgentRow key={row.key} row={row} active={false} onSelectAgent={onSelectAgent} />
      ))}</>));
    }
    renderRows([first, second]);
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons[0]!.getAttribute("aria-label")).toContain("Editor; Server profile: Development");
    expect(buttons[1]!.getAttribute("aria-label")).toContain("Website; Server profile: Production");
    buttons[1]!.focus();
    renderRows([{ ...first, presentation: { ...first.presentation, label: "Idle" } },
      { ...second, presentation: { ...second.presentation, label: "Needs attention", reasonLabel: "Approval" } }]);
    expect(Array.from(container.querySelectorAll("button"))).toEqual(buttons);
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1]!.getAttribute("aria-label")).toContain("Needs attention: Approval");
    act(() => buttons[1]!.click());
    expect(onSelectAgent).toHaveBeenCalledExactlyOnceWith(second.sessionId);
  });
});
