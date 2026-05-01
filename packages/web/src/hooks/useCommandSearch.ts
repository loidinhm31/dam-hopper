import { useState, useEffect, useRef } from "react";
import type { CombinedSearchResult } from "@/api/client.js";
import { api } from "@/api/client.js";
import { useCommandHistory } from "@/hooks/useCommandHistory.js";

const PROJECT_BOOST = 1.5;

export function useCommandSearch(projectType?: string, projectName?: string) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CombinedSearchResult[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { search: searchHistory } = useCommandHistory();

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!query.trim()) {
      setResults([]);
      return;
    }

    // History: synchronous, set immediately (no debounce)
    const histRaw = searchHistory(query, 5);
    const histResults: CombinedSearchResult[] = histRaw.map((r) => ({
      source: "history" as const,
      command: {
        name: r.entry.command,
        command: r.entry.command,
        description: "",
        tags: [],
      },
      score:
        projectName && r.entry.project === projectName
          ? r.score * PROJECT_BOOST
          : r.score,
      historyEntry: r.entry,
    }));

    histResults.sort((a, b) => b.score - a.score);

    // Catalog: debounced, merges after fetch
    timerRef.current = setTimeout(() => {
      api.commands
        .search(query, projectType, 8)
        .then((catalogRaw) => {
          const histCommands = new Set(histResults.map((r) => r.command.command));
          const catResults: CombinedSearchResult[] = catalogRaw
            .filter((r) => !histCommands.has(r.command.command))
            .map((r) => ({
              source: "catalog" as const,
              command: r.command,
              score: r.score,
              projectType: r.projectType,
            }));
          setResults([...histResults, ...catResults]);
        })
        .catch(() => setResults(histResults));
    }, 150);

    // Show history immediately while catalog is loading
    setResults(histResults);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, projectType, projectName, searchHistory]);

  return { query, setQuery, results };
}
