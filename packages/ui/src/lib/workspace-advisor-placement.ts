import type { UiIntent } from "@/plugins/bridge-validators.js";

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

  return {
    top: Math.round(rect.top),
    left: Math.round(rect.left),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    zIndex: resolvedZIndex,
    mode,
  };
}

export interface AdvisorPlacementState {
  activeSlot: AdvisorSlotDescriptor | null;
  activeGeometry: AdvisorSlotGeometry | null;
}
