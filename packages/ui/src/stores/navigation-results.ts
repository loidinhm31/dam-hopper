import { create } from "zustand";
import type {
  SemanticDescriptorAvailability,
  SemanticNavigationTarget,
  SemanticOperation,
} from "@dam-hopper/shared";

export type NavigationResultState =
  | { kind: "idle" }
  | { kind: "loading"; requestId: string; operation: SemanticOperation }
  | {
      kind: "targets";
      targets: SemanticNavigationTarget[];
      capped: boolean;
      operation: SemanticOperation;
    }
  | { kind: "empty"; operation: SemanticOperation }
  | {
      kind: "unavailable";
      availability?: SemanticDescriptorAvailability;
      operation: SemanticOperation;
    }
  | { kind: "stale"; operation: SemanticOperation };

interface NavigationResultsStore {
  state: NavigationResultState;
  requestKey: string | null;
  set: (state: NavigationResultState, requestKey?: string) => void;
  clear: () => void;
  clearRequest: (requestKey: string) => void;
}

export const useNavigationResultsStore = create<NavigationResultsStore>(
  (set) => ({
    state: { kind: "idle" },
    requestKey: null,
    set: (state, requestKey) =>
      set((current) => {
        if (
          requestKey &&
          current.requestKey &&
          requestKey < current.requestKey
        ) {
          return current;
        }
        return { state, requestKey: requestKey ?? current.requestKey };
      }),
    clear: () => set({ state: { kind: "idle" }, requestKey: null }),
    clearRequest: (requestKey) =>
      set((current) =>
        current.requestKey === requestKey
          ? { state: { kind: "idle" }, requestKey: null }
          : current,
      ),
  }),
);
