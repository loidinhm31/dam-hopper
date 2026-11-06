import { projectKey, type ProjectRef } from "@/api/ownership.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { AggregatedProjectItem } from "@/hooks/use-aggregated-projects.js";
import type { TraditionalTerminalProjectGroup } from "./traditional-terminal-projects.js";

export interface OpenWorkspaceRef {
  readonly profileId: string;
  readonly project: string;
}

/**
 * Checks whether a traditional terminal project group can be dismissed.
 * Per AC4: dismissable only if it has zero active terminal tabs.
 */
export function canDismissWorkspace(
  group: Pick<TraditionalTerminalProjectGroup, "terminalTabs">,
): boolean {
  return group.terminalTabs.length === 0;
}

/**
 * Unions existing session groups with explicitly opened zero-terminal workspace refs.
 *
 * Requirements:
 * 1. Existing sessionGroups are preserved in their original order.
 * 2. openRefs are deduplicated against existing session groups and against earlier openRefs.
 * 3. Group id equals projectKey(ref) for layout key and selection stability.
 * 4. Refs absent from inventory are dropped.
 * 5. Hydrated groups have empty terminalTabs: [] and mountedSessions: [].
 * 6. Pure; inventory is passed in.
 */
export function unionOpenWorkspaceGroups<T extends TabEntry>(
  sessionGroups: readonly TraditionalTerminalProjectGroup<T>[],
  openRefs: readonly OpenWorkspaceRef[],
  inventory: readonly AggregatedProjectItem[],
): TraditionalTerminalProjectGroup<T>[] {
  const result: TraditionalTerminalProjectGroup<T>[] = [...sessionGroups];
  const seenGroupIds = new Set<string>();

  for (const group of sessionGroups) {
    seenGroupIds.add(group.id);
    if (group.projectRef) {
      seenGroupIds.add(projectKey(group.projectRef));
    }
  }

  // Pre-index inventory by projectKey
  const inventoryByProjectKey = new Map<string, AggregatedProjectItem>();
  for (const item of inventory) {
    if (item.ref) {
      inventoryByProjectKey.set(projectKey(item.ref), item);
    }
    // Also index with profileId and item.project.name if present
    if (item.profileId && item.project?.name) {
      const altKey = projectKey({
        profileId: item.profileId,
        project: item.project.name,
      });
      if (!inventoryByProjectKey.has(altKey)) {
        inventoryByProjectKey.set(altKey, item);
      }
    }
  }

  for (const ref of openRefs) {
    const key = projectKey(ref);
    if (seenGroupIds.has(key)) {
      continue;
    }
    seenGroupIds.add(key);

    const invItem = inventoryByProjectKey.get(key);
    if (!invItem) {
      // Ref is missing in inventory -> dropped
      continue;
    }

    const projectName = invItem.project?.name ?? ref.project;
    const projectRef: ProjectRef = {
      profileId: ref.profileId,
      project: ref.project,
    };

    const newGroup: TraditionalTerminalProjectGroup<T> = {
      id: key,
      projectName,
      projectRef,
      profileId: invItem.profileId ?? ref.profileId,
      profileName: invItem.profileName,
      label: projectName,
      terminalTabs: [],
      mountedSessions: [],
    };

    result.push(newGroup);
  }

  return result;
}
