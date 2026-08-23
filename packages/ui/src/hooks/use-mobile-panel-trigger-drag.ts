import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  clampMobilePanelTriggerPosition,
  resolveMobileSafeAreaInsets,
  type MobilePanelTriggerPosition,
  type MobileSafeAreaInsets,
} from "@/lib/mobile-panel-trigger-position.js";
import { getAppZoomFactor } from "@/lib/app-zoom.js";

interface TriggerDragState extends MobilePanelTriggerPosition {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  zoom: number;
  isDragging: boolean;
}

interface UseMobilePanelTriggerDragOptions {
  onDragStart: () => void;
  avoidTerminalAccessory: boolean;
}

interface UseMobilePanelTriggerDragReturn {
  triggerRef: RefObject<HTMLButtonElement | null>;
  triggerPosition: MobilePanelTriggerPosition | null;
  isDragging: boolean;
  handlePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  handlePointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  handlePointerEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  handleClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

const TRIGGER_DRAG_THRESHOLD = 6;

function logicalViewportSize(): { width: number; height: number } {
  const zoom = getAppZoomFactor();
  return {
    width: window.innerWidth / zoom,
    height: window.innerHeight / zoom,
  };
}

function logicalTriggerRect(trigger: HTMLElement, zoom: number) {
  const rect = trigger.getBoundingClientRect();
  return {
    left: rect.left / zoom,
    top: rect.top / zoom,
    width: rect.width / zoom,
    height: rect.height / zoom,
  };
}

export function useMobilePanelTriggerDrag({
  onDragStart,
  avoidTerminalAccessory,
}: UseMobilePanelTriggerDragOptions): UseMobilePanelTriggerDragReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [triggerPosition, setTriggerPosition] =
    useState<MobilePanelTriggerPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<TriggerDragState | null>(null);
  const suppressClickRef = useRef(false);
  const avoidTerminalAccessoryRef = useRef(avoidTerminalAccessory);
  const safeAreaRef = useRef<MobileSafeAreaInsets | null>(null);
  const bodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(
    null,
  );

  useEffect(() => {
    avoidTerminalAccessoryRef.current = avoidTerminalAccessory;
    setTriggerPosition((current) => {
      const trigger = triggerRef.current;
      if (!current || !trigger) return current;
      const zoom = getAppZoomFactor();
      const { width, height } = logicalTriggerRect(trigger, zoom);
      return clampMobilePanelTriggerPosition(
        current,
        { width, height },
        avoidTerminalAccessory,
        logicalViewportSize(),
        (safeAreaRef.current ??= resolveMobileSafeAreaInsets()),
      );
    });
  }, [avoidTerminalAccessory]);

  useEffect(() => {
    const handleResize = () => {
      safeAreaRef.current = null;
      setTriggerPosition((current) => {
        const trigger = triggerRef.current;
        if (!current || !trigger) return current;
        const zoom = getAppZoomFactor();
        const { width, height } = logicalTriggerRect(trigger, zoom);
        return clampMobilePanelTriggerPosition(
          current,
          { width, height },
          avoidTerminalAccessoryRef.current,
          logicalViewportSize(),
          (safeAreaRef.current ??= resolveMobileSafeAreaInsets()),
        );
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    return () => {
      dragRef.current = null;
      if (bodyStyleRef.current) {
        document.body.style.cursor = bodyStyleRef.current.cursor;
        document.body.style.userSelect = bodyStyleRef.current.userSelect;
      }
    };
  }, []);

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    if (event.button !== 0 || !event.isPrimary) return;

    const zoom = getAppZoomFactor();
    const { left, top, width, height } = logicalTriggerRect(
      event.currentTarget,
      zoom,
    );
    suppressClickRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX / zoom,
      startY: event.clientY / zoom,
      left,
      top,
      width,
      height,
      zoom,
      isDragging: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic browser tests and older WebViews may not expose an active pointer.
    }
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX / drag.zoom - drag.startX;
    const deltaY = event.clientY / drag.zoom - drag.startY;
    if (
      !drag.isDragging &&
      Math.hypot(deltaX, deltaY) < TRIGGER_DRAG_THRESHOLD
    ) {
      return;
    }

    if (!drag.isDragging) {
      drag.isDragging = true;
      suppressClickRef.current = true;
      setIsDragging(true);
      onDragStart();
      bodyStyleRef.current = {
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect,
      };
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }

    event.preventDefault();
    setTriggerPosition(
      clampMobilePanelTriggerPosition(
        { left: drag.left + deltaX, top: drag.top + deltaY },
        drag,
        avoidTerminalAccessoryRef.current,
        logicalViewportSize(),
        (safeAreaRef.current ??= resolveMobileSafeAreaInsets()),
      ),
    );
  };

  const handlePointerEnd = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.isDragging) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.type === "pointercancel") suppressClickRef.current = false;
    dragRef.current = null;
    setIsDragging(false);
    if (bodyStyleRef.current) {
      document.body.style.cursor = bodyStyleRef.current.cursor;
      document.body.style.userSelect = bodyStyleRef.current.userSelect;
      bodyStyleRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  };

  return {
    triggerRef,
    triggerPosition,
    isDragging,
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    handleClick,
  };
}
