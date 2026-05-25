import { useEffect, useState } from "react";

export const COMPACT_WORKSPACE_MAX_WIDTH = 1023;
const COMPACT_WORKSPACE_QUERY = `(max-width: ${COMPACT_WORKSPACE_MAX_WIDTH}px)`;

function readCompactWorkspaceMatch() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia(COMPACT_WORKSPACE_QUERY).matches;
}

export function useCompactWorkspace() {
  const [isCompactWorkspace, setIsCompactWorkspace] = useState(
    readCompactWorkspaceMatch,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia(COMPACT_WORKSPACE_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsCompactWorkspace(event.matches);
    };

    setIsCompactWorkspace(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return isCompactWorkspace;
}
