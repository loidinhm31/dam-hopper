import { useState, useEffect, useRef } from "react";
import type { SearchResult } from "@/api/client.js";

export function useCommandSearch(projectType?: string) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    setResults([]);
    if (!query.trim()) return;

    timerRef.current = setTimeout(() => {
      window.devhub.commands
        .search(query, projectType, 8)
        .then(setResults)
        .catch(() => setResults([]));
    }, 150);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, projectType]);

  return { query, setQuery, results };
}
