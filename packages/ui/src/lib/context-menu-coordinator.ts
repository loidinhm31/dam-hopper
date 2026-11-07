import { useCognitoModeStore } from "@/stores/cognito-mode.js";

export const CONTEXT_MENU_PORTAL_ATTR = "data-os-menu-portal";

type CloseMenu = () => void;

let activeClose: CloseMenu | null = null;
let activeOwner: string | null = null;
const listeners = new Set<(isOpen: boolean) => void>();

function notify() {
  const isOpen = activeClose !== null;
  for (const listener of listeners) {
    listener(isOpen);
  }
}

function setScrollListener(close: CloseMenu, active: boolean) {
  if (typeof document === "undefined") return;
  if (active) document.addEventListener("scroll", close, true);
  else document.removeEventListener("scroll", close, true);
}

export function claimContextMenu(
  close: CloseMenu,
  owner?: string | null,
): void {
  if (activeClose === close) {
    if (owner !== undefined) activeOwner = owner;
    return;
  }
  const previousClose = activeClose;
  if (previousClose) {
    setScrollListener(previousClose, false);
    activeClose = null;
    activeOwner = null;
    previousClose();
  }
  activeClose = close;
  activeOwner = owner ?? null;
  setScrollListener(close, true);
  notify();
}

export function releaseContextMenu(close: CloseMenu): void {
  if (activeClose !== close) return;
  setScrollListener(close, false);
  activeClose = null;
  activeOwner = null;
  notify();
}

export function isContextMenuOpen(): boolean {
  return activeClose !== null;
}

export function getContextMenuSnapshot(): boolean {
  return activeClose !== null;
}

export function getContextMenuOwner(): string | null {
  return activeOwner;
}

export function isContextMenuOwnedBy(owner: string): boolean {
  return activeOwner === owner;
}

export function subscribeContextMenu(
  listener: (isOpen: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissContextMenu(): void {
  if (!activeClose) return;
  const close = activeClose;
  setScrollListener(close, false);
  activeClose = null;
  activeOwner = null;
  close();
  notify();
}

// Synchronous privacy dismissal when Cognito mode is activated (C8)
if (typeof window !== "undefined") {
  useCognitoModeStore.subscribe((state, prevState) => {
    if (state.active && !prevState?.active) {
      dismissContextMenu();
    }
  });
}
