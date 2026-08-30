import { type CSSProperties } from "react";
import {
  CUSTOM_MOBILE_TERMINAL_COMPACT_KEY_ROWS,
  CUSTOM_MOBILE_TERMINAL_COMPACT_SYMBOL_ROWS,
  CUSTOM_MOBILE_TERMINAL_KEY_ROWS,
  CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS,
  getCustomMobileTerminalKeyAriaLabel,
  getCustomMobileTerminalKeyLabel,
  type CustomMobileTerminalKey,
} from "@/lib/mobile-terminal-keyboard-layout.js";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer.js";
import { useCompactWorkspace } from "@/hooks/use-compact-workspace.js";
import { cn } from "@/lib/utils.js";
import { useSettingsStore } from "@/stores/settings.js";

interface MobileTerminalCustomKeyboardProps {
  isShiftActive: boolean;
  isCtrlActive: boolean;
  isCapsActive: boolean;
  isAltActive: boolean;
  isMetaActive: boolean;
  isSymbolLayer: boolean;
  onPress: (key: CustomMobileTerminalKey) => void;
}

const KEY_GAP = "var(--mobile-terminal-key-gap, 4px)";
const KEY_UNIT = "var(--mobile-terminal-key-unit, 24px)";
const ARROW_CLUSTER_UNITS = 3;
const ARROW_CLUSTER_WIDTH = `calc(${KEY_UNIT} * 3 + ${KEY_GAP} + ${KEY_GAP})`;

function preventDefault(event: { preventDefault: () => void }) {
  event.preventDefault();
}

export function MobileTerminalCustomKeyboard({
  isShiftActive,
  isCtrlActive,
  isCapsActive,
  isAltActive,
  isMetaActive,
  isSymbolLayer,
  onPress,
}: MobileTerminalCustomKeyboardProps) {
  const isCompactWorkspace = useCompactWorkspace();
  const isCoarsePointer = useCoarsePointer();
  const isCompactMobile = isCompactWorkspace && isCoarsePointer;
  const rows = isCompactMobile
    ? isSymbolLayer
      ? CUSTOM_MOBILE_TERMINAL_COMPACT_SYMBOL_ROWS
      : CUSTOM_MOBILE_TERMINAL_COMPACT_KEY_ROWS
    : isSymbolLayer
      ? CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS
      : CUSTOM_MOBILE_TERMINAL_KEY_ROWS;
  const {
    mobileCustomKeyboardFontSize,
    mobileCustomKeyboardPadding,
    mobileCustomKeyboardRowGap,
  } = useSettingsStore();
  const keyHeight = Math.max(
    44,
    mobileCustomKeyboardFontSize + mobileCustomKeyboardPadding * 2,
  );
  const keyPadding = Math.max(8, mobileCustomKeyboardPadding);
  const responsiveKeyPadding = `max(2px, min(${keyPadding}px, 1cqw))`;
  const rowGap = Math.max(8, mobileCustomKeyboardRowGap);
  const modifiers = {
    shift: isShiftActive,
    ctrl: isCtrlActive,
    caps: isCapsActive,
    alt: isAltActive,
    meta: isMetaActive,
  };

  const renderKey = (key: CustomMobileTerminalKey) => {
    const isActive =
      (key.toggle === "shift" && isShiftActive) ||
      (key.toggle === "ctrl" && isCtrlActive) ||
      (key.toggle === "caps" && isCapsActive) ||
      (key.toggle === "alt" && isAltActive) ||
      (key.toggle === "meta" && isMetaActive) ||
      (key.toggle === "symbols" && isSymbolLayer);
    const units = key.units ?? 1;
    const keyWidth = `calc(${KEY_UNIT} * ${units})`;
    const label = getCustomMobileTerminalKeyLabel(
      key,
      isShiftActive,
      isCapsActive,
    );
    const ariaLabel = getCustomMobileTerminalKeyAriaLabel(key, modifiers);
    return (
      <button
        key={key.id}
        type="button"
        data-key-id={key.id}
        onPointerDown={(event) => {
          preventDefault(event);
          onPress(key);
        }}
        onClick={(event) => {
          if (event.detail === 0) onPress(key);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onPress(key);
        }}
        title={ariaLabel}
        aria-label={ariaLabel}
        aria-pressed={key.kind === "toggle" ? isActive : undefined}
        className={cn(
          "flex min-w-0 items-center justify-center rounded-md border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] active:bg-[var(--color-border)] touch-manipulation",
          isActive
            ? "border-[var(--color-primary)]/40 bg-[var(--color-primary)]/14 text-[var(--color-primary)]"
            : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)]",
        )}
        style={{
          flex: `${units} 1 ${keyWidth}`,
          fontSize: mobileCustomKeyboardFontSize,
          minHeight: keyHeight,
          minWidth: keyWidth,
          paddingInline: responsiveKeyPadding,
          paddingBlock: Math.max(
            4,
            Math.round(mobileCustomKeyboardPadding / 2),
          ),
        }}
      >
        <span className="truncate">{label}</span>
      </button>
    );
  };

  return (
    <div
      data-testid="mobile-terminal-custom-keyboard"
      className="min-w-0 overflow-x-hidden overscroll-x-contain"
      style={
        {
          containerType: "inline-size",
          "--mobile-terminal-key-unit":
            "clamp(14px, calc((100cqw - 15 * var(--mobile-terminal-key-gap)) / 16.25), 44px)",
          "--mobile-terminal-key-gap": "clamp(4px, 0.625cqw, 8px)",
        } as CSSProperties
      }
    >
      <div className="grid w-full min-w-0 pb-2" style={{ rowGap }}>
        {rows.map((row, index) => {
          const regularKeys = row.filter((key) => key.cluster !== "arrows");
          const arrowKeyById = Object.fromEntries(
            row
              .filter((key) => key.cluster === "arrows")
              .map((key) => [key.id, key]),
          ) as Record<string, CustomMobileTerminalKey | undefined>;
          const hasArrowKeys = row.some((key) => key.cluster === "arrows");
          const arrowSlots = [
            null,
            arrowKeyById.up,
            null,
            arrowKeyById.left,
            arrowKeyById.down,
            arrowKeyById.right,
          ];
          return (
            <div
              key={index}
              data-keyboard-row={index}
              className="flex w-full min-w-0 justify-center"
              style={{ columnGap: KEY_GAP }}
            >
              {regularKeys.map(renderKey)}
              {hasArrowKeys ? (
                <div
                  role="group"
                  aria-label="Arrow keys"
                  className="grid min-w-0 grid-cols-3 grid-rows-2"
                  style={{
                    flex: `${ARROW_CLUSTER_UNITS} 1 ${ARROW_CLUSTER_WIDTH}`,
                    minWidth: ARROW_CLUSTER_WIDTH,
                    gap: KEY_GAP,
                  }}
                >
                  {arrowSlots.map((key, slot) =>
                    key ? (
                      renderKey(key)
                    ) : (
                      <span
                        key={`arrow-gap-${slot}`}
                        aria-hidden="true"
                        className="min-h-11 min-w-0"
                      />
                    ),
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
