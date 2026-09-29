import { useId, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils.js";
import type { AdvisorSlotPlacementMode } from "@/lib/workspace-advisor-placement.js";
import { useWorkspaceAdvisorPlacement } from "@/contexts/WorkspaceAdvisorContext.js";

export interface AdvisorPanelSlotProps {
  mode: AdvisorSlotPlacementMode;
  className?: string;
  zIndex?: number;
  visible?: boolean;
  onActivate?: () => void;
}

export function AdvisorPanelSlot({
  mode,
  className,
  zIndex,
  visible = true,
  onActivate,
}: AdvisorPanelSlotProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const placement = useWorkspaceAdvisorPlacement();
  const registerSlot = placement?.registerSlot;
  const id = useId();

  useLayoutEffect(() => {
    if (!registerSlot) return;
    const element = elementRef.current;
    const unregister = registerSlot({
      id,
      mode,
      element,
      visible,
      zIndex,
      onActivate,
    });
    return () => {
      unregister();
    };
  }, [id, mode, registerSlot, visible, zIndex, onActivate]);

  return (
    <div
      ref={elementRef}
      data-testid={`advisor-panel-slot-${mode}`}
      data-advisor-slot-mode={mode}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
      className={cn(
        "relative flex h-full min-h-0 w-full flex-1 overflow-hidden",
        mode === "terminal" && "pb-8 pr-8",
        className,
      )}
    />
  );
}
