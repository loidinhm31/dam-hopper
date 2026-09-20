import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  type Transport,
  getTransport,
} from "@/api/transport.js";
import {
  getConnectionSnapshot,
  getTransport as getConnectionTransport,
} from "@/api/connections.js";
import { parseTerminalKey, type TerminalRef } from "@/api/ownership.js";
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

const PANEL_SAFE_AREA_RIGHT = "max(0.5rem, var(--safe-area-right, 0px))";
const PANEL_MAX_HEIGHT =
  "min(20rem, calc(100dvh - 6rem - var(--safe-area-bottom, 0px)))";

export function MobileTerminalAccessoryBar({
  sessionId,
  profileId,
  terminalRef,
  className,
  onPanelOpenChange,
}: {
  sessionId: string;
  profileId?: string;
  terminalRef?: TerminalRef;
  className?: string;
  onPanelOpenChange?: (isOpen: boolean) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [isCtrlActive, setIsCtrlActive] = useState(false);
  const [isSymbolLayer, setIsSymbolLayer] = useState(false);
  const [isCapsActive, setIsCapsActive] = useState(false);
  const [isAltActive, setIsAltActive] = useState(false);
  const [isMetaActive, setIsMetaActive] = useState(false);
  const keysButtonRef = useRef<HTMLButtonElement>(null);
  const keyboardButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const outsideRefs = useMemo(() => [panelRef], []);
  const invokingControlRef = useRef<"keys" | "keyboard">("keys");
  const keyboardInputRef = useRef<HTMLInputElement>(null);
  const parsedRef = useMemo(
    () => terminalRef ?? parseTerminalKey(sessionId),
    [sessionId, terminalRef],
  );
  const safeSessionId = parsedRef?.id ?? sessionId;
  const ownerProfileId = parsedRef?.profileId ?? profileId;

  const writeTerminal = useCallback(
    (sequence: string) => {
      if (!sequence) return;
      let transport: Transport;
      if (ownerProfileId && getConnectionSnapshot(ownerProfileId)) {
        const snapshot = getConnectionSnapshot(ownerProfileId);
        if (snapshot?.status === "connected") {
          try {
            transport = getConnectionTransport(snapshot.owner);
          } catch {
            transport = getTransport();
          }
        } else {
          transport = getTransport();
        }
      } else {
        transport = getTransport();
      }
      transport.terminalWrite(safeSessionId, sequence);
    },
    [ownerProfileId, safeSessionId],
  );
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const mobileCustomKeyboardEnabled = useSettingsStore(
    (state) => state.mobileCustomKeyboardEnabled,
  );
  const shouldUseCustomKeyboard =
    isAndroidChromeNativeInputSuppressed || mobileCustomKeyboardEnabled;
  const keyboardButtonLabel = shouldUseCustomKeyboard
    ? "Open custom terminal keyboard"
    : "Open mobile keyboard";
  const keyboardButtonText = shouldUseCustomKeyboard ? "Type" : "Kbd";
  useEffect(() => {
    if (shouldUseCustomKeyboard) keyboardInputRef.current?.blur();
  }, [shouldUseCustomKeyboard]);
  useEffect(() => {
    onPanelOpenChange?.(isExpanded || isKeyboardOpen);
  }, [isExpanded, isKeyboardOpen, onPanelOpenChange]);

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
      if (sequence) writeTerminal(sequence);
    },
    [writeTerminal],
  );

  const toggleKeyboard = useCallback(() => {
    invokingControlRef.current = "keyboard";
    if (isKeyboardOpen) {
      keyboardInputRef.current?.blur();
      setIsKeyboardOpen(false);
      return;
    }
    if (shouldUseCustomKeyboard) {
      setIsKeyboardOpen(true);
      return;
    }
    flushSync(() => {
      setIsKeyboardOpen(true);
    });
    keyboardInputRef.current?.focus();
  }, [isKeyboardOpen, shouldUseCustomKeyboard]);

  const handleCustomKeyPress = useCallback(
    (key: CustomMobileTerminalKey) => {
      if (key.kind === "toggle") {
        if (key.toggle === "shift") setIsShiftActive((current) => !current);
        if (key.toggle === "ctrl") setIsCtrlActive((current) => !current);
        if (key.toggle === "caps") setIsCapsActive((current) => !current);
        if (key.toggle === "alt") setIsAltActive((current) => !current);
        if (key.toggle === "meta") setIsMetaActive((current) => !current);
        if (key.toggle === "symbols") setIsSymbolLayer((current) => !current);
        return;
      }

      const sequence = getCustomMobileTerminalKeySequence(key, {
        shift: isShiftActive,
        ctrl: isCtrlActive,
        caps: isCapsActive,
        alt: isAltActive,
        meta: isMetaActive,
      });
      if (sequence) writeTerminal(sequence);
      if (isShiftActive && key.kind === "text") setIsShiftActive(false);
      if (isCtrlActive && key.kind === "text") setIsCtrlActive(false);
      if (isAltActive && key.kind === "text") setIsAltActive(false);
      if (isMetaActive && key.kind === "text") setIsMetaActive(false);
    },
    [
      isAltActive,
      isCapsActive,
      isCtrlActive,
      isMetaActive,
      isShiftActive,
      writeTerminal,
    ],
  );

  const handleTerminalInput = useCallback(
    (sequence: string) => {
      if (sequence) writeTerminal(sequence);
    },
    [writeTerminal],
  );

  const toggleKeys = useCallback(() => {
    invokingControlRef.current = "keys";
    setIsExpanded((current) => !current);
  }, []);
  const keyboardPanel = shouldUseCustomKeyboard ? (
    <MobileTerminalCustomKeyboard
      isShiftActive={isShiftActive}
      isCtrlActive={isCtrlActive}
      isCapsActive={isCapsActive}
      isAltActive={isAltActive}
      isMetaActive={isMetaActive}
      isSymbolLayer={isSymbolLayer}
      onPress={handleCustomKeyPress}
    />
  ) : (
    <MobileTerminalNativeKeyboardInput
      inputRef={keyboardInputRef}
      onTerminalInput={handleTerminalInput}
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
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-native-keyboard-input]")) {
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
        sessionId={safeSessionId}
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
          className="safe-area-inline safe-area-bottom pointer-events-auto flex min-h-0 min-w-0 flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-contain border-t border-[var(--color-border)] bg-[var(--color-surface)]/96 p-1 pt-1 backdrop-blur-md"
          style={{
            paddingRight: PANEL_SAFE_AREA_RIGHT,
            maxHeight: PANEL_MAX_HEIGHT,
          }}
          onMouseDown={guardPanelPointer}
          onPointerDown={guardPanelPointer}
          onClick={(event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest?.("[data-native-keyboard-input]")) {
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
