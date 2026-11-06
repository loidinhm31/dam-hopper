import { create } from "zustand";
import {
  type TerminalTarget,
  terminalTargetKey,
} from "@/api/terminal-session-contract.js";

export interface HubTerminalMount {
  readonly logicalKey: string;
  readonly target: TerminalTarget;
  readonly project: string;
  readonly command: string;
  readonly cwd?: string;
  readonly worktreePath?: string;
}

export interface HubTerminalMountsState {
  readonly mountsByHub: Readonly<Record<string, readonly HubTerminalMount[]>>;
  publish(hubWindowId: string, mounts: readonly HubTerminalMount[]): void;
  clear(hubWindowId: string): void;
}

function areMountsEqual(
  existing: readonly HubTerminalMount[] | undefined,
  incoming: readonly HubTerminalMount[],
): boolean {
  if (!existing) return false;
  if (existing === incoming) return true;
  if (existing.length !== incoming.length) return false;

  for (let i = 0; i < incoming.length; i++) {
    const a = existing[i];
    const b = incoming[i];
    if (
      a.logicalKey !== b.logicalKey ||
      a.project !== b.project ||
      a.command !== b.command ||
      a.cwd !== b.cwd ||
      a.worktreePath !== b.worktreePath ||
      terminalTargetKey(a.target) !== terminalTargetKey(b.target)
    ) {
      return false;
    }
  }
  return true;
}

export const useHubTerminalMountsStore = create<HubTerminalMountsState>()(
  (set) => ({
    mountsByHub: {},

    publish: (hubWindowId, mounts) => {
      set((state) => {
        const existing = state.mountsByHub[hubWindowId];
        if (areMountsEqual(existing, mounts)) {
          return state;
        }
        return {
          mountsByHub: {
            ...state.mountsByHub,
            [hubWindowId]: mounts,
          },
        };
      });
    },

    clear: (hubWindowId) => {
      set((state) => {
        if (!(hubWindowId in state.mountsByHub)) {
          return state;
        }
        const next = { ...state.mountsByHub };
        delete next[hubWindowId];
        return {
          mountsByHub: next,
        };
      });
    },
  }),
);
