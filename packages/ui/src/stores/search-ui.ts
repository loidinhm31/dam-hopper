import { create } from "zustand";

export type SearchScope = "project" | "workspace";
export type SearchMode = "content" | "filename";

type SearchQueries = Record<SearchMode, string>;

interface SearchUiState {
  open: boolean;
  mode: SearchMode;
  queries: SearchQueries;
  selectOnOpen: boolean;
  scope: SearchScope;
  openWith: (mode?: SearchMode, query?: string) => void;
  setMode: (mode: SearchMode) => void;
  setQuery: (mode: SearchMode, query: string) => void;
  setScope: (scope: SearchScope) => void;
  consumeSelectOnOpen: () => boolean;
  close: () => void;
}

export const useSearchUiStore = create<SearchUiState>((set, get) => ({
  open: false,
  mode: "content",
  queries: {
    content: "",
    filename: "",
  },
  selectOnOpen: false,
  scope: "project",
  openWith: (mode = "content", query) =>
    set((state) => ({
      open: true,
      mode,
      selectOnOpen: true,
      queries:
        query === undefined
          ? state.queries
          : { ...state.queries, [mode]: query },
    })),
  setMode: (mode) => set({ mode, selectOnOpen: true }),
  setQuery: (mode, query) =>
    set((state) => ({ queries: { ...state.queries, [mode]: query } })),
  setScope: (scope) => set({ scope }),
  consumeSelectOnOpen: () => {
    const shouldSelect = get().selectOnOpen;
    if (shouldSelect) set({ selectOnOpen: false });
    return shouldSelect;
  },
  close: () => set({ open: false }),
}));
