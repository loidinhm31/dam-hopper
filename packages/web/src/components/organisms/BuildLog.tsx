import { useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { useSSEEvent } from "@/hooks/useSSEEvents.js";
import { cn } from "@/lib/utils.js";

interface LogLine {
  id: number;
  text: string;
  ts: number;
}

interface Props {
  project?: string;
  initialLines?: string[];
  className?: string;
  showTimestamps?: boolean;
}

export function BuildLog({ project, initialLines = [], className, showTimestamps = false }: Props) {
  // Use ref for id counter to avoid HMR-reset issues (W6 fix)
  const lineIdRef = useRef(1);
  const nextId = () => lineIdRef.current++;

  const [lines, setLines] = useState<LogLine[]>(
    initialLines.map((t) => ({ id: lineIdRef.current++, text: t, ts: Date.now() })),
  );
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Append SSE build progress lines
  useSSEEvent("build:progress", (e) => {
    const data = e.data as { projectName?: string; output?: string };
    if (project && data.projectName !== project) return;
    if (data.output) {
      setLines((prev) => {
        const next = [...prev, { id: nextId(), text: data.output!, ts: e.timestamp }];
        return next.slice(-5000);
      });
    }
  });

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    setAutoScroll(atBottom);
  }

  function copyAll() {
    void navigator.clipboard.writeText(lines.map((l) => l.text).join("\n"));
  }

  return (
    <div className={cn("flex flex-col rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-xs text-[var(--color-text-muted)]">
          {lines.length} line{lines.length !== 1 ? "s" : ""}
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={copyAll} title="Copy all">
            <Copy className="h-3 w-3" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setLines([])} title="Clear">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="log-container flex-1 overflow-y-auto p-3 min-h-48 max-h-96 bg-[#0a0a0f]"
      >
        {lines.length === 0 ? (
          <span className="text-[var(--color-text-muted)]">No output yet…</span>
        ) : (
          lines.map((l) => (
            <div key={l.id} className="whitespace-pre-wrap break-all text-[var(--color-text)]">
              {showTimestamps && (
                <span className="text-[var(--color-text-muted)] mr-2 select-none">
                  {new Date(l.ts).toLocaleTimeString()}
                </span>
              )}
              {l.text}
            </div>
          ))
        )}
      </div>

      {!autoScroll && (
        <button
          className="text-xs text-[var(--color-primary)] hover:underline px-3 py-1.5 border-t border-[var(--color-border)] text-left"
          onClick={() => {
            setAutoScroll(true);
            containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
          }}
        >
          ↓ Scroll to bottom
        </button>
      )}
    </div>
  );
}
