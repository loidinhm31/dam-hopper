import { useState } from "react";

const STORAGE_KEY = "devhub:sidebar-collapsed";

export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  }

  return { collapsed, toggle };
}
