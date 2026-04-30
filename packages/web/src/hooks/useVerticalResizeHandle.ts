import { useState, useRef, useEffect } from "react";
import type React from "react";

interface UseVerticalResizeHandleOptions {
  min: number;
  max: number;
  defaultHeight: number;
  storageKey?: string;
  /** When true, dragging up increases height (bottom-side panels) */
  reversed?: boolean;
}

interface UseVerticalResizeHandleReturn {
  height: number;
  handleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
  };
  isDragging: boolean;
}

export function useVerticalResizeHandle({
  min,
  max,
  defaultHeight,
  storageKey,
  reversed = false,
}: UseVerticalResizeHandleOptions): UseVerticalResizeHandleReturn {
  const [height, setHeight] = useState<number>(() => {
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) return Math.min(Math.max(parsed, min), max);
      }
    }
    return defaultHeight;
  });

  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  useEffect(() => {
    return () => {
      document.body.classList.remove("cursor-row-resize", "select-none");
    };
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    startY.current = e.clientY;
    startHeight.current = height;
    setIsDragging(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(ev: MouseEvent) {
      const delta = ev.clientY - startY.current;
      const newHeight = Math.min(Math.max(startHeight.current + (reversed ? -delta : delta), min), max);
      setHeight(newHeight);
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsDragging(false);
      setHeight((h) => {
        if (storageKey) localStorage.setItem(storageKey, String(h));
        return h;
      });
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  return { height, handleProps: { onMouseDown }, isDragging };
}
