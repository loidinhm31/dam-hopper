type CloseMenu = () => void;

let activeClose: CloseMenu | null = null;

function setScrollListener(close: CloseMenu, active: boolean) {
  if (typeof document === "undefined") return;
  if (active) document.addEventListener("scroll", close, true);
  else document.removeEventListener("scroll", close, true);
}

export function claimContextMenu(close: CloseMenu) {
  if (activeClose === close) return;
  const previousClose = activeClose;
  if (previousClose) {
    setScrollListener(previousClose, false);
    activeClose = null;
    previousClose();
  }
  activeClose = close;
  setScrollListener(close, true);
}

export function releaseContextMenu(close: CloseMenu) {
  if (activeClose !== close) return;
  setScrollListener(close, false);
  activeClose = null;
}
