import * as React from "react";
import { useEffect, useRef } from "react";
import type { BrowserStreamController } from "./stream-controller.js";

export interface CanvasViewProps {
  controller: BrowserStreamController | null;
  className?: string;
  children?: React.ReactNode;
  onCanvasPointerDown?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onCanvasPointerUp?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onCanvasPointerMove?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onCanvasPointerCancel?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onCanvasWheel?: (e: React.WheelEvent<HTMLCanvasElement>) => void;
  onCanvasContextMenu?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
}

export const CanvasView = React.forwardRef<HTMLCanvasElement, CanvasViewProps>(
  function CanvasView(
    {
      controller,
      className,
      children,
      onCanvasPointerDown,
      onCanvasPointerUp,
      onCanvasPointerMove,
      onCanvasPointerCancel,
      onCanvasWheel,
      onCanvasContextMenu,
    },
    forwardedRef,
  ) {
    const internalCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Merge forwarded ref and internal ref
    const setCanvasRef = (node: HTMLCanvasElement | null) => {
      internalCanvasRef.current = node;
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    };

    useEffect(() => {
      const container = containerRef.current;
      const canvas = internalCanvasRef.current;
      if (!container || !canvas) return;

      const handleResize = () => {
        const rect = container.getBoundingClientRect();
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
        const physicalWidth = Math.round(rect.width * dpr);
        const physicalHeight = Math.round(rect.height * dpr);

        if (
          canvas.width !== physicalWidth ||
          canvas.height !== physicalHeight
        ) {
          canvas.width = physicalWidth;
          canvas.height = physicalHeight;
          canvas.style.width = `${rect.width}px`;
          canvas.style.height = `${rect.height}px`;

          controller?.redrawCachedFrame();
        }
      };

      handleResize();

      let observer: ResizeObserver | null = null;
      if (typeof ResizeObserver === "function") {
        observer = new ResizeObserver(() => {
          handleResize();
        });
        observer.observe(container);
      }

      return () => {
        if (observer) {
          observer.disconnect();
        }
      };
    }, [controller]);

    return (
      <div
        ref={containerRef}
        className={`relative w-full h-full overflow-hidden bg-black select-none flex items-center justify-center ${className ?? ""}`}
        tabIndex={-1}
      >
        <canvas
          ref={setCanvasRef}
          className="absolute inset-0 w-full h-full touch-none"
          onPointerDown={(event) => {
            // Preserve the consumer's text proxy focus: the native mouse-down default
            // otherwise focuses this canvas's tabindex-bearing ancestor instead.
            event.preventDefault();
            onCanvasPointerDown?.(event);
          }}
          onPointerUp={onCanvasPointerUp}
          onPointerMove={onCanvasPointerMove}
          onPointerCancel={onCanvasPointerCancel}
          onWheel={onCanvasWheel}
          onContextMenu={onCanvasContextMenu}
        />
        {children}
      </div>
    );
  },
);
