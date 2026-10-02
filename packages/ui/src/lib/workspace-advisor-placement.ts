export type AdvisorSlotPlacementMode = "ide" | "terminal" | "compact";

export interface AdvisorSlotDescriptor {
  id: string;
  mode: AdvisorSlotPlacementMode;
  element: HTMLElement | null;
  visible: boolean;
  zIndex?: number;
  onActivate?: () => void;
}

export interface AdvisorSlotGeometry {
  top: number;
  left: number;
  width: number;
  height: number;
  zIndex: number;
  mode: AdvisorSlotPlacementMode;
}

export const ADVISOR_DEFAULT_Z_INDEX: Record<AdvisorSlotPlacementMode, number> = {
  ide: 15,
  terminal: 25,
  compact: 35,
};

export function measureAdvisorSlotGeometry(
  descriptor: AdvisorSlotDescriptor | null,
): AdvisorSlotGeometry | null {
  if (!descriptor || !descriptor.visible || !descriptor.element) {
    return null;
  }

  const { element, mode, zIndex } = descriptor;
  if (!element.isConnected) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const resolvedZIndex = zIndex ?? ADVISOR_DEFAULT_Z_INDEX[mode];

  const computed =
    typeof window !== "undefined" && typeof window.getComputedStyle === "function"
      ? window.getComputedStyle(element)
      : null;
  const paddingRight = computed ? parseFloat(computed.paddingRight) || 0 : 0;
  const paddingBottom = computed ? parseFloat(computed.paddingBottom) || 0 : 0;
  const paddingTop = computed ? parseFloat(computed.paddingTop) || 0 : 0;
  const paddingLeft = computed ? parseFloat(computed.paddingLeft) || 0 : 0;

  const width = Math.max(0, Math.round(rect.width - paddingLeft - paddingRight));
  const height = Math.max(0, Math.round(rect.height - paddingTop - paddingBottom));
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    top: Math.round(rect.top + paddingTop),
    left: Math.round(rect.left + paddingLeft),
    width,
    height,
    zIndex: resolvedZIndex,
    mode,
  };
}

export interface AdvisorPlacementState {
  activeSlot: AdvisorSlotDescriptor | null;
  activeGeometry: AdvisorSlotGeometry | null;
}
