import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/Dialog.js";
import { Input } from "@/components/ui/Input.js";
import { Label } from "@/components/ui/Label.js";
import { Button } from "@/components/atoms/Button.js";
import { useLockScreenStore } from "@/stores/lock-screen.js";
import { Lock, ShieldAlert, KeyRound, AlertCircle } from "lucide-react";

export type PinDialogMode = "setup" | "change" | "remove";

export interface PinSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: PinDialogMode;
  onSuccess?: () => void;
}

export function PinSetupDialog({
  open,
  onOpenChange,
  mode: propMode,
  onSuccess,
}: PinSetupDialogProps): React.JSX.Element {
  const hasPin = useLockScreenStore((state) => state.hasPin);
  const setPin = useLockScreenStore((state) => state.setPin);
  const changePin = useLockScreenStore((state) => state.changePin);
  const removePin = useLockScreenStore((state) => state.removePin);

  // Freeze effectiveMode for the open dialog session so mid-operation store changes don't disrupt it
  const [sessionMode, setSessionMode] = useState<PinDialogMode>(
    () => propMode ?? (hasPin ? "change" : "setup"),
  );

  const [currentPin, setCurrentPin] = useState<string>("");
  const [newPin, setNewPin] = useState<string>("");
  const [confirmPin, setConfirmPin] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const isSubmittingRef = useRef<boolean>(false);
  const submissionGenerationRef = useRef<number>(0);

  // Re-establish session mode and reset inputs whenever dialog opens or propMode changes
  const resetForm = useCallback(() => {
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setErrorMessage(null);
    setIsSubmitting(false);
    isSubmittingRef.current = false;
    submissionGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    if (open) {
      setSessionMode(propMode ?? (useLockScreenStore.getState().hasPin ? "change" : "setup"));
    }
    resetForm();
  }, [open, propMode, resetForm]);

  // Invalidate in-flight operations on unmount
  useEffect(() => {
    return () => {
      submissionGenerationRef.current += 1;
      isSubmittingRef.current = false;
    };
  }, []);

  const effectiveMode = propMode ?? sessionMode;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Immediate synchronous in-flight guard prevents multiple submissions in same event turn
    if (isSubmittingRef.current || isSubmitting) return;

    setErrorMessage(null);

    // Validate current PIN if required
    if (effectiveMode === "change" || effectiveMode === "remove") {
      if (!currentPin) {
        setErrorMessage("Current PIN is required.");
        return;
      }
    }

    // Validate new PIN if required
    if (effectiveMode === "setup" || effectiveMode === "change") {
      if (!newPin) {
        setErrorMessage("New PIN is required.");
        return;
      }
      if (!/^\d+$/.test(newPin)) {
        setErrorMessage("PIN must contain only numbers.");
        return;
      }
      if (newPin.length < 4 || newPin.length > 8) {
        setErrorMessage("PIN must be between 4 and 8 digits.");
        return;
      }
      if (newPin !== confirmPin) {
        setErrorMessage("PINs do not match.");
        return;
      }
    }

    isSubmittingRef.current = true;
    const currentGeneration = ++submissionGenerationRef.current;
    setIsSubmitting(true);

    try {
      if (effectiveMode === "setup") {
        await setPin(newPin);
        if (submissionGenerationRef.current !== currentGeneration) return;
        onSuccess?.();
        onOpenChange(false);
      } else if (effectiveMode === "change") {
        const success = await changePin(currentPin, newPin);
        if (submissionGenerationRef.current !== currentGeneration) return;
        if (success) {
          onSuccess?.();
          onOpenChange(false);
        } else {
          setErrorMessage("Current PIN is incorrect.");
        }
      } else if (effectiveMode === "remove") {
        const success = await removePin(currentPin);
        if (submissionGenerationRef.current !== currentGeneration) return;
        if (success) {
          onSuccess?.();
          onOpenChange(false);
        } else {
          setErrorMessage("Current PIN is incorrect.");
        }
      }
    } catch (err) {
      if (submissionGenerationRef.current !== currentGeneration) return;
      const msg = err instanceof Error ? err.message : "Failed to update PIN";
      setErrorMessage(msg);
    } finally {
      if (submissionGenerationRef.current === currentGeneration) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const getTitle = () => {
    switch (effectiveMode) {
      case "setup":
        return "Set Up Screen Lock PIN";
      case "change":
        return "Change Screen Lock PIN";
      case "remove":
        return "Remove Screen Lock PIN";
    }
  };

  const getDescription = () => {
    switch (effectiveMode) {
      case "setup":
        return "Create a numeric PIN (4–8 digits) to quickly lock your DamHopper OS screen.";
      case "change":
        return "Enter your current PIN, then choose and confirm your new numeric PIN.";
      case "remove":
        return "Enter your current PIN to remove screen locking from this browser.";
    }
  };

  const getSubmitLabel = () => {
    if (isSubmitting) return "Saving...";
    switch (effectiveMode) {
      case "setup":
        return "Set PIN";
      case "change":
        return "Change PIN";
      case "remove":
        return "Remove PIN";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="pin-setup-dialog">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center">
                {effectiveMode === "remove" ? (
                  <ShieldAlert className="w-4 h-4 text-[var(--color-danger)]" />
                ) : (
                  <KeyRound className="w-4 h-4" />
                )}
              </div>
              <DialogTitle>{getTitle()}</DialogTitle>
            </div>
            <DialogDescription>{getDescription()}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Current PIN field */}
            {(effectiveMode === "change" || effectiveMode === "remove") && (
              <div className="space-y-1.5">
                <Label htmlFor="current-pin">Current PIN</Label>
                <Input
                  id="current-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={currentPin}
                  onChange={(e) => {
                    setCurrentPin(e.target.value.replace(/\D/g, ""));
                    setErrorMessage(null);
                  }}
                  placeholder="Enter current PIN"
                  autoComplete="current-password"
                  autoFocus
                  disabled={isSubmitting}
                />
              </div>
            )}

            {/* New PIN & Confirm PIN fields */}
            {(effectiveMode === "setup" || effectiveMode === "change") && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="new-pin">New PIN (4–8 digits)</Label>
                  <Input
                    id="new-pin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={8}
                    value={newPin}
                    onChange={(e) => {
                      setNewPin(e.target.value.replace(/\D/g, ""));
                      setErrorMessage(null);
                    }}
                    placeholder="Enter 4–8 digits"
                    autoComplete="new-password"
                    autoFocus={effectiveMode === "setup"}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm-pin">Confirm New PIN</Label>
                  <Input
                    id="confirm-pin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={8}
                    value={confirmPin}
                    onChange={(e) => {
                      setConfirmPin(e.target.value.replace(/\D/g, ""));
                      setErrorMessage(null);
                    }}
                    placeholder="Re-enter new PIN"
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                </div>
              </>
            )}

            {/* Error Message */}
            {errorMessage && (
              <div
                role="alert"
                className="flex items-center gap-2 p-2.5 rounded text-xs bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/20"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Honest Labeling Disclaimer */}
            <div className="flex items-start gap-2 p-2.5 rounded bg-[var(--color-surface-2)]/60 text-[var(--color-text-muted)] text-xs border border-[var(--color-border)]">
              <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Stored locally in this browser for quick screen locking. Not a
                replacement for server authentication.
              </span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={effectiveMode === "remove" ? "danger" : "primary"}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              {getSubmitLabel()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
