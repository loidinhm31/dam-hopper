const COARSE_POINTER_QUERY = "(pointer: coarse)";

export function bindTerminalTouchScroll(root: HTMLElement | null): () => void {
  if (
    !root ||
    typeof window === "undefined" ||
    !window.matchMedia?.(COARSE_POINTER_QUERY).matches
  ) {
    return () => {};
  }

  const viewport = root.querySelector<HTMLElement>(".xterm-viewport");
  if (!viewport) {
    return () => {};
  }

  let startY = 0;
  let startScrollTop = 0;
  let isDragging = false;

  const handleTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    startY = touch.clientY;
    startScrollTop = viewport.scrollTop;
    isDragging = true;
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (!isDragging) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (event.cancelable) {
      event.preventDefault();
    }
    viewport.scrollTop = startScrollTop + (startY - touch.clientY);
  };

  const handleTouchEnd = () => {
    isDragging = false;
  };

  viewport.addEventListener("touchstart", handleTouchStart, { passive: true });
  viewport.addEventListener("touchmove", handleTouchMove, { passive: false });
  viewport.addEventListener("touchend", handleTouchEnd, { passive: true });
  viewport.addEventListener("touchcancel", handleTouchEnd, { passive: true });

  return () => {
    viewport.removeEventListener("touchstart", handleTouchStart);
    viewport.removeEventListener("touchmove", handleTouchMove);
    viewport.removeEventListener("touchend", handleTouchEnd);
    viewport.removeEventListener("touchcancel", handleTouchEnd);
  };
}
