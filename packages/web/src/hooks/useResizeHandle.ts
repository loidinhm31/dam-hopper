import { useState, useRef, useEffect } from "react";
import type React from "react";

interface UseResizeHandleOptions {
  min: number;
  max: number;
  defaultWidth: number;
  storageKey?: string;
}

interface UseResizeHandleReturn {
  width: number;
  handleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
  };
  isDragging: boolean;
}

export function useResizeHandle({
  min,
  max,
  defaultWidth,
  storageKey,
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
      const newWidth = Math.min(Math.max(startWidth.current + (ev.clientX - startX.current), min), max);
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
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  return { width, handleProps: { onMouseDown }, isDragging };
}
