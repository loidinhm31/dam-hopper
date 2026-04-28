import { useState, useRef, useEffect } from "react";
import type { ToolWindowDef } from "@/types/ide.js";
import { SidebarTopGroup } from "./SidebarTopGroup.js";
import { SidebarBottomGroup } from "./SidebarBottomGroup.js";
import { cn } from "@/lib/utils.js";

interface SidebarSplitContainerProps {
  topTool: ToolWindowDef | null;
  bottomTool: ToolWindowDef | null;
  width: number;
  onCloseTop: () => void;
  onCloseBottom: () => void;
  storageKey: string;
}

export function SidebarSplitContainer({
  topTool,
  bottomTool,
  width,
  onCloseTop,
  onCloseBottom,
  storageKey,
}: SidebarSplitContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitPct, setSplitPct] = useState<number>(() => {
    const stored = localStorage.getItem(storageKey);
    return stored ? parseInt(stored, 10) : 50;
  });
  const [isDragging, setIsDragging] = useState(false);

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const startY = e.clientY;
    const startPct = splitPct;
    const totalH = container.getBoundingClientRect().height;

    setIsDragging(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(ev: MouseEvent) {
      const newPct = Math.min(Math.max(startPct + ((ev.clientY - startY) / totalH) * 100, 10), 90);
      setSplitPct(newPct);
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setIsDragging(false);
      setSplitPct((pct) => {
        localStorage.setItem(storageKey, String(Math.round(pct)));
        return pct;
      });
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  if (!topTool && !bottomTool) return null;

  return (
    <div
      ref={containerRef}
      style={{ width }}
      className={cn(
        "shrink-0 flex flex-col bg-[var(--color-surface)] overflow-hidden",
        isDragging && "select-none"
      )}
    >
      {topTool && (
        <SidebarTopGroup
          tool={topTool}
          width={width}
          onClose={onCloseTop}
          hasBottomTool={!!bottomTool}
          style={bottomTool ? { height: `${splitPct}%` } : undefined}
        />
      )}

      {topTool && bottomTool && (
        <div
          onMouseDown={handleMouseDown}
          className="h-1 shrink-0 cursor-row-resize group relative hover:bg-[var(--color-primary)]/20"
        >
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-[var(--color-primary)]/50 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      )}

      {bottomTool && (
        <SidebarBottomGroup
          tool={bottomTool}
          width={width}
          onClose={onCloseBottom}
          style={topTool ? { height: `${100 - splitPct}%` } : undefined}
        />
      )}
    </div>
  );
}
