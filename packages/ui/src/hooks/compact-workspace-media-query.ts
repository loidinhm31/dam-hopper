import {
  DEFAULT_APP_ZOOM_LEVEL,
  type AppZoomLevel,
} from "@/lib/app-zoom.js";

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
  innerWidth?: number;
  addEventListener?: (type: "resize", listener: EventListener) => void;
  removeEventListener?: (type: "resize", listener: EventListener) => void;
}

function getCompactWorkspaceTarget(
  target: CompactWorkspaceTarget | undefined = typeof window === "undefined"
    ? undefined
    : window,
) {
  return target;
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

export function getCompactWorkspaceEffectiveWidth(
  target: CompactWorkspaceTarget | undefined,
  appZoomLevel: AppZoomLevel = DEFAULT_APP_ZOOM_LEVEL,
): number | null {
  const resolvedTarget = getCompactWorkspaceTarget(target);
  if (
    typeof resolvedTarget?.innerWidth !== "number" ||
    !Number.isFinite(resolvedTarget.innerWidth) ||
    resolvedTarget.innerWidth < 0
  ) {
    return null;
  }

  return resolvedTarget.innerWidth / (appZoomLevel / 100);
}

export function readCompactWorkspaceMatch(
  target?: CompactWorkspaceTarget,
  appZoomLevel: AppZoomLevel = DEFAULT_APP_ZOOM_LEVEL,
) {
  const resolvedTarget = getCompactWorkspaceTarget(target);
  const mediaQuery = getCompactWorkspaceMediaQuery(resolvedTarget);
  if (!mediaQuery) {
    return false;
  }

  const effectiveWidth = getCompactWorkspaceEffectiveWidth(
    resolvedTarget,
    appZoomLevel,
  );
  return effectiveWidth === null
    ? mediaQuery.matches
    : effectiveWidth <= COMPACT_WORKSPACE_MAX_WIDTH;
}

export function subscribeToCompactWorkspace(
  onChange: (matches: boolean) => void,
  target?: CompactWorkspaceTarget,
  appZoomLevel: AppZoomLevel = DEFAULT_APP_ZOOM_LEVEL,
) {
  const resolvedTarget = getCompactWorkspaceTarget(target);
  const mediaQuery = getCompactWorkspaceMediaQuery(resolvedTarget);
  if (!mediaQuery) {
    return () => {};
  }

  const handleChange = (event: MediaQueryListEvent) => {
    const effectiveWidth = getCompactWorkspaceEffectiveWidth(
      resolvedTarget,
      appZoomLevel,
    );
    onChange(
      effectiveWidth === null
        ? event.matches
        : effectiveWidth <= COMPACT_WORKSPACE_MAX_WIDTH,
    );
  };
  const handleResize: EventListener = () => {
    onChange(readCompactWorkspaceMatch(resolvedTarget, appZoomLevel));
  };

  onChange(readCompactWorkspaceMatch(resolvedTarget, appZoomLevel));

  const resizeTarget =
    resolvedTarget?.addEventListener && resolvedTarget.removeEventListener
      ? resolvedTarget
      : null;
  resizeTarget?.addEventListener?.("resize", handleResize);

  if (mediaQuery.addEventListener && mediaQuery.removeEventListener) {
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener?.("change", handleChange);
      resizeTarget?.removeEventListener?.("resize", handleResize);
    };
  }

  mediaQuery.addListener?.(handleChange);
  return () => {
    mediaQuery.removeListener?.(handleChange);
    resizeTarget?.removeEventListener?.("resize", handleResize);
  };
}
