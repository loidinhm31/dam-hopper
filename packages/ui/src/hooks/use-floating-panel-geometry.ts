import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

export interface FloatingPanelFrame {
  width: number;
  height: number;
  top: number;
  left: number | null;
  isMaximized?: boolean;
}

interface UseFloatingPanelGeometryOptions<T extends FloatingPanelFrame> {
  initialLayout: T;
  clampLayout: (layout: T, bounds: { width: number; height: number }) => T;
  isMaximized?: boolean;
}

export function useFloatingPanelGeometry<T extends FloatingPanelFrame>({
  initialLayout,
  clampLayout,
}: UseFloatingPanelGeometryOptions<T>) {
  const boundsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<T>(initialLayout);
  const lastUnmaximizedLayoutRef = useRef<T>(initialLayout);

  const getBounds = useCallback((): { width: number; height: number } => {
    const rect = boundsRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: 1024, height: 768 };
  }, []);

  const resolveCurrentFrame = () => {
    const bounds = boundsRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!bounds || !panel) return null;
    return {
      bounds,
      frame: {
        left: panel.left - bounds.left,
        top: panel.top - bounds.top,
        width: panel.width,
        height: panel.height,
      },
    };
  };

  const updateLayout = (
    nextLayout: T,
    bounds: { width: number; height: number },
  ) => {
    const clamped = clampLayout(nextLayout, bounds);
    setLayout(clamped);
    if (!clamped.isMaximized) {
      lastUnmaximizedLayoutRef.current = clamped;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("workspace:layout-change"));
    }
  };

  // Clamp on mount and re-clamp on window resize
  useEffect(() => {
    const bounds = getBounds();
    setLayout((prev) => clampLayout(prev, bounds));

    if (typeof window === "undefined") return;
    const onResize = () => {
      const currentBounds = getBounds();
      setLayout((prev) => clampLayout(prev, currentBounds));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampLayout, getBounds]);
  const handleDragStart = (event: ReactMouseEvent) => {
    if (event.button !== 0 || layout.isMaximized) return;
    const current = resolveCurrentFrame();
    if (!current) return;
    event.preventDefault();

    const { bounds, frame } = current;
    const startX = event.clientX;
    const startY = event.clientY;
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      updateLayout(
        {
          ...layout,
          width: frame.width,
          height: frame.height,
          top: frame.top + moveEvent.clientY - startY,
          left: frame.left + moveEvent.clientX - startX,
        },
        bounds,
      );
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const handleResizeStart = (event: ReactMouseEvent) => {
    if (event.button !== 0 || layout.isMaximized) return;
    const current = resolveCurrentFrame();
    if (!current) return;
    event.preventDefault();

    const { bounds, frame } = current;
    const startX = event.clientX;
    const startY = event.clientY;
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      updateLayout(
        {
          ...layout,
          width: frame.width + moveEvent.clientX - startX,
          height: frame.height + moveEvent.clientY - startY,
          top: frame.top,
          left: frame.left,
        },
        bounds,
      );
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const toggleMaximize = useCallback(() => {
    const bounds = getBounds();
    setLayout((prev) => {
      if (prev.isMaximized) {
        // Restore prior unmaximized layout
        const prior = lastUnmaximizedLayoutRef.current;
        return clampLayout({ ...prior, isMaximized: false }, bounds);
      }
      // Save current layout before maximizing
      lastUnmaximizedLayoutRef.current = prev;
      return clampLayout({ ...prev, isMaximized: true }, bounds);
    });
  }, [clampLayout, getBounds]);

  return {
    boundsRef,
    panelRef,
    layout,
    setLayout,
    handleDragStart,
    handleResizeStart,
    toggleMaximize,
  };
}
