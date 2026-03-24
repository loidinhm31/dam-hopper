import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "devhub:sidebar-collapsed";

function isEditableTarget(el: HTMLElement): boolean {
  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
    el.contentEditable === "true" ||
    !!el.closest("[contenteditable='true']") ||
    !!el.closest(".xterm")
  );
}

export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "b") return;
      if (isEditableTarget(e.target as HTMLElement)) return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggle]);

  return { collapsed, toggle };
}
