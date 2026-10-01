import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useSettingsStore } from "@/stores/settings.js";
import { displayShortcut } from "@/lib/shortcuts.js";
import { cn } from "@/lib/utils.js";
const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function CognitoModeOverlay(): React.JSX.Element | null {
  const active = useCognitoModeStore((state) => state.active);
  const activationShortcut = useCognitoModeStore(
    (state) => state.activationShortcut,
  );
  const style = useSettingsStore((state) => state.cognitoModeStyle);
  const overlayRef = useRef<HTMLDivElement>(null);

  useClientLayoutEffect(() => {
    if (active) {
      overlayRef.current?.focus({ preventScroll: true });
    }
  }, [active]);

  if (!active || typeof document === "undefined") {
    return null;
  }

  const formattedShortcut = activationShortcut
    ? displayShortcut(activationShortcut)
    : "";
  const accessibleDescription = formattedShortcut
    ? `Cognito privacy mode is active. Screen is masked. Press ${formattedShortcut} to dismiss.`
    : "Cognito privacy mode is active. Screen is masked.";

  return createPortal(
    <div
      ref={overlayRef}
      data-cognito-mode-overlay=""
      tabIndex={-1}
      role="region"
      aria-label="Cognito privacy mode"
      aria-description={accessibleDescription}
      className={cn("cognito-mode-overlay", `cognito-mode-overlay--${style}`)}
    >
      <span className="sr-only">{accessibleDescription}</span>
    </div>,
    document.body,
  );
}
