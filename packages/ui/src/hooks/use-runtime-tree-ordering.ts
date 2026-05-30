import { useCallback, useMemo } from "react";
import { useGlobalConfig, useUpdateUiConfig } from "@/api/queries.js";
import type { UiConfig } from "@/api/client.js";
import {
  reorderRuntimeIds,
  type RuntimeTreeGroup,
} from "@/lib/terminal-runtime-tree.js";
import { withUiConfigDefaults } from "@/lib/ui-config.js";

export function moveRuntimeGroupOrder(
  groups: RuntimeTreeGroup[],
  draggedId: string,
  targetId: string,
) {
  return reorderRuntimeIds(
    groups.map((group) => group.id),
    draggedId,
    targetId,
  );
}

export function moveRuntimeItemOrder(
  groups: RuntimeTreeGroup[],
  runtimeItemOrder: Record<string, string[]>,
  groupId: string,
  draggedId: string,
  targetId: string,
) {
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) return null;
  const nextGroupOrder = reorderRuntimeIds(
    group.items.map((item) => item.id),
    draggedId,
    targetId,
  );
  if (!nextGroupOrder) return null;
  return { ...runtimeItemOrder, [groupId]: nextGroupOrder };
}

export function useRuntimeTreeOrdering(groups: RuntimeTreeGroup[]) {
  const { data: globalConfig } = useGlobalConfig();
  const updateUi = useUpdateUiConfig();
  const uiConfig = useMemo(
    () => withUiConfigDefaults(globalConfig?.ui),
    [globalConfig?.ui],
  );

  const persistUi = useCallback(
    (patch: Partial<UiConfig>) => {
      updateUi.mutate({ ...uiConfig, ...patch });
    },
    [uiConfig, updateUi],
  );

  const moveGroup = useCallback(
    (draggedId: string, targetId: string) => {
      const next = moveRuntimeGroupOrder(groups, draggedId, targetId);
      if (next) persistUi({ runtimeGroupOrder: next });
    },
    [groups, persistUi],
  );

  const moveItem = useCallback(
    (groupId: string, draggedId: string, targetId: string) => {
      const next = moveRuntimeItemOrder(
        groups,
        uiConfig.runtimeItemOrder ?? {},
        groupId,
        draggedId,
        targetId,
      );
      if (next) persistUi({ runtimeItemOrder: next });
    },
    [groups, persistUi, uiConfig.runtimeItemOrder],
  );

  return { uiConfig, moveGroup, moveItem };
}
