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
}

export interface TextInputProxyHandle {
  focus: () => void;
  blur: () => void;
  isFocused: () => boolean;
}

export const TextInputProxy = React.forwardRef<
  TextInputProxyHandle,
  TextInputProxyProps
>(function TextInputProxy(
  { controller, autoFocus = false, onFocus, onBlur },
  forwardedRef,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);
  const lastCommittedRef = useRef<{ text: string; time: number } | null>(null);

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
    }),
    [],
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      isComposingRef.current = false;
      const text = e.data;
      if (text && controller) {
        controller.handleInsertText(text);
      }
      if (textareaRef.current) {
        textareaRef.current.value = "";
      }
    },
    [controller],
  );

  const handleBeforeInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement> & { data?: string | null }) => {
      if (isComposingRef.current) return;

      const data = e.data;
      if (data && controller) {
        controller.handleInsertText(data);
        lastCommittedRef.current = { text: data, time: Date.now() };
        if (textareaRef.current) {
          textareaRef.current.value = "";
        }
      }
    },
    [controller],
  );

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      if (isComposingRef.current) return;

      const val = e.currentTarget.value;
      const last = lastCommittedRef.current;
      const isDuplicate =
        last &&
        last.text === val &&
        Date.now() - last.time < 100;

      if (val && controller && !isDuplicate) {
        controller.handleInsertText(val);
        lastCommittedRef.current = { text: val, time: Date.now() };
      }
      e.currentTarget.value = "";
    },
    [controller],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposingRef.current) return;
      if (!controller) return;

      // Allow standard browser copy/paste/select-all
      const isClipboardShortcut =
        (e.ctrlKey || e.metaKey) &&
        ["c", "v", "x", "a"].includes(e.key.toLowerCase());

      const handled = controller.handleKeyDown(e);
      if (handled && !isClipboardShortcut) {
        e.preventDefault();
      }
    },
    [controller],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isComposingRef.current) return;
      if (!controller) return;

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
      if (!controller) return;

      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        controller.handleInsertText(text);
      }
      if (textareaRef.current) {
        textareaRef.current.value = "";
      }
    },
    [controller],
  );

  const handleBlur = useCallback(() => {
    controller?.releaseAllHeldInput();
    onBlur?.();
  }, [controller, onBlur]);

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
      onFocus={onFocus}
      onBlur={handleBlur}
      tabIndex={0}
      aria-hidden="true"
    />
  );
});
