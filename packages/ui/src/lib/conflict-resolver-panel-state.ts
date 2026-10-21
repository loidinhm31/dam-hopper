export interface ResolverPanelLayout {
  width: number;
  height: number;
  top: number;
  left: number | null;
  isMaximized: boolean;
}

export const RESOLVER_PANEL_DEFAULT_WIDTH = 1040;
export const RESOLVER_PANEL_DEFAULT_HEIGHT = 700;
export const RESOLVER_PANEL_MIN_WIDTH = 480;
export const RESOLVER_PANEL_MIN_HEIGHT = 360;
export const RESOLVER_PANEL_MARGIN = 12;
export const RESOLVER_PANEL_TOP_MARGIN = 56;

export const INITIAL_RESOLVER_PANEL_LAYOUT: ResolverPanelLayout = {
  width: RESOLVER_PANEL_DEFAULT_WIDTH,
  height: RESOLVER_PANEL_DEFAULT_HEIGHT,
  top: RESOLVER_PANEL_TOP_MARGIN,
  left: null,
  isMaximized: false,
};

export function clampResolverPanelLayout(
  layout: ResolverPanelLayout,
  bounds: { width: number; height: number },
): ResolverPanelLayout {
  const availableWidth = Math.max(100, bounds.width - RESOLVER_PANEL_MARGIN * 2);
  const availableHeight = Math.max(100, bounds.height - RESOLVER_PANEL_MARGIN * 2);
  const effectiveMinWidth = Math.min(RESOLVER_PANEL_MIN_WIDTH, availableWidth);
  const effectiveMinHeight = Math.min(RESOLVER_PANEL_MIN_HEIGHT, availableHeight);

  if (layout.isMaximized) {
    return {
      width: availableWidth,
      height: availableHeight,
      top: RESOLVER_PANEL_MARGIN,
      left: RESOLVER_PANEL_MARGIN,
      isMaximized: true,
    };
  }

  const width = Math.min(Math.max(effectiveMinWidth, layout.width), availableWidth);
  const height = Math.min(Math.max(effectiveMinHeight, layout.height), availableHeight);

  const maxTop = Math.max(RESOLVER_PANEL_MARGIN, bounds.height - height - RESOLVER_PANEL_MARGIN);
  const top = Math.min(Math.max(RESOLVER_PANEL_MARGIN, layout.top), maxTop);
  let left = layout.left;
  if (left !== null) {
    const maxLeft = Math.max(RESOLVER_PANEL_MARGIN, bounds.width - width - RESOLVER_PANEL_MARGIN);
    left = Math.min(Math.max(RESOLVER_PANEL_MARGIN, left), maxLeft);
  }

  return {
    width,
    height,
    top,
    left,
    isMaximized: false,
  };
}

export function handleResolverPanelKeyDown(
  event: Pick<KeyboardEvent, "key"> & {
    stopPropagation?: () => void;
    stopImmediatePropagation?: () => void;
    preventDefault?: () => void;
  },
  onHide: () => void,
  isTopmost = true,
): boolean {
  if (event.key !== "Escape" || !isTopmost) return false;
  event.stopImmediatePropagation?.();
  event.stopPropagation?.();
  event.preventDefault?.();
  onHide();
  return true;
}
