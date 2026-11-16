import * as React from "react";
import {
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import type { BrowserInputController } from "./input-controller.js";

export interface TextInputProxyProps {
  controller: BrowserInputController | null;
  autoFocus?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onUserGesture?: () => void;
  onCopyShortcut?: () => void;
  onSelectionInvalidate?: () => void;
  onCopy?: React.ClipboardEventHandler<HTMLTextAreaElement>;
  onPasteError?: (message: string) => void;
  onPasteSuccess?: () => void;
}

export interface TextInputProxyHandle {
  focus: () => void;
  blur: () => void;
  isFocused: () => boolean;
  reset: () => void;
}

function isLocalPasteShortcut(event: React.KeyboardEvent<HTMLTextAreaElement>) {
  return ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") ||
    (event.shiftKey && event.key === "Insert");
}

export async function writeTextToClipboard(
  text: string,
  isAuthorized?: () => boolean,
): Promise<boolean> {
  if (isAuthorized && !isAuthorized()) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      if (isAuthorized && !isAuthorized()) return false;
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }
  if (isAuthorized && !isAuthorized()) return false;
  if (typeof document === "undefined" || !document.body) return false;
  const activeEl = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  ta.style.left = "-9999px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    if (isAuthorized && !isAuthorized()) return false;
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
    if (
      (!isAuthorized || isAuthorized()) &&
      activeEl &&
      typeof activeEl.focus === "function" &&
      activeEl.isConnected
    ) {
      activeEl.focus();
    }
  }
}

export const TextInputProxy = React.forwardRef<
  TextInputProxyHandle,
  TextInputProxyProps
>(function TextInputProxy(
  { controller, autoFocus = false, onFocus, onBlur, onUserGesture, onCopyShortcut, onSelectionInvalidate, onCopy, onPasteError, onPasteSuccess },
  forwardedRef,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);
  const pendingCommitRef = useRef<{ text: string; source: "composition" | "beforeInput" } | null>(null);

  const reset = useCallback(() => {
    isComposingRef.current = false;
    pendingCommitRef.current = null;
    if (textareaRef.current) textareaRef.current.value = "";
  }, []);

  useImperativeHandle(
    forwardedRef,
    () => ({
      focus: () => {
        textareaRef.current?.focus();
      },
      blur: () => {
        textareaRef.current?.blur();
      },
      isFocused: () => {
        return document.activeElement === textareaRef.current;
      },
      reset,
    }),
    [reset],
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
    pendingCommitRef.current = null;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      if (!isComposingRef.current) {
        // A cancelled composition can still emit compositionEnd + beforeInput + input.
        // Consume that native commit sequence without forwarding it to a later gesture.
        pendingCommitRef.current = { text: e.data, source: "composition" };
        return;
      }
      if (document.activeElement !== textareaRef.current) return;
      isComposingRef.current = false;
      const text = e.data;
      if (text && controller) {
        controller.handleInsertText(text);
        pendingCommitRef.current = { text, source: "composition" };
        onSelectionInvalidate?.();
      }
      if (textareaRef.current) {
        textareaRef.current.value = "";
      }
    },
    [controller, onSelectionInvalidate],
  );

  const handleBeforeInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement> & { data?: string | null }) => {
      if (isComposingRef.current) return;
      if (document.activeElement !== textareaRef.current) return;

      const data = e.data;
      if (data && controller) {
        const pending = pendingCommitRef.current;
        // React can synthesize beforeInput from the same compositionEnd.
        if (pending?.source !== "composition" || pending.text !== data) {
          controller.handleInsertText(data);
          onSelectionInvalidate?.();
        }
        pendingCommitRef.current = { text: data, source: "beforeInput" };
        if (textareaRef.current) {
          textareaRef.current.value = "";
        }
      }
    },
    [controller, onSelectionInvalidate],
  );

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      if (isComposingRef.current) return;
      if (document.activeElement !== textareaRef.current) {
        reset();
        return;
      }

      const val = e.currentTarget.value;
      const pending = pendingCommitRef.current;
      pendingCommitRef.current = null;
      if (val && controller && pending?.text !== val) {
        controller.handleInsertText(val);
        onSelectionInvalidate?.();
      }
      e.currentTarget.value = "";
    },
    [controller, onSelectionInvalidate, reset],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposingRef.current) return;
      onUserGesture?.();
      if (!controller) return;
      // Local clipboard text is forwarded by onPaste. Never also trigger paste
      // from the remote browser's independent clipboard.
      if (isLocalPasteShortcut(e)) return;

      const isCopyShortcut =
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "c";
      if (isCopyShortcut) {
        onCopyShortcut?.();
      } else if (!["Shift", "Control", "Meta", "Alt"].includes(e.key)) {
        onSelectionInvalidate?.();
      }

      // Allow standard browser copy/paste/select-all
      const isClipboardShortcut =
        (e.ctrlKey || e.metaKey) &&
        ["c", "v", "x", "a"].includes(e.key.toLowerCase());

      const handled = controller.handleKeyDown(e);
      if (handled && !isClipboardShortcut) {
        e.preventDefault();
      }
    },
    [controller, onCopyShortcut, onSelectionInvalidate, onUserGesture],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposingRef.current) return;
      if (!controller) return;
      if (isLocalPasteShortcut(e)) return;

      const handled = controller.handleKeyUp(e);
      if (handled) {
        e.preventDefault();
      }
    },
    [controller],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      e.preventDefault();
      if (!controller) {
        onPasteError?.("Paste rejected: browser input controller unavailable");
        return;
      }

      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        const accepted = controller.handlePasteText(text);
        if (accepted) {
          onSelectionInvalidate?.();
          onPasteSuccess?.();
        }
        if (textareaRef.current) {
          textareaRef.current.value = "";
        }
      } else if (textareaRef.current) {
        textareaRef.current.value = "";
      }
    },
    [controller, onPasteError, onPasteSuccess, onSelectionInvalidate],
  );

  const handleBlur = useCallback(() => {
    reset();
    controller?.releaseAllHeldInput();
    onBlur?.();
  }, [controller, onBlur, reset]);

  return (
    <textarea
      ref={textareaRef}
      className="absolute top-0 left-0 w-px h-px opacity-0 pointer-events-none p-0 m-0 border-0 outline-none resize-none overflow-hidden"
      autoFocus={autoFocus}
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onBeforeInput={handleBeforeInput}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onPaste={handlePaste}
      onCopy={onCopy}
      onFocus={onFocus}
      onBlur={handleBlur}
      tabIndex={0}
      aria-hidden="true"
    />
  );
});
