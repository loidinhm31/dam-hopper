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
  return (
    <div className="grid grid-cols-4 gap-1 pb-2">
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
            title={key.title}
            aria-label={key.title}
            className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-[11px] font-semibold text-[var(--color-text)] transition-colors active:bg-[var(--color-border)]"
          >
            {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
            {!Icon ? <span className="truncate">{key.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
