export const COMPACT_WORKSPACE_MAX_WIDTH = 1280;
export const COMPACT_WORKSPACE_QUERY = `(max-width: ${COMPACT_WORKSPACE_MAX_WIDTH}px)`;

interface LegacyCompactWorkspaceMediaQuery {
  matches: boolean;
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
}

interface CompactWorkspaceMediaQuery extends LegacyCompactWorkspaceMediaQuery {
  addEventListener?: (
    type: "change",
    listener: (event: MediaQueryListEvent) => void,
  ) => void;
  removeEventListener?: (
    type: "change",
    listener: (event: MediaQueryListEvent) => void,
  ) => void;
}

interface CompactWorkspaceTarget {
  matchMedia?: (query: string) => CompactWorkspaceMediaQuery;
}

function getCompactWorkspaceMediaQuery(
  target: CompactWorkspaceTarget | undefined = typeof window === "undefined"
    ? undefined
    : window,
) {
  if (!target?.matchMedia) {
    return null;
  }
  return target.matchMedia(COMPACT_WORKSPACE_QUERY);
}

export function readCompactWorkspaceMatch(target?: CompactWorkspaceTarget) {
  const mediaQuery = getCompactWorkspaceMediaQuery(target);
  if (!mediaQuery) {
    return false;
  }
  return mediaQuery.matches;
}

export function subscribeToCompactWorkspace(
  onChange: (matches: boolean) => void,
  target?: CompactWorkspaceTarget,
) {
  const mediaQuery = getCompactWorkspaceMediaQuery(target);
  if (!mediaQuery) {
    return () => {};
  }

  const handleChange = (event: MediaQueryListEvent) => {
    onChange(event.matches);
  };

  onChange(mediaQuery.matches);

  if (mediaQuery.addEventListener && mediaQuery.removeEventListener) {
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener?.("change", handleChange);
  }

  mediaQuery.addListener?.(handleChange);
  return () => mediaQuery.removeListener?.(handleChange);
}
