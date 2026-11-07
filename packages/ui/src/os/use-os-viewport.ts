import { useEffect, useState, type RefObject } from "react";
import { useWindowStore } from "./window-store.js";

export interface OsViewportState {
  width: number;
  height: number;
  isStandard: boolean; // >= 1280
  isCompact: boolean; // 1024 - 1279
  isNarrowHeight: boolean; // 640 - 767
  isUnsupported: boolean; // < 1024 || < 640
}

export function useOsViewport(): OsViewportState {
  const viewport = useWindowStore((state) => state?.viewport);

  const [browserSize, setBrowserSize] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1440,
    height: typeof window !== "undefined" ? window.innerHeight : 900,
  }));

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleResize = () => {
      setBrowserSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Geometry authority: canvas ResizeObserver viewport when set, otherwise browser dimensions
  const width = viewport?.width ?? browserSize.width;
  const height = viewport?.height ?? browserSize.height;

  // Support tiers: controlled exclusively by browser dimensions (1024x640 supported despite smaller reserved canvas)
  const bw = browserSize.width;
  const bh = browserSize.height;

  return {
    width,
    height,
    isStandard: bw >= 1280,
    isCompact: bw >= 1024 && bw < 1280,
    isNarrowHeight: bh >= 640 && bh < 768,
    isUnsupported: bw < 1024 || bh < 640,
  };
}

export interface ContainerSize {
  width: number;
  height: number;
  isCompact: boolean;
}

export function useContainerQuery<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T | null>,
  compactThreshold = 768,
): ContainerSize {
  const [size, setSize] = useState<ContainerSize>({
    width: 0,
    height: 0,
    isCompact: false,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        setSize({
          width,
          height,
          isCompact: width > 0 && width < compactThreshold,
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, compactThreshold]);

  return size;
}
