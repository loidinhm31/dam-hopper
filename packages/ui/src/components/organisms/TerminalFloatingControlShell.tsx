import {
  useEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils.js";

const SAFE_AREA_RIGHT = "max(0.75rem, var(--safe-area-right, 0px))";
const SAFE_AREA_BOTTOM = "max(0.75rem, var(--safe-area-bottom, 0px))";

interface TerminalFloatingControlShellProps {
  sessionId: string;
  className?: string;
  isOpen: boolean;
  onDismiss: () => void;
  onEscape: () => void;
  outsideRefs?: RefObject<HTMLElement | null>[];
  children: ReactNode;
}

export function TerminalFloatingControlShell({
  sessionId,
  className,
  isOpen,
  onDismiss,
  onEscape,
  outsideRefs = [],
  children,
}: TerminalFloatingControlShellProps) {
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (
        controlsRef.current?.contains(target) ||
        outsideRefs.some((ref) => ref.current?.contains(target))
      ) {
        return;
      }
      onDismiss();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, onDismiss, onEscape, outsideRefs]);

  const guardControlPointer = (
    event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>,
  ) => {
    if (event.target instanceof HTMLInputElement) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      ref={controlsRef}
      role="group"
      aria-label="Terminal keyboard controls"
      data-testid="mobile-terminal-accessory-bar"
      data-session-id={sessionId}
      className={cn(
        "pointer-events-none absolute z-10 box-border flex max-w-full flex-col items-end rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/94 p-0.5 shadow-xl backdrop-blur-md",
        className,
      )}
      style={{
        right: SAFE_AREA_RIGHT,
        bottom: `calc(100% + ${SAFE_AREA_BOTTOM})`,
      }}
      onMouseDown={guardControlPointer}
      onPointerDown={guardControlPointer}
      onClick={(event) => {
        if (event.target instanceof HTMLInputElement) {
          event.stopPropagation();
          return;
        }
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}
