import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  type LucideIcon,
} from "lucide-react";
import {
  MOBILE_TERMINAL_KEYS,
  type MobileTerminalKeyId,
} from "@/lib/mobile-terminal-keys.js";
import { useSettingsStore } from "@/stores/settings.js";

const KEY_ICONS: Partial<Record<MobileTerminalKeyId, LucideIcon>> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
};

interface MobileTerminalSpecialKeysProps {
  onPress: (id: MobileTerminalKeyId) => void;
}

function preventDefault(event: { preventDefault: () => void }) {
  event.preventDefault();
}

export function MobileTerminalSpecialKeys({
  onPress,
}: MobileTerminalSpecialKeysProps) {
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
    <div
      className="grid grid-cols-4 gap-x-1 pb-2"
      style={{ rowGap: mobileCustomKeyboardRowGap }}
    >
      {MOBILE_TERMINAL_KEYS.map((key) => {
        const Icon = KEY_ICONS[key.id];
        return (
          <button
            key={key.id}
            type="button"
            onPointerDown={(event) => {
              preventDefault(event);
              onPress(key.id);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onPress(key.id);
            }}
            title={key.title}
            aria-label={key.title}
            className="flex min-w-0 items-center justify-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] font-semibold text-[var(--color-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] active:bg-[var(--color-border)]"
            style={{
              fontSize: mobileCustomKeyboardFontSize,
              minHeight: keyHeight,
              paddingInline: mobileCustomKeyboardPadding,
              paddingBlock: verticalPadding,
            }}
          >
            {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
            {!Icon ? <span className="truncate">{key.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
