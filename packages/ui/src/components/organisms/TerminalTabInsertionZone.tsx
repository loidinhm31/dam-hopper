import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils.js";

interface TerminalTabInsertionZoneProps {
  paneId: string;
  index: number;
  isDragging: boolean;
  isEmpty?: boolean;
}

export function TerminalTabInsertionZone({
  paneId,
  index,
  isDragging,
  isEmpty = false,
}: TerminalTabInsertionZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `tabs:${paneId}:index:${index}`,
  });

  if (isEmpty) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "mx-2 flex h-6 min-w-24 items-center justify-center rounded-md border border-dashed text-[10px] font-medium uppercase tracking-[0.12em] transition-all",
          !isDragging && "pointer-events-none opacity-0",
          isDragging && "border-white/15 text-[var(--color-text-muted)]",
          isOver && "border-sky-300 bg-sky-500/15 text-sky-100",
        )}
      >
        Insert Tab
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative flex h-full w-2 shrink-0 items-center justify-center transition-all",
        !isDragging && "pointer-events-none opacity-0",
        isDragging && "opacity-100",
      )}
    >
      <div
        className={cn(
          "h-4 w-px rounded-full bg-transparent transition-all",
          isOver && "h-5 w-1 bg-sky-300 shadow-[0_0_0_1px_rgba(125,211,252,0.8)]",
        )}
      />
    </div>
  );
}
