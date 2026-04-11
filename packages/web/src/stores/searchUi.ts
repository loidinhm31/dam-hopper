import { create } from "zustand";

export type SearchScope = "project" | "workspace";

interface SearchUiState {
  open: boolean;
  initialQuery: string;
  scope: SearchScope;
  openWith: (query?: string) => void;
  setScope: (scope: SearchScope) => void;
  consumeInitialQuery: () => string;
  close: () => void;
}

export const useSearchUiStore = create<SearchUiState>((set, get) => ({
  open: false,
  initialQuery: "",
  scope: "project",
  openWith: (query = "") => set({ open: true, initialQuery: query }),
  setScope: (scope) => set({ scope }),
  consumeInitialQuery: () => {
    const q = get().initialQuery;
    if (q) set({ initialQuery: "" });
    return q;
  },
  close: () => set({ open: false, initialQuery: "" }),
}));
