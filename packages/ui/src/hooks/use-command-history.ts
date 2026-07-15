import { useCallback } from "react";
import {
  searchHistory,
  type HistorySearchResult,
} from "@/lib/command-history.js";

export function useCommandHistory() {
  const search = useCallback(
    (query: string, limit?: number): HistorySearchResult[] =>
      searchHistory(query, limit),
    [],
  );

  return { search };
}
