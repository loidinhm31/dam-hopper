import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  Keyboard,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { getTransport } from "@/api/transport.js";
import {
  getCustomMobileTerminalKeySequence,
  type CustomMobileTerminalKey,
} from "@/lib/mobile-terminal-keyboard-layout.js";
import {
  getMobileTerminalKeySequence,
  type MobileTerminalKeyId,
} from "@/lib/mobile-terminal-keys.js";
import { cn } from "@/lib/utils.js";
import { useSettingsStore } from "@/stores/settings.js";
import { MobileTerminalCustomKeyboard } from "@/components/organisms/MobileTerminalCustomKeyboard.js";
import { MobileTerminalNativeKeyboardInput } from "@/components/organisms/MobileTerminalNativeKeyboardInput.js";
import { MobileTerminalSpecialKeys } from "@/components/organisms/MobileTerminalSpecialKeys.js";

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
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [isCtrlActive, setIsCtrlActive] = useState(false);
  const [isSymbolLayer, setIsSymbolLayer] = useState(false);
  const keyboardInputRef = useRef<HTMLInputElement>(null);
  const keyboardValueRef = useRef("");
  const mobileCustomKeyboardEnabled = useSettingsStore(
    (state) => state.mobileCustomKeyboardEnabled,
  );

  useEffect(() => {
    if (mobileCustomKeyboardEnabled) keyboardInputRef.current?.blur();
  }, [mobileCustomKeyboardEnabled]);

  const handlePress = useCallback(
    (id: MobileTerminalKeyId) => {
      const sequence = getMobileTerminalKeySequence(id);
      if (sequence) getTransport().terminalWrite(sessionId, sequence);
    },
    [sessionId],
  );

  const toggleKeyboard = useCallback(() => {
    setIsKeyboardOpen((current) => {
      const next = !current;
      requestAnimationFrame(() => {
        if (next && !mobileCustomKeyboardEnabled) {
          keyboardInputRef.current?.focus();
        } else {
          keyboardInputRef.current?.blur();
        }
      });
      return next;
    });
  }, [mobileCustomKeyboardEnabled]);

  const handleCustomKeyPress = useCallback(
    (key: CustomMobileTerminalKey) => {
      if (key.kind === "toggle") {
        if (key.toggle === "shift") setIsShiftActive((current) => !current);
        if (key.toggle === "ctrl") setIsCtrlActive((current) => !current);
        if (key.toggle === "symbols") setIsSymbolLayer((current) => !current);
        return;
      }

      const sequence = getCustomMobileTerminalKeySequence(key, {
        shift: isShiftActive,
        ctrl: isCtrlActive,
      });
      if (sequence) getTransport().terminalWrite(sessionId, sequence);
      if (isShiftActive && key.kind === "text") setIsShiftActive(false);
      if (isCtrlActive) setIsCtrlActive(false);
    },
    [isCtrlActive, isShiftActive, sessionId],
  );

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
            setIsExpanded((current) => !current);
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
          <span className="whitespace-nowrap">
            {mobileCustomKeyboardEnabled ? "Type" : "Kbd"}
          </span>
        </button>
      </div>
      {isKeyboardOpen && mobileCustomKeyboardEnabled ? (
        <MobileTerminalCustomKeyboard
          isShiftActive={isShiftActive}
          isCtrlActive={isCtrlActive}
          isSymbolLayer={isSymbolLayer}
          onPress={handleCustomKeyPress}
        />
      ) : isKeyboardOpen ? (
        <MobileTerminalNativeKeyboardInput
          inputRef={keyboardInputRef}
          onChange={handleKeyboardInput}
          onKeyDown={handleKeyboardKeyDown}
        />
      ) : null}
      {isExpanded ? (
        <MobileTerminalSpecialKeys onPress={handlePress} />
      ) : null}
    </div>
  );
}
