import * as React from "react";
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Lock, Delete } from "lucide-react";
import { useLockScreenStore } from "@/stores/lock-screen.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useSettingsStore } from "@/stores/settings.js";
import { matchesKeyboardShortcut, DEFAULT_COGNITO_MODE_SHORTCUT } from "@/lib/shortcuts.js";
import { cn } from "@/lib/utils.js";

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function formatLockTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function formatLockDate(date: Date): string {
  return date
    .toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
}

export interface LockScreenOverlayProps {
  transitionDurationMs?: number;
}

export function LockScreenOverlay({
  transitionDurationMs = 150,
}: LockScreenOverlayProps = {}): React.JSX.Element | null {
  const isLocked = useLockScreenStore((state) => state.isLocked);
  const pinLength = useLockScreenStore((state) => state.pinLength);
  const cooldownUntil = useLockScreenStore((state) => state.cooldownUntil);
  const verifyAndUnlock = useLockScreenStore((state) => state.verifyAndUnlock);

  // Maintain local presentation state
  const [isPresented, setIsPresented] = useState<boolean>(() => isLocked);
  const [isDismissing, setIsDismissing] = useState<boolean>(false);
  const [enteredPin, setEnteredPin] = useState<string>("");
  const [isShaking, setIsShaking] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<Date>(() => new Date());
  const [now, setNow] = useState<number>(() => Date.now());
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const enteredPinRef = useRef<string>("");
  const inFlightRef = useRef<boolean>(false);
  const lockSessionRef = useRef<number>(0);
  const consumedPhysicalCodesRef = useRef<Set<string>>(new Set());
  const priorFocusedElementRef = useRef<HTMLElement | null>(null);
  const shakeTimerRef = useRef<number | null>(null);
  const dismissTimerRef = useRef<number | null>(null);

  // Trailing release guard refs
  const trailingGuardInstalledRef = useRef<boolean>(false);

  // Derive effective cooldown based on timestamp deadline
  const isEffectiveCooldown = Boolean(cooldownUntil && cooldownUntil > now);
  const remainingCooldownSeconds =
    isEffectiveCooldown && cooldownUntil
      ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
      : 0;

  const removeTrailingGuard = useCallback(() => {
    if (trailingGuardInstalledRef.current && typeof window !== "undefined") {
      window.removeEventListener("keydown", onTrailingKeyDown, true);
      window.removeEventListener("keyup", onTrailingKeyUp, true);
      window.removeEventListener("blur", onTrailingBlur, true);
      trailingGuardInstalledRef.current = false;
    }
  }, []);

  const onTrailingKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.code && consumedPhysicalCodesRef.current.has(e.code)) {
      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, []);

  const onTrailingKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code && consumedPhysicalCodesRef.current.has(e.code)) {
      consumedPhysicalCodesRef.current.delete(e.code);
      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
      if (consumedPhysicalCodesRef.current.size === 0) {
        removeTrailingGuard();
      }
    }
  }, [removeTrailingGuard]);

  const onTrailingBlur = useCallback(() => {
    consumedPhysicalCodesRef.current.clear();
    removeTrailingGuard();
  }, [removeTrailingGuard]);

  const installTrailingGuard = useCallback(() => {
    if (
      !trailingGuardInstalledRef.current &&
      consumedPhysicalCodesRef.current.size > 0 &&
      typeof window !== "undefined"
    ) {
      window.addEventListener("keydown", onTrailingKeyDown, true);
      window.addEventListener("keyup", onTrailingKeyUp, true);
      window.addEventListener("blur", onTrailingBlur, true);
      trailingGuardInstalledRef.current = true;
    }
  }, [onTrailingKeyDown, onTrailingKeyUp, onTrailingBlur]);

  // Invalidate all pending operations and timers on unmount
  useEffect(() => {
    return () => {
      lockSessionRef.current += 1;
      if (shakeTimerRef.current !== null) {
        window.clearTimeout(shakeTimerRef.current);
      }
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
      }
      removeTrailingGuard();
      consumedPhysicalCodesRef.current.clear();
    };
  }, [removeTrailingGuard]);

  // Synchronize presentation state with store lock changes (handles both lock and external unlock)
  useEffect(() => {
    if (isLocked) {
      lockSessionRef.current += 1;
      setIsPresented(true);
      setIsDismissing(false);
      enteredPinRef.current = "";
      setEnteredPin("");
      setIsShaking(false);
      setErrorMessage(null);
      inFlightRef.current = false;
      setIsVerifying(false);
      removeTrailingGuard();
    } else if (!inFlightRef.current) {
      // External unlock: dismiss immediately
      lockSessionRef.current += 1;
      setIsPresented(false);
      setIsDismissing(false);
      enteredPinRef.current = "";
      setEnteredPin("");
      setIsShaking(false);
      setErrorMessage(null);
      inFlightRef.current = false;
      setIsVerifying(false);
      removeTrailingGuard();
      consumedPhysicalCodesRef.current.clear();
    }
  }, [isLocked, removeTrailingGuard]);

  // Update clock and cooldown timers every second when presented
  useEffect(() => {
    if (!isPresented) return;

    const interval = window.setInterval(() => {
      const current = new Date();
      setCurrentTime(current);
      setNow(current.getTime());
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isPresented]);

  // Focus management: initial focus & focus recovery on Cognito change
  useClientLayoutEffect(() => {
    if (!isPresented || isDismissing) return;

    if (!useCognitoModeStore.getState().active) {
      priorFocusedElementRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      overlayRef.current?.focus({ preventScroll: true });
    }

    const unsubCognito = useCognitoModeStore.subscribe((state, prev) => {
      if (prev.active && !state.active && !isDismissing) {
        overlayRef.current?.focus({ preventScroll: true });
      }
    });

    return () => {
      unsubCognito();
    };
  }, [isPresented, isDismissing]);

  // Handle Tab focus trap inside overlay
  const handleTabFocusTrap = useCallback((e: KeyboardEvent) => {
    if (!overlayRef.current) return;
    const focusableElements = Array.from(
      overlayRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])',
      ),
    );

    if (focusableElements.length === 0) {
      overlayRef.current.focus({ preventScroll: true });
      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const currentActive = document.activeElement;

    if (e.shiftKey) {
      if (
        currentActive === firstElement ||
        currentActive === overlayRef.current ||
        !overlayRef.current.contains(currentActive)
      ) {
        lastElement.focus();
        if (e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
      }
    } else {
      if (
        currentActive === lastElement ||
        !overlayRef.current.contains(currentActive)
      ) {
        firstElement.focus();
        if (e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
  }, []);

  // Focus recovery for programmatic focus escape
  useEffect(() => {
    if (!isPresented || isDismissing) return;

    const onFocusIn = (e: FocusEvent) => {
      if (useCognitoModeStore.getState().active) return;
      if (
        overlayRef.current &&
        e.target instanceof Node &&
        !overlayRef.current.contains(e.target)
      ) {
        e.preventDefault();
        overlayRef.current.focus({ preventScroll: true });
      }
    };

    window.addEventListener("focusin", onFocusIn, true);
    return () => {
      window.removeEventListener("focusin", onFocusIn, true);
    };
  }, [isPresented, isDismissing]);

  // Submit PIN helper with generation fence
  const submitPin = useCallback(
    async (pinToVerify: string) => {
      if (inFlightRef.current || isVerifying) return;
      const session = lockSessionRef.current;
      inFlightRef.current = true;
      setIsVerifying(true);

      try {
        const success = await verifyAndUnlock(pinToVerify);
        if (session !== lockSessionRef.current) return;

        if (success) {
          setIsDismissing(true);

          dismissTimerRef.current = window.setTimeout(() => {
            if (session !== lockSessionRef.current) return;
            setIsPresented(false);
            setIsDismissing(false);
            inFlightRef.current = false;
            setIsVerifying(false);
            enteredPinRef.current = "";
            setEnteredPin("");

            // Activate trailing guard if keys are still held
            installTrailingGuard();

            // Safe focus restoration
            if (
              !useCognitoModeStore.getState().active &&
              !useLockScreenStore.getState().isLocked &&
              priorFocusedElementRef.current &&
              document.body.contains(priorFocusedElementRef.current)
            ) {
              try {
                priorFocusedElementRef.current.focus({ preventScroll: true });
              } catch {
                // Focus recovery failed
              }
            }
          }, transitionDurationMs);
        } else {
          // Verification failed
          setIsShaking(true);
          setErrorMessage("Incorrect PIN");
          enteredPinRef.current = "";
          setEnteredPin("");

          shakeTimerRef.current = window.setTimeout(() => {
            if (session !== lockSessionRef.current) return;
            setIsShaking(false);
            inFlightRef.current = false;
            setIsVerifying(false);
          }, 380);
        }
      } catch {
        if (session !== lockSessionRef.current) return;
        setIsShaking(true);
        setErrorMessage("Unlock failed");
        enteredPinRef.current = "";
        setEnteredPin("");
        inFlightRef.current = false;
        setIsVerifying(false);
      }
    },
    [verifyAndUnlock, transitionDurationMs, isVerifying, installTrailingGuard],
  );

  const handleAppendDigit = useCallback(
    (digit: string) => {
      if (
        isEffectiveCooldown ||
        inFlightRef.current ||
        isVerifying ||
        isDismissing
      ) {
        return;
      }
      if (enteredPinRef.current.length >= pinLength) return;

      const next = enteredPinRef.current + digit;
      enteredPinRef.current = next;
      setErrorMessage(null);
      setEnteredPin(next);

      if (next.length === pinLength) {
        void submitPin(next);
      }
    },
    [isEffectiveCooldown, isVerifying, isDismissing, pinLength, submitPin],
  );

  const handleBackspace = useCallback(() => {
    if (
      isEffectiveCooldown ||
      inFlightRef.current ||
      isVerifying ||
      isDismissing
    ) {
      return;
    }
    const next = enteredPinRef.current.slice(0, -1);
    enteredPinRef.current = next;
    setErrorMessage(null);
    setEnteredPin(next);
  }, [isEffectiveCooldown, isVerifying, isDismissing]);

  const handleClear = useCallback(() => {
    if (
      isEffectiveCooldown ||
      inFlightRef.current ||
      isVerifying ||
      isDismissing
    ) {
      return;
    }
    enteredPinRef.current = "";
    setErrorMessage(null);
    setEnteredPin("");
  }, [isEffectiveCooldown, isVerifying, isDismissing]);

  // Window capture-phase event interception while presented
  useEffect(() => {
    if (!isPresented) return;

    const isCognitoChordOrActive = (e: KeyboardEvent): boolean => {
      const { active: cognitoActive, activationShortcut } =
        useCognitoModeStore.getState();
      const cognitoShortcut =
        activationShortcut ??
        useSettingsStore.getState().cognitoModeShortcut ??
        DEFAULT_COGNITO_MODE_SHORTCUT;

      return (
        cognitoActive ||
        matchesKeyboardShortcut(cognitoShortcut, {
          type: e.type,
          code: e.code,
          key: e.key,
          ctrlKey: Boolean(e.ctrlKey),
          metaKey: Boolean(e.metaKey),
          altKey: Boolean(e.altKey),
          shiftKey: Boolean(e.shiftKey),
          repeat: Boolean(e.repeat),
          isComposing: Boolean(e.isComposing),
          keyCode: e.keyCode,
        })
      );
    };

    const onCaptureKeyDown = (e: KeyboardEvent) => {
      if (isCognitoChordOrActive(e)) {
        return;
      }

      if (e.code) {
        consumedPhysicalCodesRef.current.add(e.code);
      }

      if (e.key === "Tab") {
        handleTabFocusTrap(e);
        return;
      }

      if (
        isEffectiveCooldown ||
        inFlightRef.current ||
        isVerifying ||
        isDismissing
      ) {
        if (e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (/^[0-9]$/.test(e.key)) {
        if (e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
        handleAppendDigit(e.key);
        return;
      }

      if (e.key === "Backspace") {
        if (e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
        handleBackspace();
        return;
      }

      if (e.key === "Escape") {
        if (e.cancelable) e.preventDefault();
        e.stopImmediatePropagation();
        handleClear();
        return;
      }

      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
    };

    const onCaptureKeyUp = (e: KeyboardEvent) => {
      if (isCognitoChordOrActive(e)) {
        return;
      }

      if (e.code && consumedPhysicalCodesRef.current.has(e.code)) {
        consumedPhysicalCodesRef.current.delete(e.code);
      }

      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
    };

    const onCaptureKeyPress = (e: KeyboardEvent) => {
      if (isCognitoChordOrActive(e)) {
        return;
      }

      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
    };

    window.addEventListener("keydown", onCaptureKeyDown, true);
    window.addEventListener("keyup", onCaptureKeyUp, true);
    window.addEventListener("keypress", onCaptureKeyPress, true);

    return () => {
      window.removeEventListener("keydown", onCaptureKeyDown, true);
      window.removeEventListener("keyup", onCaptureKeyUp, true);
      window.removeEventListener("keypress", onCaptureKeyPress, true);
    };
  }, [
    isPresented,
    isDismissing,
    isEffectiveCooldown,
    isVerifying,
    handleAppendDigit,
    handleBackspace,
    handleClear,
    handleTabFocusTrap,
  ]);

  if (!isPresented || typeof document === "undefined") {
    return null;
  }

  const timeFormatted = formatLockTime(currentTime);
  const dateFormatted = formatLockDate(currentTime);

  const keyPadDisabled =
    isEffectiveCooldown || inFlightRef.current || isVerifying || isDismissing;

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Lock Screen"
      tabIndex={-1}
      data-lock-screen-overlay=""
      data-testid="lock-screen-overlay"
      data-dismissing={isDismissing ? "true" : "false"}
      className={cn(
        "fixed inset-0 z-[9990] flex flex-col items-center justify-between p-6 sm:p-10 select-none",
        "bg-[var(--color-bg,var(--color-background))] backdrop-blur-xl text-[var(--color-text)]",
        "transition-opacity duration-150 outline-none pointer-events-auto",
        isDismissing ? "opacity-0" : "opacity-100",
      )}
    >
      {/* Decorative subtle hologram background (isolated from dialog boundary to prevent mask clipping) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 os-hologram-bg os-hologram-grid opacity-75"
      />

      {/* Top Section: Digital Clock & Date */}
      <header className="relative z-10 flex flex-col items-center pt-8 sm:pt-12">
        <h1
          data-testid="lock-clock"
          className="text-6xl sm:text-7xl font-mono font-light tracking-tight text-[var(--color-text)]"
        >
          {timeFormatted}
        </h1>
        <p
          data-testid="lock-date"
          className="mt-2 text-xs sm:text-sm font-semibold tracking-widest text-[var(--color-text-muted)] uppercase"
        >
          {dateFormatted}
        </p>
      </header>

      {/* Middle Section: Lock Identity, PIN Dots & Status */}
      <main className="relative z-10 flex flex-col items-center gap-4 my-auto">
        <div className="w-14 h-14 rounded-full flex items-center justify-center bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] shadow-sm">
          <Lock className="w-6 h-6 text-[var(--color-primary)]" />
        </div>

        <div className="text-center">
          <h2 className="text-base font-medium text-[var(--color-text)]">
            DamHopper OS
          </h2>
          <p
            id="lock-screen-status"
            className={cn(
              "text-xs mt-1 transition-colors",
              isEffectiveCooldown || errorMessage
                ? "text-[var(--color-danger)] font-medium"
                : "text-[var(--color-text-muted)]",
            )}
            role="status"
            aria-live="polite"
          >
            {isEffectiveCooldown
              ? `Too many failed attempts. Try again in ${remainingCooldownSeconds}s`
              : errorMessage
                ? errorMessage
                : "Enter PIN to unlock"}
          </p>
        </div>

        {/* PIN Dots */}
        <div
          data-testid="lock-pin-dots"
          aria-label={`PIN entry: ${enteredPin.length} of ${pinLength} digits entered`}
          className={cn(
            "flex items-center gap-3 py-2",
            isShaking && "os-lock-shake",
          )}
        >
          {Array.from({ length: pinLength }).map((_, index) => {
            const isFilled = index < enteredPin.length;
            return (
              <span
                key={index}
                data-pin-dot=""
                data-pin-filled={isFilled ? "true" : "false"}
                className={cn(
                  "w-3.5 h-3.5 rounded-full transition-all duration-150",
                  isFilled
                    ? "bg-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/40 scale-110"
                    : "border-2 border-[var(--color-border)] bg-[var(--color-surface-2)]",
                )}
              />
            );
          })}
        </div>
      </main>

      {/* Bottom Section: 3x4 Numeric Keypad */}
      <footer className="relative z-10 w-full max-w-xs pb-4 sm:pb-8">
        <div className="grid grid-cols-3 gap-3 sm:gap-4 justify-items-center">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
            <button
              key={digit}
              type="button"
              aria-label={String(digit)}
              disabled={keyPadDisabled}
              onClick={() => handleAppendDigit(String(digit))}
              className={cn(
                "w-16 h-16 sm:w-18 sm:h-18 rounded-full text-xl font-medium",
                "flex items-center justify-center transition-all shadow-sm",
                "bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)] active:scale-95",
                "border border-[var(--color-border)] text-[var(--color-text)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                "disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100",
              )}
            >
              {digit}
            </button>
          ))}

          {/* CLR Button */}
          <button
            type="button"
            aria-label="Clear PIN"
            disabled={keyPadDisabled || enteredPin.length === 0}
            onClick={handleClear}
            className={cn(
              "w-16 h-16 sm:w-18 sm:h-18 rounded-full text-xs font-semibold uppercase tracking-wider",
              "flex items-center justify-center transition-all",
              "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] active:scale-95",
              "border border-transparent hover:border-[var(--color-border)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              "disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100",
            )}
          >
            CLR
          </button>

          {/* 0 Button */}
          <button
            type="button"
            aria-label="0"
            disabled={keyPadDisabled}
            onClick={() => handleAppendDigit("0")}
            className={cn(
              "w-16 h-16 sm:w-18 sm:h-18 rounded-full text-xl font-medium",
              "flex items-center justify-center transition-all shadow-sm",
              "bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)] active:scale-95",
              "border border-[var(--color-border)] text-[var(--color-text)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              "disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100",
            )}
          >
            0
          </button>

          {/* Backspace Button */}
          <button
            type="button"
            aria-label="Backspace"
            disabled={keyPadDisabled || enteredPin.length === 0}
            onClick={handleBackspace}
            className={cn(
              "w-16 h-16 sm:w-18 sm:h-18 rounded-full",
              "flex items-center justify-center transition-all",
              "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] active:scale-95",
              "border border-transparent hover:border-[var(--color-border)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
              "disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100",
            )}
          >
            <Delete className="w-5 h-5" />
          </button>
        </div>
      </footer>
    </div>,
    document.body,
  );
}
