import { useState, useDeferredValue } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/api/transport.js";
import type { SearchResponse } from "@/api/fs-types.js";
import type { SearchScope } from "@/stores/searchUi.js";

export function useFileSearch(project: string | null, scope: SearchScope = "project") {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const MAX_QUERY_LEN = 200;
  const trimmedQuery = deferredQuery.slice(0, MAX_QUERY_LEN);
  const isWorkspace = scope === "workspace";

  const { data, isLoading, isError } = useQuery<SearchResponse>({
    queryKey: ["fs-search", isWorkspace ? "__workspace__" : project, trimmedQuery, caseSensitive, scope],
    queryFn: () =>
      getTransport().invoke("fs:search", {
        ...(isWorkspace ? {} : { project }),
        q: trimmedQuery,
        case: caseSensitive || undefined,
        scope: isWorkspace ? "workspace" : undefined,
      }) as Promise<SearchResponse>,
    enabled: (isWorkspace || !!project) && trimmedQuery.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return { query, setQuery, caseSensitive, setCaseSensitive, data, isLoading, isError };
}
