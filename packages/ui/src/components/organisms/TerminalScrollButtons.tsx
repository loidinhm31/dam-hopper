import { useEffect, useRef, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
} from "lucide-react";
import { terminalRegistry } from "@/lib/terminal-registry.js";
import { cn } from "@/lib/utils.js";
import { useSettingsStore } from "@/stores/settings.js";

interface TerminalScrollButtonsProps {
  sessionId: string;
  className?: string;
  reserveAccessoryRail?: boolean;
  accessoryPanelOpen?: boolean;
}

const controlClassName =
  "flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]";
const SAFE_AREA_BOTTOM =
  "var(--terminal-floating-bottom-offset, calc(3rem + var(--safe-area-bottom, 0px)))";
const ACCESSORY_RAIL_RESERVATION = "6.25rem";
const ACCESSORY_RAIL_GAP = "0.5rem";
const ACCESSORY_RAIL_RESERVATION_CSS = `var(--terminal-accessory-rail-reservation, ${ACCESSORY_RAIL_RESERVATION})`;
const ACCESSORY_RAIL_GAP_CSS = `var(--terminal-accessory-rail-gap, ${ACCESSORY_RAIL_GAP})`;
const OPEN_PANEL_BOTTOM = `calc(100% + ${SAFE_AREA_BOTTOM} + ${ACCESSORY_RAIL_RESERVATION_CSS} + ${ACCESSORY_RAIL_GAP_CSS})`;
const SAFE_AREA_RIGHT = "max(0.75rem, var(--safe-area-right, 0px))";
const SCROLL_RIGHT = `calc(${SAFE_AREA_RIGHT} + var(--terminal-scroll-right-lane, 0px))`;

function blurFocusedTerminalInput(): void {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLElement &&
    activeElement.matches(".xterm-helper-textarea")
  ) {
    activeElement.blur();
  }
}

function preventPointerFocus(event: {
  preventDefault: () => void;
  stopPropagation: () => void;
}): void {
  // Cancel pointer focus + host bubbling before a coarse-pointer tap can reach
  // the xterm textarea or the clickable terminal host (Android IME).
  event.preventDefault();
  event.stopPropagation();
  blurFocusedTerminalInput();
}

function stopTouchPropagation(event: { stopPropagation: () => void }): void {
  // React delegates touchstart as passive in Chromium, so only propagation is
  // reliable here; pointerdown owns native focus cancellation.
  event.stopPropagation();
  blurFocusedTerminalInput();
}

export function TerminalScrollButtons({
  sessionId,
  className,
  reserveAccessoryRail = false,
  accessoryPanelOpen = false,
}: TerminalScrollButtonsProps) {
  const terminalScrollStep = useSettingsStore((s) => s.terminalScrollStep);
  const [isOpen, setIsOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const controlsId = `terminal-scroll-controls-${sessionId}`;

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  const handleTerminalAction = (
    event: React.MouseEvent,
    action: () => void,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  return (
    <div
      ref={controlsRef}
      className={cn(
        "absolute right-[max(0.75rem,var(--safe-area-right))] z-10 flex flex-col-reverse items-end gap-2 [--terminal-accessory-rail-reservation:6.25rem]",
        accessoryPanelOpen
          ? isOpen
            ? "[@media(max-height:28rem)]:flex-row-reverse [@media(max-height:28rem)]:[--terminal-floating-bottom-offset:0px] [@media(max-height:28rem)]:[--terminal-accessory-rail-reservation:0px] [@media(max-height:28rem)]:[--terminal-accessory-rail-gap:0px] [@media(max-height:28rem)]:[--terminal-scroll-right-lane:7rem]"
            : "[@media(max-height:28rem)]:[--terminal-floating-bottom-offset:0.5rem] [@media(max-height:28rem)]:[--terminal-accessory-rail-reservation:0px] [@media(max-height:28rem)]:[--terminal-accessory-rail-gap:0px] [@media(max-height:28rem)]:[--terminal-scroll-right-lane:7rem]"
          : "",
        className,
      )}
      style={{
        right: SCROLL_RIGHT,
        bottom: accessoryPanelOpen
          ? OPEN_PANEL_BOTTOM
          : reserveAccessoryRail
            ? `calc(${SAFE_AREA_BOTTOM} + ${ACCESSORY_RAIL_RESERVATION_CSS} + ${ACCESSORY_RAIL_GAP_CSS})`
            : SAFE_AREA_BOTTOM,
      }}
    >
      <button
        type="button"
        onPointerDown={preventPointerFocus}
        onTouchStart={stopTouchPropagation}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen((open) => !open);
        }}
        className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/90 text-[var(--color-text)] shadow-lg backdrop-blur-md transition-[background-color,box-shadow,transform] duration-150 hover:bg-[var(--color-surface-2)] hover:shadow-xl active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        title={
          isOpen
            ? "Hide terminal scroll buttons"
            : "Show terminal scroll buttons"
        }
        aria-label={
          isOpen
            ? "Hide terminal scroll buttons"
            : "Show terminal scroll buttons"
        }
        aria-expanded={isOpen}
        aria-controls={isOpen ? controlsId : undefined}
      >
        <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div
          id={controlsId}
          role="group"
          aria-label="Terminal scroll controls"
          className="flex flex-col gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/90 p-1 shadow-xl max-[28rem]:grid max-[28rem]:grid-cols-2 max-[28rem]:gap-1 [@media(max-height:28rem)]:grid [@media(max-height:28rem)]:grid-cols-2 [@media(max-height:28rem)]:gap-1 [@media(max-height:28rem)]:p-0.5"
        >
          <button
            type="button"
            onPointerDown={preventPointerFocus}
            onTouchStart={stopTouchPropagation}
            onClick={(event) =>
              handleTerminalAction(event, () =>
                terminalRegistry.get(sessionId)?.terminal.scrollToTop(),
              )
            }
            className={controlClassName}
            title="Jump to top"
            aria-label="Jump to top"
          >
            <ChevronsUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onPointerDown={preventPointerFocus}
            onTouchStart={stopTouchPropagation}
            onClick={(event) =>
              handleTerminalAction(event, () =>
                terminalRegistry
                  .get(sessionId)
                  ?.terminal.scrollLines(-terminalScrollStep),
              )
            }
            className={controlClassName}
            title={`Scroll up ${terminalScrollStep} lines`}
            aria-label={`Scroll up ${terminalScrollStep} lines`}
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onPointerDown={preventPointerFocus}
            onTouchStart={stopTouchPropagation}
            onClick={(event) =>
              handleTerminalAction(event, () =>
                terminalRegistry
                  .get(sessionId)
                  ?.terminal.scrollLines(terminalScrollStep),
              )
            }
            className={controlClassName}
            title={`Scroll down ${terminalScrollStep} lines`}
            aria-label={`Scroll down ${terminalScrollStep} lines`}
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onPointerDown={preventPointerFocus}
            onTouchStart={stopTouchPropagation}
            onClick={(event) =>
              handleTerminalAction(event, () =>
                terminalRegistry.get(sessionId)?.terminal.scrollToBottom(),
              )
            }
            className={controlClassName}
            title="Jump to bottom"
            aria-label="Jump to bottom"
          >
            <ChevronsDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
