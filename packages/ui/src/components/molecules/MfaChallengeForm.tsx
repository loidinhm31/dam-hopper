import { useState, useEffect, useRef, type FormEvent } from "react";
import QRCode from "react-qr-code";
import { Check, Copy, KeyRound, QrCode as QrIcon } from "lucide-react";
import type { MfaSetupResponse } from "@/api/auth-types.js";

export interface MfaChallengeFormProps {
  mode: "enrollment" | "verification";
  setupData?: MfaSetupResponse | null;
  loading?: boolean;
  submitting?: boolean;
  error?: string | null;
  retryAfter?: number;
  onCodeSubmit: (code: string) => void | Promise<void>;
  onCancel?: () => void;
  className?: string;
}

export function MfaChallengeForm({
  mode,
  setupData,
  loading = false,
  submitting = false,
  error = null,
  retryAfter,
  onCodeSubmit,
  onCancel,
  className = "",
}: MfaChallengeFormProps) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showManualKey, setShowManualKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | number | null>(null);

  // Focus input on mount or mode change
  useEffect(() => {
    inputRef.current?.focus();
    return () => {
      clearTimeout(copyTimeoutRef.current ?? undefined);
    };
  }, [mode]);

  // Reset code when setupData or mode changes
  useEffect(() => {
    setCode("");
  }, [mode, setupData?.secret]);

  const handleCopySecret = async () => {
    if (!setupData?.secret) return;
    try {
      clearTimeout(copyTimeoutRef.current ?? undefined);
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(setupData.secret);
      } else {
        // Fallback for environments lacking clipboard API
        const textArea = document.createElement("textarea");
        textArea.value = setupData.secret;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      setCopied(true);
      setCopyFailed(false);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
      setCopied(false);
    }
  };

  const handleCodeChange = (raw: string) => {
    // Keep only numeric characters, preserve leading zeros
    const digitsOnly = raw.replace(/\D/g, "");
    const maxDigits = setupData?.digits ?? 6;
    setCode(digitsOnly.slice(0, maxDigits));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const expectedDigits = setupData?.digits ?? 6;
    if (code.length === expectedDigits && !submitting && !loading) {
      void onCodeSubmit(code);
    }
  };

  const expectedDigits = setupData?.digits ?? 6;
  const isSubmitDisabled =
    code.length !== expectedDigits || submitting || loading || Boolean(retryAfter && retryAfter > 0);

  return (
    <div
      className={`space-y-4 text-xs text-[var(--color-text)] ${className}`}
      data-auth-container="true"
    >
      {/* Mode Header */}
      <div>
        <h4 className="font-semibold text-sm text-[var(--color-text-strong)]">
          {mode === "enrollment"
            ? "Set Up Two-Factor Authentication"
            : "Two-Factor Authentication Required"}
        </h4>
        <p className="text-[var(--color-text-muted)] mt-1">
          {mode === "enrollment"
            ? "Scan the QR code with your authenticator app (e.g. Google Authenticator, 1Password, Authy), or enter the setup key manually."
            : "Enter the verification code from your authenticator app to continue."}
        </p>
      </div>

      {/* Enrollment QR & Setup Key */}
      {mode === "enrollment" && setupData && (
        <div className="space-y-3 rounded-lg border border-[var(--color-border)]/60 bg-[var(--color-surface-2)] p-3">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {/* QR Code Container */}
            <div
              className="bg-white p-2 rounded-md shadow-xs shrink-0 flex items-center justify-center"
              data-testid="mfa-qr-code"
              aria-label="Authenticator QR Code"
            >
              <QRCode
                value={setupData.otpauthUri}
                size={132}
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>

            {/* Setup Metadata & Toggle */}
            <div className="min-w-0 flex-1 space-y-1.5 w-full">
              <div className="text-[11px] text-[var(--color-text-muted)]">
                <span className="font-medium text-[var(--color-text)]">Account: </span>
                {setupData.accountName}
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)]">
                <span className="font-medium text-[var(--color-text)]">Issuer: </span>
                {setupData.issuer}
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)]">
                <span className="font-medium text-[var(--color-text)]">Time step: </span>
                {setupData.period} seconds ({setupData.digits} digits)
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowManualKey((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--color-primary)] hover:underline"
                >
                  <KeyRound size={12} />
                  {showManualKey ? "Hide manual setup key" : "Can't scan? Show setup key"}
                </button>
              </div>
            </div>
          </div>

          {/* Manual Key Section */}
          {showManualKey && (
            <div className="pt-2 border-t border-[var(--color-border)]/40 space-y-1.5">
              <label
                htmlFor="mfa-manual-key"
                className="block text-[11px] font-medium text-[var(--color-text-muted)]"
              >
                Manual setup key (Base32):
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="mfa-manual-key"
                  type="text"
                  readOnly
                  value={setupData.secret}
                  className="font-mono text-xs px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] select-all w-full"
                  data-auth-input="true"
                />
                <button
                  type="button"
                  onClick={handleCopySecret}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-3)] text-xs border border-[var(--color-border)] font-medium transition-colors shrink-0"
                  title="Copy secret key"
                >
                  {copied ? (
                    <>
                      <Check size={12} className="text-[var(--color-success)]" />
                      <span className="text-[var(--color-success)]">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy key</span>
                    </>
                  )}
                </button>
              </div>
              {copyFailed && (
                <p className="text-[11px] text-amber-400">
                  Could not copy automatically. Please select and copy the text manually.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Code Input Form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label
            htmlFor="mfa-code-input"
            className="block font-medium text-[var(--color-text-strong)]"
          >
            {mode === "enrollment" ? "Confirmation Code" : "Verification Code"}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="mfa-code-input"
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={expectedDigits}
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="000000"
              disabled={submitting || loading}
              className="w-40 px-3 py-1.5 text-center font-mono text-base tracking-widest rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] focus:outline-hidden focus:border-[var(--color-primary)] transition-colors"
              data-auth-input="true"
              autoFocus
            />
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {expectedDigits} digits
            </span>
          </div>
        </div>

        {/* Error / Rate limit display */}
        {error && (
          <div
            className="p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs"
            role="alert"
          >
            {error}
          </div>
        )}

        {retryAfter !== undefined && retryAfter > 0 && (
          <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
            Too many attempts. Please wait {retryAfter}s before retrying.
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-3 py-1.5 rounded text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting ? (
              <span>Submitting...</span>
            ) : mode === "enrollment" ? (
              <span>Confirm & Enroll</span>
            ) : (
              <span>Verify & Continue</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
