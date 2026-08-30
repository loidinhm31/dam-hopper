import { useState, useRef, useEffect } from "react";
import type React from "react";

interface UseResizeHandleOptions {
  min: number;
  max: number;
  defaultWidth: number;
  storageKey?: string;
  /** When true, expose keyboard controls on the returned handle. */
  keyboardResizeEnabled?: boolean;
  /** When true, dragging left increases width (right-side panels) */
  reversed?: boolean;
  onResizeEnd?: () => void;
}

interface UseResizeHandleReturn {
  width: number;
  handleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
    tabIndex?: 0;
  };
  isDragging: boolean;
}

export function useResizeHandle({
  min,
  max,
  defaultWidth,
  storageKey,
  reversed = false,
  keyboardResizeEnabled = false,
  onResizeEnd,
}: UseResizeHandleOptions): UseResizeHandleReturn {
  const [width, setWidth] = useState<number>(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) return Math.min(Math.max(parsed, min), max);
      }
    }
    return defaultWidth;
  });

  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    return () => {
      document.body.classList.remove("cursor-col-resize", "select-none");
    };
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    startX.current = e.clientX;
    startWidth.current = width;
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(ev: MouseEvent) {
      const delta = ev.clientX - startX.current;
      const newWidth = Math.min(
        Math.max(startWidth.current + (reversed ? -delta : delta), min),
        max,
      );
      setWidth(newWidth);
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsDragging(false);
      setWidth((w) => {
        if (storageKey) localStorage.setItem(storageKey, String(w));
        return w;
      });
      onResizeEnd?.();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    const step = e.shiftKey ? 32 : 16;
    let nextWidth: number;
    if (e.key === "Home") {
      nextWidth = min;
    } else if (e.key === "End") {
      nextWidth = max;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const delta = e.key === "ArrowRight" ? step : -step;
      nextWidth = Math.min(
        Math.max(width + (reversed ? -delta : delta), min),
        max,
      );
    } else {
      return;
    }
    e.preventDefault();
    if (nextWidth === width) return;
    setWidth(nextWidth);
    if (storageKey) localStorage.setItem(storageKey, String(nextWidth));
    onResizeEnd?.();
  }

  return {
    width,
    handleProps: {
      onMouseDown,
      ...(keyboardResizeEnabled ? { onKeyDown, tabIndex: 0 as const } : {}),
    },
    isDragging,
  };
}
