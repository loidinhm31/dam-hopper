import { useEffect, useState } from "react";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

function readCoarsePointerMatch() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

export function useCoarsePointer() {
  const [isCoarsePointer, setIsCoarsePointer] = useState(
    readCoarsePointerMatch,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return () => {};
    }

    const mediaQuery = window.matchMedia(COARSE_POINTER_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsCoarsePointer(event.matches);
    };

    if (mediaQuery.addEventListener && mediaQuery.removeEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener?.(handleChange);
    return () => mediaQuery.removeListener?.(handleChange);
  }, []);

  return isCoarsePointer;
}
