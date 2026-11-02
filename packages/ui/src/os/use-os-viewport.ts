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
  const width = viewport?.width || (typeof window !== "undefined" ? window.innerWidth : 1440);
  const height = viewport?.height || (typeof window !== "undefined" ? window.innerHeight : 900);

  return {
    width,
    height,
    isStandard: width >= 1280,
    isCompact: width >= 1024 && width < 1280,
    isNarrowHeight: height >= 640 && height < 768,
    isUnsupported: width < 1024 || height < 640,
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
