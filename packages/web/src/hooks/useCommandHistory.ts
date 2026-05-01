import { useCallback } from "react";
import {
  recordCommand,
  searchHistory,
  type HistorySearchResult,
} from "@/lib/command-history.js";

export function useCommandHistory() {
  const record = useCallback(
    (command: string, project?: string) => recordCommand(command, project),
    [],
  );

  const search = useCallback(
    (query: string, limit?: number): HistorySearchResult[] => searchHistory(query, limit),
    [],
  );

  return { record, search };
}
