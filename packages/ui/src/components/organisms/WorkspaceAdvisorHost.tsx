import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ProjectRef } from "@/api/client.js";
import type { ProjectTargetSnapshot } from "@/stores/project-target.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import { APP_ZOOM_CHANGE_EVENT } from "@/lib/app-zoom.js";
import { cn } from "@/lib/utils.js";
import {
  measureAdvisorSlotGeometry,
  type AdvisorSlotGeometry,
} from "@/lib/workspace-advisor-placement.js";
import { useWorkspaceAdvisorPlacement } from "@/contexts/WorkspaceAdvisorContext.js";
import { AdvisorPanel } from "@/advisor/AdvisorPanel.js";
export interface WorkspaceAdvisorHostProps {
  project?: ProjectRef | null;
  projectTarget?: ProjectTargetSnapshot | null;
  connection?: ConnectionSnapshot | null;
  className?: string;
}

export function WorkspaceAdvisorHost({
  project: _project = null,
  projectTarget = null,
  connection = null,
  className,
}: WorkspaceAdvisorHostProps) {
  const placement = useWorkspaceAdvisorPlacement();
  const activeSlot = placement?.activeSlot ?? null;
  const [geometry, setGeometry] = useState<AdvisorSlotGeometry | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasVisibleRef = useRef(false);

  useLayoutEffect(() => {
    if (!activeSlot || !activeSlot.element || !activeSlot.visible) {
      setGeometry((prev) => (prev !== null ? null : prev));
      return;
    }

    const element = activeSlot.element;
    let rafId: number | null = null;

    const measure = () => {
      const geo = measureAdvisorSlotGeometry(activeSlot);
      setGeometry(geo);
    };

    const scheduleMeasure = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measure();
      });
    };

    measure();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleMeasure)
        : null;

    observer?.observe(element);

    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, { capture: true, passive: true });
    window.addEventListener(APP_ZOOM_CHANGE_EVENT, scheduleMeasure);
    window.addEventListener("workspace:layout-change", scheduleMeasure);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      observer?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      window.removeEventListener(APP_ZOOM_CHANGE_EVENT, scheduleMeasure);
      window.removeEventListener("workspace:layout-change", scheduleMeasure);
    };
  }, [
    activeSlot?.element,
    activeSlot?.id,
    activeSlot?.mode,
    activeSlot?.visible,
    activeSlot?.zIndex,
  ]);

  const isVisible = geometry !== null;

  // Focus restoration when transitioning from visible to hidden
  useEffect(() => {
    if (wasVisibleRef.current && !isVisible) {
      const container = containerRef.current;
      const activeEl = document.activeElement;
      if (
        container &&
        (container === activeEl || container.contains(activeEl))
      ) {
        if (placement?.launcherRef.current?.isConnected) {
          placement.launcherRef.current.focus();
        } else if (activeEl instanceof HTMLElement) {
          activeEl.blur();
        }
      }
    }
    wasVisibleRef.current = isVisible;
  }, [isVisible, placement?.launcherRef]);

  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      placement?.onClose?.();
    }
  };
  const handleFocusCapture = () => {
    activeSlot?.onActivate?.();
  };

  return (
    <div
      ref={containerRef}
      data-testid="workspace-advisor-host"
      data-advisor-visible={isVisible ? "true" : "false"}
      data-advisor-mode={geometry?.mode}
      inert={!isVisible}
      aria-hidden={!isVisible}
      onKeyDownCapture={handleKeyDownCapture}
      onFocusCapture={handleFocusCapture}
      style={{
        position: "fixed",
        visibility: isVisible ? "visible" : "hidden",
        pointerEvents: isVisible ? "auto" : "none",
        top: geometry?.top ?? -10000,
        left: geometry?.left ?? -10000,
        width: geometry?.width ?? 0,
        height: geometry?.height ?? 0,
        zIndex: geometry?.zIndex ?? 15,
        overflow: "hidden",
      }}
      className={cn("workspace-advisor-host-container", className)}
    >
      <AdvisorPanel
        connection={connection}
        projectTarget={projectTarget}
        isVisible={isVisible}
        className="workspace-advisor-host-content h-full w-full min-h-0 flex-1 overflow-hidden"
      />
    </div>
  );
}
