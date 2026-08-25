import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { getTransport } from "@/api/transport.js";
import {
  getCustomMobileTerminalKeySequence,
  type CustomMobileTerminalKey,
} from "@/lib/mobile-terminal-keyboard-layout.js";
import {
  getMobileTerminalKeySequence,
  type MobileTerminalKeyId,
} from "@/lib/mobile-terminal-keys.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";
import { MobileTerminalCustomKeyboard } from "@/components/organisms/MobileTerminalCustomKeyboard.js";
import { MobileTerminalNativeKeyboardInput } from "@/components/organisms/MobileTerminalNativeKeyboardInput.js";
import { MobileTerminalSpecialKeys } from "@/components/organisms/MobileTerminalSpecialKeys.js";
import { TerminalAccessoryControls } from "@/components/organisms/TerminalAccessoryControls.js";
import { TerminalFloatingControlShell } from "@/components/organisms/TerminalFloatingControlShell.js";

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
  const keysButtonRef = useRef<HTMLButtonElement>(null);
  const keyboardButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const outsideRefs = useMemo(() => [panelRef], []);
  const invokingControlRef = useRef<"keys" | "keyboard">("keys");
  const keyboardInputRef = useRef<HTMLInputElement>(null);
  const keyboardValueRef = useRef("");
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const mobileCustomKeyboardEnabled = useSettingsStore(
    (state) => state.mobileCustomKeyboardEnabled,
  );
  const shouldUseCustomKeyboard =
    isAndroidChromeNativeInputSuppressed || mobileCustomKeyboardEnabled;
  const keyboardButtonLabel = isAndroidChromeNativeInputSuppressed
    ? "Open custom terminal keyboard"
    : "Open mobile keyboard";
  const keyboardButtonText = shouldUseCustomKeyboard ? "Type" : "Kbd";
  useEffect(() => {
    if (shouldUseCustomKeyboard) keyboardInputRef.current?.blur();
  }, [shouldUseCustomKeyboard]);
  const focusInvokingControl = useCallback(() => {
    requestAnimationFrame(() => {
      const button =
        invokingControlRef.current === "keys"
          ? keysButtonRef.current
          : keyboardButtonRef.current;
      button?.focus();
    });
  }, []);

  const dismissPanels = useCallback(() => {
    setIsExpanded(false);
    setIsKeyboardOpen(false);
    focusInvokingControl();
  }, [focusInvokingControl]);
  const dismissPanelsWithoutFocus = useCallback(() => {
    setIsExpanded(false);
    setIsKeyboardOpen(false);
  }, []);

  const handlePress = useCallback(
    (id: MobileTerminalKeyId) => {
      const sequence = getMobileTerminalKeySequence(id);
      if (sequence) getTransport().terminalWrite(sessionId, sequence);
    },
    [sessionId],
  );

  const toggleKeyboard = useCallback(() => {
    invokingControlRef.current = "keyboard";
    setIsKeyboardOpen((current) => {
      const next = !current;
      requestAnimationFrame(() => {
        if (next && !shouldUseCustomKeyboard) {
          keyboardInputRef.current?.focus();
        } else {
          keyboardInputRef.current?.blur();
        }
      });
      return next;
    });
  }, [shouldUseCustomKeyboard]);

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
      if (appended) getTransport().terminalWrite(sessionId, appended);
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
      } else if (event.key === "Enter") {
        event.preventDefault();
        getTransport().terminalWrite(sessionId, "\r");
        keyboardValueRef.current = "";
        event.currentTarget.value = "";
      }
    },
    [sessionId],
  );

  const toggleKeys = useCallback(() => {
    invokingControlRef.current = "keys";
    setIsExpanded((current) => !current);
  }, []);
  const keyboardPanel = shouldUseCustomKeyboard ? (
    <MobileTerminalCustomKeyboard
      isShiftActive={isShiftActive}
      isCtrlActive={isCtrlActive}
      isSymbolLayer={isSymbolLayer}
      onPress={handleCustomKeyPress}
    />
  ) : (
    <MobileTerminalNativeKeyboardInput
      inputRef={keyboardInputRef}
      onChange={handleKeyboardInput}
      onKeyDown={handleKeyboardKeyDown}
    />
  );
  const controlId = `terminal-accessory-${useId().replaceAll(":", "")}`;
  const keysPanelId = `${controlId}-keys-panel`;
  const keyboardPanelId = `${controlId}-keyboard-panel`;
  const guardPanelPointer = useCallback(
    (
      event:
        | React.MouseEvent<HTMLDivElement>
        | React.PointerEvent<HTMLDivElement>,
    ) => {
      if (event.target instanceof HTMLInputElement) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  return (
    <div className="relative w-full shrink-0">
      <TerminalFloatingControlShell
        sessionId={sessionId}
        className={className}
        isOpen={isExpanded || isKeyboardOpen}
        outsideRefs={outsideRefs}
        onDismiss={dismissPanelsWithoutFocus}
        onEscape={dismissPanels}
      >
        <TerminalAccessoryControls
          isExpanded={isExpanded}
          isKeyboardOpen={isKeyboardOpen}
          keyboardButtonLabel={keyboardButtonLabel}
          keyboardButtonText={keyboardButtonText}
          keysButtonRef={keysButtonRef}
          keyboardButtonRef={keyboardButtonRef}
          onToggleKeys={toggleKeys}
          onToggleKeyboard={toggleKeyboard}
          keysPanelId={keysPanelId}
          keyboardPanelId={keyboardPanelId}
        />
      </TerminalFloatingControlShell>

      {isKeyboardOpen || isExpanded ? (
        <div
          ref={panelRef}
          data-testid="mobile-terminal-accessory-panel"
          className="safe-area-inline safe-area-bottom pointer-events-auto flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto border-t border-[var(--color-border)] bg-[var(--color-surface)]/96 p-1 pt-1 backdrop-blur-md"
          onMouseDown={guardPanelPointer}
          onPointerDown={guardPanelPointer}
          onClick={(event) => {
            if (event.target instanceof HTMLInputElement) {
              event.stopPropagation();
              return;
            }
            event.stopPropagation();
          }}
        >
          {isKeyboardOpen ? (
            <div id={keyboardPanelId} className="min-w-0 shrink-0">
              {keyboardPanel}
            </div>
          ) : null}
          {isExpanded ? (
            <div id={keysPanelId} className="min-w-0 shrink-0">
              <MobileTerminalSpecialKeys onPress={handlePress} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
