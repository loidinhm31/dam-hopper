import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "@/api/client.js";

export function explorerTreeScopeKey(target: ProjectTargetInput): string {
  const normalized = normalizeProjectTarget(target);
  return `${normalized.project}::${projectTargetCacheKey(normalized)}`;
}

export type OpenStateMap = Record<string, boolean>;

export interface ExplorerTreeState {
  openMapByTarget: Record<string, OpenStateMap>;
  setFolderOpen: (scopeKey: string, path: string, isOpen: boolean) => void;
  prunePath: (scopeKey: string, path: string) => void;
  renamePath: (scopeKey: string, oldPath: string, newPath: string) => void;
  clearTarget: (scopeKey: string) => void;
}

export const useExplorerTreeStore = create<ExplorerTreeState>()(
  persist(
    (set) => ({
      openMapByTarget: {},
      setFolderOpen: (scopeKey, path, isOpen) => {
        if (!scopeKey || !path) return;
        set((state) => {
          const currentTargetMap = state.openMapByTarget[scopeKey] ?? {};
          const currentVal = Boolean(currentTargetMap[path]);
          if (currentVal === isOpen) {
            return state;
          }
          const nextTargetMap = { ...currentTargetMap };
          if (isOpen) {
            nextTargetMap[path] = true;
          } else {
            delete nextTargetMap[path];
          }
          return {
            openMapByTarget: {
              ...state.openMapByTarget,
              [scopeKey]: nextTargetMap,
            },
          };
        });
      },
      prunePath: (scopeKey, path) => {
        if (!scopeKey || !path) return;
        set((state) => {
          const currentTargetMap = state.openMapByTarget[scopeKey];
          if (!currentTargetMap) return state;

          const prefix = `${path}/`;
          let changed = false;
          const nextTargetMap: OpenStateMap = {};

          for (const [key, value] of Object.entries(currentTargetMap)) {
            if (key === path || key.startsWith(prefix)) {
              changed = true;
            } else {
              nextTargetMap[key] = value;
            }
          }

          if (!changed) return state;

          return {
            openMapByTarget: {
              ...state.openMapByTarget,
              [scopeKey]: nextTargetMap,
            },
          };
        });
      },
      renamePath: (scopeKey, oldPath, newPath) => {
        if (!scopeKey || !oldPath || !newPath || oldPath === newPath) return;
        set((state) => {
          const currentTargetMap = state.openMapByTarget[scopeKey];
          if (!currentTargetMap) return state;

          const prefix = `${oldPath}/`;
          let changed = false;
          const nextTargetMap: OpenStateMap = {};

          for (const [key, value] of Object.entries(currentTargetMap)) {
            if (key === oldPath) {
              changed = true;
              nextTargetMap[newPath] = value;
            } else if (key.startsWith(prefix)) {
              changed = true;
              const suffix = key.slice(prefix.length);
              nextTargetMap[`${newPath}/${suffix}`] = value;
            } else {
              nextTargetMap[key] = value;
            }
          }

          if (!changed) return state;

          return {
            openMapByTarget: {
              ...state.openMapByTarget,
              [scopeKey]: nextTargetMap,
            },
          };
        });
      },
      clearTarget: (scopeKey) => {
        if (!scopeKey) return;
        set((state) => {
          if (!state.openMapByTarget[scopeKey]) return state;
          const next = { ...state.openMapByTarget };
          delete next[scopeKey];
          return { openMapByTarget: next };
        });
      },
    }),
    {
      name: "dam-hopper:explorer-tree-state",
    },
  ),
);
