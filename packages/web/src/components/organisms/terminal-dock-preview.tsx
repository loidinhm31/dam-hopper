import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils.js";

interface DockZoneProps {
  id: string;
  label: string;
  className: string;
  isDragging: boolean;
}

function DockZone({ id, label, className, isDragging }: DockZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute flex items-center justify-center rounded-xl border border-dashed text-[11px] font-medium uppercase tracking-[0.14em] transition-all duration-100",
        !isDragging && "pointer-events-none opacity-0",
        isDragging &&
          "border-white/15 bg-slate-950/40 text-slate-200/85 backdrop-blur-sm",
        isOver &&
          "border-sky-300 bg-sky-500/25 text-sky-50 shadow-[0_0_0_1px_rgba(125,211,252,0.9)]",
        className,
      )}
    >
      <span className="rounded-full bg-black/25 px-2 py-1">{label}</span>
    </div>
  );
}

interface TerminalDockPreviewProps {
  paneId: string;
  isDragging: boolean;
}

export function TerminalDockPreview({
  paneId,
  isDragging,
}: TerminalDockPreviewProps) {
  return (
    <div
      className={cn(
        "absolute inset-0 z-20 transition-opacity duration-100",
        isDragging
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0",
      )}
    >
      <div className="absolute inset-2 rounded-2xl border border-white/10 bg-slate-950/20" />
      <DockZone
        id={`pane:${paneId}:edge:top`}
        label="Split Up"
        className="left-[24%] right-[24%] top-3 h-[18%]"
        isDragging={isDragging}
      />
      <DockZone
        id={`pane:${paneId}:edge:bottom`}
        label="Split Down"
        className="left-[24%] right-[24%] bottom-3 h-[18%]"
        isDragging={isDragging}
      />
      <DockZone
        id={`pane:${paneId}:edge:left`}
        label="Split Left"
        className="left-3 top-[24%] bottom-[24%] w-[18%]"
        isDragging={isDragging}
      />
      <DockZone
        id={`pane:${paneId}:edge:right`}
        label="Split Right"
        className="right-3 top-[24%] bottom-[24%] w-[18%]"
        isDragging={isDragging}
      />
      <DockZone
        id={`pane:${paneId}:center`}
        label="Move Here"
        className="left-[24%] right-[24%] top-[24%] bottom-[24%]"
        isDragging={isDragging}
      />
    </div>
  );
}
