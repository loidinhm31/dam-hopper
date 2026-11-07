import { describe, expect, it } from "vitest";
import { projectKey } from "@/api/ownership.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { AggregatedProjectItem } from "@/hooks/use-aggregated-projects.js";
import {
  canDismissWorkspace,
  unionOpenWorkspaceGroups,
  type OpenWorkspaceRef,
} from "./agent-hub-open-workspaces.js";
import type { TraditionalTerminalProjectGroup } from "./traditional-terminal-projects.js";

describe("agent-hub-open-workspaces", () => {
  const inventoryItem1: AggregatedProjectItem = {
    profileId: "p1",
    profileName: "Profile One",
    serverUrl: "http://localhost:8080",
    project: { name: "dam-hopper" } as AggregatedProjectItem["project"],
    ref: { profileId: "p1", project: "dam-hopper" },
  };

  const inventoryItem2: AggregatedProjectItem = {
    profileId: "p1",
    profileName: "Profile One",
    serverUrl: "http://localhost:8080",
    project: { name: "shared-lib" } as AggregatedProjectItem["project"],
    ref: { profileId: "p1", project: "shared-lib" },
  };

  const inventoryItemCrossProfile: AggregatedProjectItem = {
    profileId: "p2",
    profileName: "Profile Two",
    serverUrl: "http://localhost:9090",
    project: { name: "shared-lib" } as AggregatedProjectItem["project"],
    ref: { profileId: "p2", project: "shared-lib" },
  };

  const existingSessionGroup: TraditionalTerminalProjectGroup<TabEntry> = {
    id: projectKey({ profileId: "p1", project: "dam-hopper" }),
    projectName: "dam-hopper",
    projectRef: { profileId: "p1", project: "dam-hopper" },
    profileId: "p1",
    profileName: "Profile One",
    label: "dam-hopper",
    terminalTabs: [{ sessionId: "term-1", label: "Shell" }],
    mountedSessions: [
      {
        sessionId: "term-1",
        project: "dam-hopper",
        command: "bash",
        terminalRef: { profileId: "p1", id: "term-1" },
      },
    ],
  };

  it("hydrates open refs absent from session groups with empty tabs and mounts", () => {
    const openRefs: OpenWorkspaceRef[] = [{ profileId: "p1", project: "shared-lib" }];
    const inventory = [inventoryItem1, inventoryItem2];

    const result = unionOpenWorkspaceGroups([existingSessionGroup], openRefs, inventory);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(existingSessionGroup);

    const hydrated = result[1];
    expect(hydrated.id).toBe(projectKey({ profileId: "p1", project: "shared-lib" }));
    expect(hydrated.projectName).toBe("shared-lib");
    expect(hydrated.projectRef).toEqual({ profileId: "p1", project: "shared-lib" });
    expect(hydrated.profileId).toBe("p1");
    expect(hydrated.profileName).toBe("Profile One");
    expect(hydrated.label).toBe("shared-lib");
    expect(hydrated.terminalTabs).toEqual([]);
    expect(hydrated.mountedSessions).toEqual([]);
  });

  it("drops open refs that are absent from inventory", () => {
    const openRefs: OpenWorkspaceRef[] = [
      { profileId: "p1", project: "missing-project" },
    ];
    const inventory = [inventoryItem1, inventoryItem2];

    const result = unionOpenWorkspaceGroups([existingSessionGroup], openRefs, inventory);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(existingSessionGroup);
  });

  it("deduplicates open refs already present in session groups or duplicated in openRefs", () => {
    const openRefs: OpenWorkspaceRef[] = [
      // Already in session group
      { profileId: "p1", project: "dam-hopper" },
      // New ref
      { profileId: "p1", project: "shared-lib" },
      // Duplicate of new ref
      { profileId: "p1", project: "shared-lib" },
    ];
    const inventory = [inventoryItem1, inventoryItem2];

    const result = unionOpenWorkspaceGroups([existingSessionGroup], openRefs, inventory);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(existingSessionGroup.id);
    expect(result[1].id).toBe(projectKey({ profileId: "p1", project: "shared-lib" }));
  });

  it("preserves deterministic order: session groups first, then openRefs in appearance order", () => {
    const openRefs: OpenWorkspaceRef[] = [
      { profileId: "p2", project: "shared-lib" },
      { profileId: "p1", project: "shared-lib" },
    ];
    const inventory = [inventoryItem1, inventoryItem2, inventoryItemCrossProfile];

    const result = unionOpenWorkspaceGroups([existingSessionGroup], openRefs, inventory);

    expect(result.map((g) => g.id)).toEqual([
      existingSessionGroup.id,
      projectKey({ profileId: "p2", project: "shared-lib" }),
      projectKey({ profileId: "p1", project: "shared-lib" }),
    ]);
  });

  it("maintains cross-profile isolation for identical project names", () => {
    const openRefs: OpenWorkspaceRef[] = [
      { profileId: "p1", project: "shared-lib" },
      { profileId: "p2", project: "shared-lib" },
    ];
    const inventory = [inventoryItem2, inventoryItemCrossProfile];

    const result = unionOpenWorkspaceGroups([], openRefs, inventory);

    expect(result).toHaveLength(2);
    expect(result[0].profileId).toBe("p1");
    expect(result[0].profileName).toBe("Profile One");
    expect(result[1].profileId).toBe("p2");
    expect(result[1].profileName).toBe("Profile Two");
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("canDismissWorkspace is true ONLY for zero-terminal groups", () => {
    const zeroTerminalGroup: Pick<TraditionalTerminalProjectGroup, "terminalTabs"> = {
      terminalTabs: [],
    };
    expect(canDismissWorkspace(zeroTerminalGroup)).toBe(true);

    const activeTerminalGroup: Pick<TraditionalTerminalProjectGroup, "terminalTabs"> = {
      terminalTabs: [{ sessionId: "term-1", label: "Shell" }],
    };
    expect(canDismissWorkspace(activeTerminalGroup)).toBe(false);
  });
});
