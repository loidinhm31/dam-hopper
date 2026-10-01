import { create } from "zustand";

export interface CognitoModeState {
  active: boolean;
  activationShortcut: string | null;
  toggle: (shortcut: string) => void;
  reset: () => void;
}

export const useCognitoModeStore = create<CognitoModeState>((set) => ({
  active: false,
  activationShortcut: null,
  toggle: (shortcut: string) => {
    set((state) => {
      if (state.active) {
        return { active: false, activationShortcut: null };
      }
      return { active: true, activationShortcut: shortcut };
    });
  },
  reset: () => {
    set({ active: false, activationShortcut: null });
  },
}));
