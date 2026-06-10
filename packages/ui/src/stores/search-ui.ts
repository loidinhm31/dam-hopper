import { create } from "zustand";

export type SearchScope = "project" | "workspace";
export type SearchMode = "content" | "filename";

type SearchQueries = Record<SearchMode, string>;

interface SearchUiState {
  open: boolean;
  mode: SearchMode;
  queries: SearchQueries;
  replaceQuery: string;
  selectOnOpen: boolean;
  scope: SearchScope;
  openWith: (mode?: SearchMode, query?: string) => void;
  setMode: (mode: SearchMode) => void;
  setQuery: (mode: SearchMode, query: string) => void;
  setReplaceQuery: (query: string) => void;
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
  replaceQuery: "",
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
  setMode: (mode) =>
    set((state) => {
      if (state.mode === mode) {
        return { selectOnOpen: true };
      }

      const nextQuery =
        state.queries[mode].length > 0
          ? state.queries[mode]
          : state.queries[state.mode];

      return {
        mode,
        selectOnOpen: true,
        queries: { ...state.queries, [mode]: nextQuery },
      };
    }),
  setQuery: (mode, query) =>
    set((state) => ({ queries: { ...state.queries, [mode]: query } })),
  setReplaceQuery: (replaceQuery) => set({ replaceQuery }),
  setScope: (scope) => set({ scope }),
  consumeSelectOnOpen: () => {
    const shouldSelect = get().selectOnOpen;
    if (shouldSelect) set({ selectOnOpen: false });
    return shouldSelect;
  },
  close: () => set({ open: false }),
}));
