import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Keyboard,
  ChevronDown,
  ChevronUp,
  type LucideIcon,
} from "lucide-react";
import { getTransport } from "@/api/transport.js";
import {
  getMobileTerminalKeySequence,
  MOBILE_TERMINAL_KEYS,
} from "@/lib/mobile-terminal-keys.js";
import { cn } from "@/lib/utils.js";

const KEY_ICONS: Partial<Record<(typeof MOBILE_TERMINAL_KEYS)[number]["id"], LucideIcon>> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
};

function preventDefault(event: { preventDefault: () => void }) {
  event.preventDefault();
}

export function MobileTerminalAccessoryBar({
  sessionId,
  className,
}: {
  sessionId: string;
  className?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const keyboardInputRef = useRef<HTMLInputElement>(null);
  const keyboardValueRef = useRef("");

  const handlePress = useCallback(
    (id: (typeof MOBILE_TERMINAL_KEYS)[number]["id"]) => {
      const sequence = getMobileTerminalKeySequence(id);
      if (sequence) {
        getTransport().terminalWrite(sessionId, sequence);
      }
    },
    [sessionId],
  );

  const toggleExpanded = useCallback(() => {
    setIsExpanded((current) => !current);
  }, []);

  const toggleKeyboard = useCallback(() => {
    setIsKeyboardOpen((current) => {
      const next = !current;
      requestAnimationFrame(() => {
        if (next) {
          keyboardInputRef.current?.focus();
        } else {
          keyboardInputRef.current?.blur();
        }
      });
      return next;
    });
  }, []);

  const handleKeyboardInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      const previousValue = keyboardValueRef.current;
      const appended = nextValue.startsWith(previousValue)
        ? nextValue.slice(previousValue.length)
        : nextValue;

      if (appended) {
        getTransport().terminalWrite(sessionId, appended);
      }

      keyboardValueRef.current = "";
      event.target.value = "";
    },
    [sessionId],
  );

  const handleKeyboardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace") {
        event.preventDefault();
        getTransport().terminalWrite(sessionId, "\x7f");
        keyboardValueRef.current = "";
        event.currentTarget.value = "";
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        getTransport().terminalWrite(sessionId, "\r");
        keyboardValueRef.current = "";
        event.currentTarget.value = "";
      }
    },
    [sessionId],
  );

  return (
    <div
      className={cn(
        "safe-area-inline safe-area-bottom shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)]/96 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-1 py-2">
        <button
          type="button"
          aria-pressed={isExpanded}
          onPointerDown={(event) => {
            preventDefault(event);
            toggleExpanded();
          }}
          className="flex h-10 items-center justify-center gap-1 rounded-md border border-[var(--color-primary)]/35 bg-[var(--color-primary)]/14 px-3 text-[11px] font-semibold text-[var(--color-primary)] transition-colors active:bg-[var(--color-primary)]/20"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0" />
          )}
          <span className="whitespace-nowrap">Keys</span>
        </button>
        <button
          type="button"
          aria-pressed={isKeyboardOpen}
          onPointerDown={(event) => {
            preventDefault(event);
            toggleKeyboard();
          }}
          title="Open mobile keyboard"
          aria-label="Open mobile keyboard"
          className={cn(
            "flex h-10 items-center justify-center gap-1 rounded-md border px-3 text-[11px] font-semibold transition-colors",
            isKeyboardOpen
              ? "border-[var(--color-primary)]/35 bg-[var(--color-primary)]/14 text-[var(--color-primary)]"
              : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] active:bg-[var(--color-border)]",
          )}
        >
          <Keyboard className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap">Kbd</span>
        </button>
      </div>
      {isKeyboardOpen ? (
        <div className="pb-2">
          <input
            ref={keyboardInputRef}
            type="text"
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="enter"
            placeholder="Type for terminal"
            onChange={handleKeyboardInput}
            onKeyDown={handleKeyboardKeyDown}
            className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          />
        </div>
      ) : null}
      {isExpanded ? (
        <div className="grid grid-cols-4 gap-1 pb-2">
          {MOBILE_TERMINAL_KEYS.map((key) => {
            const Icon = KEY_ICONS[key.id];
            return (
              <button
                key={key.id}
                type="button"
                onPointerDown={(event) => {
                  preventDefault(event);
                  handlePress(key.id);
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
      ) : null}
    </div>
  );
}
