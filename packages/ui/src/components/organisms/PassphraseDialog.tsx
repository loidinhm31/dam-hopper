import { useRef, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { cn } from "@/lib/utils.js";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";
import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap.js";

interface Props {
  open: boolean;
  onSubmit: (
    passphrase: string,
    keyPath: string | undefined,
    saveForLater: boolean,
  ) => void;
  onCancel: () => void;
  loading?: boolean;
  error?: string;
  availableKeys?: string[];
  keyOptions?: Array<{ value: string; label: string }>;
  title?: string;
  description?: string;
  submitLabel?: string;
  allowSaveForLater?: boolean;
  saveForLaterAuth?: "key" | "password" | "both";
  requireKeySelection?: boolean;
  passwordAuth?: {
    username: string;
    onSubmit: (
      username: string,
      password: string,
      rememberForDays: 0 | 30,
    ) => void;
  };
  defaultSaveForLater?: boolean;
}

export interface PassphraseDialogSubmission {
  passphrase: string;
  keyPath: string | undefined;
  saveForLater: boolean;
}

export function buildPassphraseDialogSubmission(
  passphrase: string,
  selectedKey: string,
  saveForLater: boolean,
): PassphraseDialogSubmission {
  return {
    passphrase,
    keyPath: selectedKey || undefined,
    saveForLater,
  };
}

export function PassphraseDialog({
  open,
  onSubmit,
  onCancel,
  loading = false,
  error,
  availableKeys = [],
  keyOptions,
  title = "SSH Key Passphrase",
  description = "Git could not authenticate with SSH. Enter the passphrase for the selected private key and retry. Leave blank if the key has no passphrase.",
  submitLabel = "Load Key & Retry",
  allowSaveForLater = true,
  saveForLaterAuth = "both",
  requireKeySelection = false,
  passwordAuth,
  defaultSaveForLater = false,
}: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [saveForLater, setSaveForLater] = useState(defaultSaveForLater);
  const [authMethod, setAuthMethod] = useState<"key" | "password">("key");
  const [username, setUsername] = useState(passwordAuth?.username ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const dialogRef = useDialogFocusTrap(open, loading, onCancel, inputRef);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (
      loading ||
      isAndroidChromeNativeInputSuppressed ||
      (authMethod === "key" && requireKeySelection && !selectedKey) ||
      (authMethod === "password" &&
        (!passwordAuth || !username.trim() || !passphrase))
    )
      return;
    if (authMethod === "password") {
      passwordAuth!.onSubmit(
        username.trim(),
        passphrase,
        saveForLater &&
          (saveForLaterAuth === "both" || saveForLaterAuth === authMethod)
          ? 30
          : 0,
      );
    } else {
      const submission = buildPassphraseDialogSubmission(
        passphrase,
        selectedKey,
        saveForLater,
      );
      onSubmit(
        submission.passphrase,
        submission.keyPath,
        submission.saveForLater &&
          (saveForLaterAuth === "both" || saveForLaterAuth === authMethod),
      );
    }
    setPassphrase("");
  }

  function handleCancel() {
    setPassphrase("");
    setSelectedKey("");
    setSaveForLater(false);
    setAuthMethod("key");
    setUsername(passwordAuth?.username ?? "");
    onCancel();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => !loading && handleCancel()}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="passphrase-dialog-title"
        aria-describedby={`passphrase-dialog-description${
          error ? " passphrase-dialog-error" : ""
        }`}
        className="relative z-10 w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl p-5"
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <KeyRound className="h-4 w-4 text-[var(--color-primary)] shrink-0" />
          <h2
            id="passphrase-dialog-title"
            className="text-sm font-semibold text-[var(--color-text)] flex-1"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            aria-label="Close SSH credential dialog"
            className="rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p
          id="passphrase-dialog-description"
          className="text-xs text-[var(--color-text-muted)] mb-4"
        >
          {description}
        </p>

        {isAndroidChromeNativeInputSuppressed && (
          <p
            role="note"
            id="passphrase-dialog-android-description"
            className="mb-3 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-xs text-amber-300"
          >
            Text entry and Load Key &amp; Retry are unavailable on Android
            Chrome. Use a desktop browser to provide a passphrase.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {passwordAuth ? (
            <div className="space-y-1">
              <label
                htmlFor="ssh-credential-auth-method"
                className="text-xs font-medium text-[var(--color-text-muted)]"
              >
                Authentication method
              </label>
              <select
                id="ssh-credential-auth-method"
                value={authMethod}
                onChange={(event) =>
                  setAuthMethod(event.target.value as "key" | "password")
                }
                disabled={loading}
                className={cn(inputClass, "pr-8")}
              >
                <option value="key">SSH key passphrase</option>
                <option value="password">Username and password</option>
              </select>
            </div>
          ) : null}

          {/* SSH key selector */}
          {authMethod === "key" &&
            (keyOptions !== undefined || availableKeys.length > 0) && (
              <div className="space-y-1">
                <label
                  htmlFor="ssh-credential-key"
                  className="text-xs font-medium text-[var(--color-text-muted)]"
                >
                  SSH Key
                </label>
                <select
                  id="ssh-credential-key"
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                  disabled={loading}
                  className={cn(inputClass, "pr-8")}
                >
                  <option value="">
                    {keyOptions !== undefined
                      ? keyOptions.length > 0
                        ? "Select a key"
                        : "No local encrypted keys found"
                      : `Default key${availableKeys[0] ? ` (first available: ~/.ssh/${availableKeys[0]})` : " (server auto-selects)"}`}
                  </option>
                  {keyOptions !== undefined
                    ? keyOptions.map((key) => (
                        <option key={key.value} value={key.value}>
                          {key.label}
                        </option>
                      ))
                    : availableKeys.map((key) => (
                        <option key={key} value={key}>
                          ~/.ssh/{key}
                        </option>
                      ))}
                </select>
              </div>
            )}

          {authMethod === "password" ? (
            <div className="space-y-1">
              <label
                htmlFor="ssh-credential-username"
                className="text-xs font-medium text-[var(--color-text-muted)]"
              >
                Username
              </label>
              <input
                id="ssh-credential-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={loading || isAndroidChromeNativeInputSuppressed}
                className={inputClass}
              />
            </div>
          ) : null}

          {/* Passphrase or password input */}
          <div className="space-y-1">
            <label
              htmlFor="ssh-credential-secret"
              className="text-xs font-medium text-[var(--color-text-muted)]"
            >
              {authMethod === "password" ? "Password" : "Passphrase"}
            </label>
            <input
              id="ssh-credential-secret"
              ref={inputRef}
              type="password"
              autoComplete={
                authMethod === "password" ? "current-password" : "off"
              }
              placeholder={
                authMethod === "password"
                  ? "Enter password..."
                  : "Enter passphrase..."
              }
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={loading || isAndroidChromeNativeInputSuppressed}
              aria-describedby={
                isAndroidChromeNativeInputSuppressed
                  ? "passphrase-dialog-android-description"
                  : undefined
              }
              className={inputClass}
            />
          </div>

          {allowSaveForLater &&
          (saveForLaterAuth === "both" || saveForLaterAuth === authMethod) ? (
            <label className="flex items-start gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2 text-xs text-[var(--color-text-muted)]">
              <input
                id="ssh-credential-remember"
                type="checkbox"
                checked={saveForLater}
                onChange={(e) => setSaveForLater(e.target.checked)}
                disabled={loading}
                className="mt-0.5"
              />
              <span>
                Remember for 30 days
                <span className="block text-[11px] opacity-80">
                  Fixed expiry in the Windows user vault; the choice is not
                  sliding. A same-user process may use the saved credential.
                </span>
              </span>
            </label>
          ) : null}

          {/* Error */}
          {error && (
            <p
              id="passphrase-dialog-error"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              className="text-xs text-[var(--color-danger)] bg-[var(--color-danger)]/10 rounded px-2 py-1"
            >
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={loading}
              disabled={
                isAndroidChromeNativeInputSuppressed ||
                (authMethod === "key" &&
                  requireKeySelection &&
                  (!selectedKey || keyOptions?.length === 0)) ||
                (authMethod === "password" &&
                  (!passwordAuth || !username.trim() || !passphrase))
              }
              title={
                isAndroidChromeNativeInputSuppressed
                  ? "Unavailable on Android Chrome"
                  : undefined
              }
            >
              {submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
