import { cn } from "@/lib/utils.js";
import type { HistorySearchResult } from "@/lib/command-history.js";

export interface OverlayPosition {
  /** Pixel offset from terminal element left edge. */
  x: number;
  /** Pixel offset from terminal element top edge. */
  y: number;
  /** When true, render above the cursor instead of below. */
  flipAbove: boolean;
}

interface Props {
  suggestions: HistorySearchResult[];
  selectedIndex: number;
  position: OverlayPosition;
  onAccept: (command: string) => void;
  onDismiss: () => void;
}

const MAX_VISIBLE = 5;

function RecencyDot({ lastUsedAt }: { lastUsedAt: number }) {
  const ageDays = (Date.now() - lastUsedAt) / (1000 * 60 * 60 * 24);
  const fresh = ageDays < 1;
  const recent = ageDays < 7;
  return (
    <span
      className={cn(
        "inline-block w-1.5 h-1.5 rounded-full shrink-0",
        fresh ? "bg-green-400" : recent ? "bg-yellow-500" : "bg-slate-600",
      )}
      title={`${Math.round(ageDays)}d ago`}
    />
  );
}

export function TerminalSuggestionOverlay({
  suggestions,
  selectedIndex,
  position,
  onAccept,
  onDismiss,
}: Props) {
  const visible = suggestions.slice(0, MAX_VISIBLE);

  const style: React.CSSProperties = {
    position: "absolute",
    left: position.x,
    zIndex: 50,
    minWidth: 220,
    maxWidth: 480,
    ...(position.flipAbove
      ? { bottom: `calc(100% - ${position.y}px)` }
      : { top: position.y }),
  };

  return (
    <div
      style={style}
      className={cn(
        "rounded border border-slate-700 bg-slate-900 shadow-xl shadow-black/60",
        "font-mono text-xs",
      )}
      onMouseDown={(e) => e.preventDefault()} // prevent terminal blur
    >
      <ul>
        {visible.map((result, i) => (
          <li
            key={`${result.entry.lastUsedAt}:${result.entry.command}`}
            onMouseDown={() => onAccept(result.entry.command)}
            className={cn(
              "flex items-center gap-2 px-2.5 py-1.5 cursor-pointer border-b border-slate-800 last:border-0 transition-colors",
              i === selectedIndex
                ? "bg-blue-600/30 text-blue-200"
                : "text-slate-200 hover:bg-slate-800",
            )}
          >
            <RecencyDot lastUsedAt={result.entry.lastUsedAt} />
            <span className="flex-1 truncate">{result.entry.command}</span>
            {result.entry.project && (
              <span className="text-[10px] text-slate-500 shrink-0 truncate max-w-20">
                {result.entry.project}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="px-2.5 py-1 border-t border-slate-800 text-[10px] text-slate-600 flex gap-3">
        <span>Tab cycle (Double-Tab shell)</span>
        <span>Enter accept</span>
        <span>Esc dismiss</span>
        <button
          onMouseDown={onDismiss}
          className="ml-auto text-slate-600 hover:text-slate-400"
          tabIndex={-1}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
