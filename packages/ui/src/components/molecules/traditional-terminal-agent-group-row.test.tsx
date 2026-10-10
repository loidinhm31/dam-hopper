// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalInstanceKey, terminalKey } from "@/api/ownership.js";
import {
  groupTraditionalTerminalAgentRows,
  type TraditionalTerminalAgentStatusGroup,
} from "@/lib/traditional-terminal-agent-groups.js";
import type { TraditionalTerminalAgentRow as RowModel } from "@/lib/traditional-terminal-agents.js";
import { TraditionalTerminalAgentGroupRow } from "./traditional-terminal-agent-group-row.js";

function makeRow(
  profileId = "server-a",
  id = "terminal-1",
  harnessLabel: RowModel["harnessLabel"] = "Codex",
): RowModel {
  const terminalRef = { profileId, id };
  return {
    key: terminalInstanceKey({ ...terminalRef, incarnation: 2 }),
    sessionId: terminalKey(terminalRef),
    terminalRef,
    incarnation: 2,
    groupId: `project-${profileId}`,
    projectLabel: profileId === "server-a" ? "Editor" : "Website",
    profileLabel: profileId === "server-a" ? "Development" : "Production",
    terminalTitle: `Shared terminal title ${id}`,
    harnessLabel,
    statusOwner: { profileId, generation: 3 },
    availability: "ready",
    status: {
      id, incarnation: 2, agentKind: "codex",
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

function groupOf(...rows: RowModel[]): TraditionalTerminalAgentStatusGroup {
  const groups = groupTraditionalTerminalAgentRows(rows);
  expect(groups).toHaveLength(1);
  return groups[0]!;
}

describe("TraditionalTerminalAgentGroupRow", () => {
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

  function renderGroup(group: TraditionalTerminalAgentStatusGroup, activeSessionId: string | null = null) {
    act(() => root.render(
      <TraditionalTerminalAgentGroupRow group={group} activeSessionId={activeSessionId} onSelectAgent={onSelectAgent} touchOptimized />,
    ));
    return container.querySelector("button")!;
  }

  it("keeps a single agent's full context, count badge 1, and selects its exact terminal", () => {
    const row = makeRow();
    const button = renderGroup(groupOf(row), row.sessionId);
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-current")).toBe("true");
    expect(button.getAttribute("aria-label")).toMatch(/^Codex: Shared terminal title terminal-1; Project: Editor; Server profile: Development; Working$/);
    for (const context of [row.terminalTitle, row.harnessLabel, row.projectLabel, row.profileLabel]) {
      expect(button.textContent).toContain(context);
    }
    expect(button.querySelector('[data-testid="agent-count-badge"]')!.textContent).toBe("1");
    expect(button.textContent).not.toContain(row.status.agentSessionId);
    expect(button.getAttribute("aria-label")).not.toContain(row.sessionId);
    act(() => button.click());
    expect(onSelectAgent).toHaveBeenCalledExactlyOnceWith(row.sessionId);
  });

  it("shows one item with a count badge for several agents and cycles members on activation", () => {
    const a = makeRow("server-a", "t-a", "OMP");
    const b = makeRow("server-a", "t-b", "Claude");
    const c = makeRow("server-a", "t-c", "OMP");
    const group = groupOf(a, b, c);
    const button = renderGroup(group);
    expect(button.querySelector('[data-testid="agent-count-badge"]')!.textContent).toBe("3");
    expect(button.getAttribute("aria-label")).toBe("OMP, Claude: 3 agents; Project: Editor; Server profile: Development; Working");
    expect(button.textContent).not.toContain("Shared terminal title");
    expect(button.hasAttribute("aria-current")).toBe(false);
    act(() => button.click());
    expect(onSelectAgent).toHaveBeenLastCalledWith(a.sessionId);
    renderGroup(group, a.sessionId);
    expect(button.getAttribute("aria-current")).toBe("true");
    act(() => button.click());
    expect(onSelectAgent).toHaveBeenLastCalledWith(b.sessionId);
    renderGroup(group, c.sessionId);
    act(() => button.click());
    expect(onSelectAgent).toHaveBeenLastCalledWith(a.sessionId);
  });

  it("retains accessible hook coverage while the observed agent is unavailable", () => {
    const row = makeRow();
    const button = renderGroup(groupOf({
      ...row,
      availability: "unavailable",
      presentation: { ...row.presentation, label: "Unavailable" },
    }));
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
    const button = renderGroup(groupOf({ ...row, presentation: {
      label: "Idle", reasonLabel: null, outcomeHint: "Done (turn ended)",
      sourceLabel: "Lifecycle observation", coverageHint: null,
    } }));
    expect(button.getAttribute("aria-label")).toContain("Idle");
    expect(button.getAttribute("aria-label")).not.toContain("Done");
    expect(button.textContent).toContain("Done (turn ended)");
    const hint = Array.from(button.querySelectorAll("[title]")).find((element) => element.textContent === "Done (turn ended)")!;
    expect(hint.getAttribute("title")).toContain("task success has not been verified");
    const description = document.getElementById(button.getAttribute("aria-describedby")!)!;
    expect(description.textContent).toContain("Lifecycle observation");
    expect(description.textContent).toContain("task success has not been verified");
  });

  it("preserves the button and focus when members change but the item identity stays", () => {
    const a = makeRow("server-a", "t-a");
    const b = makeRow("server-a", "t-b");
    const button = renderGroup(groupOf(a));
    button.focus();
    renderGroup(groupOf(a, b));
    expect(container.querySelector("button")).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.querySelector('[data-testid="agent-count-badge"]')!.textContent).toBe("2");
  });
});
