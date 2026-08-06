import { X } from "lucide-react";
import { useState } from "react";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";

export function AndroidChromeKeyboardNotice() {
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const [dismissed, setDismissed] = useState(false);

  if (!isAndroidChromeNativeInputSuppressed || dismissed) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-labelledby="android-chrome-keyboard-notice-title"
      aria-describedby="android-chrome-keyboard-notice-description"
      className="fixed inset-x-3 top-3 z-40 mx-auto flex max-w-xl items-start gap-3 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-surface)]/95 px-3 py-2.5 text-xs text-[var(--color-text)] shadow-lg backdrop-blur-sm"
    >
      <div className="min-w-0 flex-1">
        <p
          id="android-chrome-keyboard-notice-title"
          className="font-semibold text-[var(--color-warning)]"
        >
          Mobile text entry unavailable
        </p>
        <p
          id="android-chrome-keyboard-notice-description"
          className="mt-0.5 leading-relaxed text-[var(--color-text-muted)]"
        >
          Android Chrome text entry is disabled here. Custom terminal keys
          remain available, as do buttons, selectors, and file pickers. Use a
          desktop browser for search, editing, URLs, and passphrases. Android
          physical-keyboard behavior is not validated here.
        </p>
      </div>
      <button
        type="button"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss Android Chrome text entry notice"
        className="shrink-0 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)]"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </aside>
  );
}
