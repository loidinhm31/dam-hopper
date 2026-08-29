import type { RefObject } from "react";
import { Keyboard, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils.js";

interface TerminalAccessoryControlsProps {
  isExpanded: boolean;
  isKeyboardOpen: boolean;
  keyboardButtonLabel: string;
  keyboardButtonText: string;
  keysButtonRef: RefObject<HTMLButtonElement | null>;
  keyboardButtonRef: RefObject<HTMLButtonElement | null>;
  onToggleKeys: () => void;
  onToggleKeyboard: () => void;
  keysPanelId: string;
  keyboardPanelId: string;
}

export function TerminalAccessoryControls({
  isExpanded,
  isKeyboardOpen,
  keyboardButtonLabel,
  keyboardButtonText,
  keysButtonRef,
  keyboardButtonRef,
  onToggleKeys,
  onToggleKeyboard,
  keysPanelId,
  keyboardPanelId,
}: TerminalAccessoryControlsProps) {
  const isPanelOpen = isExpanded || isKeyboardOpen;

  return (
    <div
      data-testid="mobile-terminal-accessory-controls"
      className={cn(
        "pointer-events-auto flex shrink-0 gap-1",
        isPanelOpen
          ? "flex-col [@media(max-height:28rem)]:flex-row"
          : "flex-col",
      )}
    >
      <button
        ref={keysButtonRef}
        type="button"
        aria-pressed={isExpanded}
        aria-expanded={isExpanded}
        aria-controls={isExpanded ? keysPanelId : undefined}
        aria-label={isExpanded ? "Hide terminal keys" : "Show terminal keys"}
        title={isExpanded ? "Hide terminal keys" : "Show terminal keys"}
        onClick={onToggleKeys}
        className="inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-[var(--color-primary)]/35 bg-[var(--color-primary)]/14 p-0 text-[11px] font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] active:bg-[var(--color-primary)]/20"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronUp className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <span className="sr-only">Keys</span>
      </button>
      <button
        ref={keyboardButtonRef}
        type="button"
        aria-pressed={isKeyboardOpen}
        aria-expanded={isKeyboardOpen}
        aria-controls={isKeyboardOpen ? keyboardPanelId : undefined}
        onClick={onToggleKeyboard}
        title={keyboardButtonLabel}
        aria-label={keyboardButtonLabel}
        className={cn(
          "inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg border p-0 text-[11px] font-semibold transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
          isKeyboardOpen
            ? "border-[var(--color-primary)]/35 bg-[var(--color-primary)]/14 text-[var(--color-primary)]"
            : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] active:bg-[var(--color-border)]",
        )}
      >
        <Keyboard className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="sr-only">{keyboardButtonText}</span>
      </button>
    </div>
  );
}
