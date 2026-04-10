import { useState, useDeferredValue } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/api/transport.js";
import type { SearchResponse } from "@/api/fs-types.js";

export function useFileSearch(project: string | null) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const MAX_QUERY_LEN = 200;
  const trimmedQuery = deferredQuery.slice(0, MAX_QUERY_LEN);

  const { data, isLoading, isError } = useQuery<SearchResponse>({
    queryKey: ["fs-search", project, trimmedQuery, caseSensitive],
    queryFn: () =>
      getTransport().invoke("fs:search", {
        project,
        q: trimmedQuery,
        case: caseSensitive || undefined,
      }) as Promise<SearchResponse>,
    enabled: !!project && trimmedQuery.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return { query, setQuery, caseSensitive, setCaseSensitive, data, isLoading, isError };
}
