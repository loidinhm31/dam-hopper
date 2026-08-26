import {
  CUSTOM_MOBILE_TERMINAL_KEY_ROWS,
  CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS,
  type CustomMobileTerminalKey,
} from "@/lib/mobile-terminal-keyboard-layout.js";
import { cn } from "@/lib/utils.js";
import { useSettingsStore } from "@/stores/settings.js";

interface MobileTerminalCustomKeyboardProps {
  isShiftActive: boolean;
  isCtrlActive: boolean;
  isSymbolLayer: boolean;
  onPress: (key: CustomMobileTerminalKey) => void;
}

function preventDefault(event: { preventDefault: () => void }) {
  event.preventDefault();
}

export function MobileTerminalCustomKeyboard({
  isShiftActive,
  isCtrlActive,
  isSymbolLayer,
  onPress,
}: MobileTerminalCustomKeyboardProps) {
  const rows = isSymbolLayer
    ? CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS
    : CUSTOM_MOBILE_TERMINAL_KEY_ROWS;
  const {
    mobileCustomKeyboardFontSize,
    mobileCustomKeyboardPadding,
    mobileCustomKeyboardRowGap,
  } = useSettingsStore();
  const keyHeight = Math.max(
    34,
    mobileCustomKeyboardFontSize + mobileCustomKeyboardPadding * 2,
  );
  const verticalPadding = Math.max(
    2,
    Math.round(mobileCustomKeyboardPadding / 2),
  );

  return (
    <div className="grid pb-2" style={{ rowGap: mobileCustomKeyboardRowGap }}>
      {rows.map((row, index) => (
        <div key={index} className="flex gap-1">
          {row.map((key) => {
            const isActive =
              (key.toggle === "shift" && isShiftActive) ||
              (key.toggle === "ctrl" && isCtrlActive) ||
              (key.toggle === "symbols" && isSymbolLayer);
            return (
              <button
                key={key.id}
                type="button"
                onPointerDown={(event) => {
                  preventDefault(event);
                  onPress(key);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onPress(key);
                }}
                title={key.title}
                aria-label={key.title}
                aria-pressed={key.kind === "toggle" ? isActive : undefined}
                className={cn(
                  "flex min-w-0 items-center justify-center rounded-md border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] active:bg-[var(--color-border)]",
                  key.wide ? "flex-[2.4]" : "flex-1",
                  isActive
                    ? "border-[var(--color-primary)]/40 bg-[var(--color-primary)]/14 text-[var(--color-primary)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)]",
                )}
                style={{
                  fontSize: mobileCustomKeyboardFontSize,
                  minHeight: keyHeight,
                  paddingInline: mobileCustomKeyboardPadding,
                  paddingBlock: verticalPadding,
                }}
              >
                <span className="truncate">{key.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
