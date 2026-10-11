import { describe, expect, it } from "vitest";
import { terminalInstanceKey, terminalKey } from "@/api/ownership.js";
import type { TraditionalTerminalAgentRow } from "@/lib/traditional-terminal-agents.js";
import {
  groupTraditionalTerminalAgentRows,
  nextAgentSessionId,
} from "./traditional-terminal-agent-groups.js";

type Presentation = TraditionalTerminalAgentRow["presentation"];

function row(
  id: string,
  groupId: string,
  presentation: Partial<Presentation> = {},
  harnessLabel: TraditionalTerminalAgentRow["harnessLabel"] = "OMP",
): TraditionalTerminalAgentRow {
  const terminalRef = { profileId: "p", id };
  return {
    key: terminalInstanceKey({ ...terminalRef, incarnation: 1 }),
    sessionId: terminalKey(terminalRef),
    terminalRef,
    incarnation: 1,
    groupId,
    projectLabel: `project-${groupId}`,
    profileLabel: "Profile",
    terminalTitle: `title-${id}`,
    harnessLabel,
    statusOwner: { profileId: "p", generation: 1 },
    availability: "ready",
    status: {} as TraditionalTerminalAgentRow["status"],
    presentation: {
      label: "Working",
      reasonLabel: null,
      outcomeHint: null,
      sourceLabel: "Lifecycle observation",
      coverageHint: null,
      ...presentation,
    },
  };
}

describe("groupTraditionalTerminalAgentRows", () => {
  it("collapses same-project same-status agents into one item and splits by status", () => {
    const groups = groupTraditionalTerminalAgentRows([
      row("a", "A"),
      row("b", "A", { label: "Idle" }),
      row("c", "A"),
    ]);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.terminalRef.id)])).toEqual([
      ["Working", ["a", "c"]],
      ["Idle", ["b"]],
    ]);
    expect(groups[0]!.profileId).toBe("p");
  });

  it("never merges equal statuses across projects and keeps project order", () => {
    const groups = groupTraditionalTerminalAgentRows([
      row("b1", "B"),
      row("a1", "A", { label: "Needs attention", reasonLabel: "Approval" }),
      row("b2", "B"),
    ]);
    expect(groups.map((g) => [g.groupId, g.rows.length])).toEqual([["B", 2], ["A", 1]]);
  });

  it("orders statuses by severity regardless of tab order", () => {
    const groups = groupTraditionalTerminalAgentRows([
      row("1", "A", { label: "Idle" }),
      row("2", "A", { label: "Unknown" }),
      row("3", "A", { label: "Working" }),
      row("4", "A", { label: "Needs attention", reasonLabel: "Error" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Needs attention", "Working", "Idle", "Unknown"]);
  });

  it("keeps different attention reasons as separate statuses", () => {
    const groups = groupTraditionalTerminalAgentRows([
      row("1", "A", { label: "Needs attention", reasonLabel: "Question" }),
      row("2", "A", { label: "Needs attention", reasonLabel: "Approval" }),
      row("3", "A", { label: "Needs attention", reasonLabel: "Approval" }),
    ]);
    expect(groups.map((g) => [g.reasonLabel, g.rows.length])).toEqual([
      ["Approval", 2],
      ["Question", 1],
    ]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
  });

  it("shows Done only when every member carries it and merges distinct metadata", () => {
    const done = { label: "Idle", outcomeHint: "Done (turn ended)" } as const;
    const unanimous = groupTraditionalTerminalAgentRows([
      row("1", "A", done, "Claude"),
      row("2", "A", { ...done, sourceLabel: "Hook observation", coverageHint: "limited" }, "OMP"),
    ])[0]!;
    expect(unanimous.outcomeHint).toBe("Done (turn ended)");
    expect(unanimous.harnessLabels).toEqual(["OMP", "Claude"]);
    expect(unanimous.sourceLabels).toEqual(["Lifecycle observation", "Hook observation"]);
    expect(unanimous.coverageHints).toEqual(["limited"]);
    const mixed = groupTraditionalTerminalAgentRows([
      row("1", "A", done),
      row("2", "A", { label: "Idle" }),
    ])[0]!;
    expect(mixed.outcomeHint).toBeNull();
  });

  it("returns no items for no rows", () => {
    expect(groupTraditionalTerminalAgentRows([])).toEqual([]);
  });
});

describe("nextAgentSessionId", () => {
  const [item] = groupTraditionalTerminalAgentRows([row("a", "A"), row("b", "A"), row("c", "A")]);
  const id = (name: string) => terminalKey({ profileId: "p", id: name });

  it("starts at the first member when the active terminal is outside the item", () => {
    expect(nextAgentSessionId(item!, null)).toBe(id("a"));
    expect(nextAgentSessionId(item!, id("elsewhere"))).toBe(id("a"));
  });

  it("advances past the active member and wraps", () => {
    expect(nextAgentSessionId(item!, id("a"))).toBe(id("b"));
    expect(nextAgentSessionId(item!, id("c"))).toBe(id("a"));
  });
});
