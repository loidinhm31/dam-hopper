import type { CSSProperties } from "react";
import { cn } from "@/lib/utils.js";

/** A host-relative anchor supplied by the terminal cursor geometry adapter. */
export interface TerminalSuggestionGhostPosition {
  x: number;
  y: number;
  lineHeight: number;
}

export interface TerminalSuggestionGhostProps {
  /** Candidate text after the verified, already-typed prefix. */
  suffix: string;
  position: TerminalSuggestionGhostPosition;
  className?: string;
}

/**
 * A strictly visual terminal completion suffix. It intentionally has no input,
 * click, or accessibility behavior; acceptance remains owned by TerminalPanel.
 */
export function TerminalSuggestionGhost({
  suffix,
  position,
  className,
}: TerminalSuggestionGhostProps) {
  if (!suffix) return null;

  const style: CSSProperties = {
    left: position.x,
    top: position.y,
    fontSize: 13,
    lineHeight: `${position.lineHeight}px`,
  };

  return (
    <span
      aria-hidden="true"
      tabIndex={-1}
      style={style}
      className={cn(
        "pointer-events-none absolute right-0 z-10 block select-none overflow-hidden whitespace-nowrap",
        "font-mono text-slate-500",
        "[mask-image:linear-gradient(to_right,#000_calc(100%_-_1.25rem),transparent)]",
        "[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%_-_1.25rem),transparent)]",
        className,
      )}
    >
      {suffix}
    </span>
  );
}
