import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";

interface MobileTerminalNativeKeyboardInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  onTerminalInput: (sequence: string) => void;
}

export function MobileTerminalNativeKeyboardInput({
  inputRef,
  onTerminalInput,
}: MobileTerminalNativeKeyboardInputProps) {
  const isComposingRef = useRef(false);
  const compositionCommittedRef = useRef(false);
  const beforeInputHandledRef = useRef(false);
  const previousValueRef = useRef("");

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (isComposingRef.current) return;
      if (event.key === "Backspace") {
        event.preventDefault();
        onTerminalInput("\x7f");
        event.currentTarget.value = "";
        previousValueRef.current = "";
      } else if (event.key === "Enter") {
        event.preventDefault();
        onTerminalInput("\r");
        event.currentTarget.value = "";
        previousValueRef.current = "";
      }
    },
    [onTerminalInput],
  );

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleBeforeInput = (event: InputEvent) => {
      if (isComposingRef.current) return;
      const inputType = event.inputType;
      if (inputType === "insertText" || inputType === "insertFromPaste") {
        const data = event.data;
        if (data) {
          if (event.cancelable) event.preventDefault();
          beforeInputHandledRef.current = true;
          queueMicrotask(() => {
            beforeInputHandledRef.current = false;
          });
          onTerminalInput(data);
          input.value = "";
          previousValueRef.current = "";
        }
      } else if (inputType === "deleteContentBackward") {
        if (event.cancelable) event.preventDefault();
        beforeInputHandledRef.current = true;
        queueMicrotask(() => {
          beforeInputHandledRef.current = false;
        });
        onTerminalInput("\x7f");
        input.value = "";
        previousValueRef.current = "";
      } else if (
        inputType === "insertLineBreak" ||
        inputType === "insertParagraph"
      ) {
        if (event.cancelable) event.preventDefault();
        beforeInputHandledRef.current = true;
        queueMicrotask(() => {
          beforeInputHandledRef.current = false;
        });
        onTerminalInput("\r");
        input.value = "";
        previousValueRef.current = "";
      }
    };

    input.addEventListener("beforeinput", handleBeforeInput as EventListener);
    return () => {
      input.removeEventListener(
        "beforeinput",
        handleBeforeInput as EventListener,
      );
    };
  }, [inputRef, onTerminalInput]);

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
    compositionCommittedRef.current = false;
  }, []);

  const handleCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLInputElement>) => {
      isComposingRef.current = false;
      const data = event.data;
      if (data) {
        compositionCommittedRef.current = true;
        queueMicrotask(() => {
          compositionCommittedRef.current = false;
        });
        onTerminalInput(data);
      }
      event.currentTarget.value = "";
      previousValueRef.current = "";
    },
    [onTerminalInput],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (isComposingRef.current) return;
      if (beforeInputHandledRef.current) {
        beforeInputHandledRef.current = false;
        previousValueRef.current = event.target.value;
        return;
      }
      if (compositionCommittedRef.current) {
        compositionCommittedRef.current = false;
        previousValueRef.current = event.target.value;
        return;
      }
      const nextValue = event.target.value;
      const prev = previousValueRef.current;
      if (nextValue.length > prev.length && nextValue.startsWith(prev)) {
        const diff = nextValue.slice(prev.length);
        if (diff) onTerminalInput(diff);
      } else if (nextValue.length < prev.length) {
        const count = prev.length - nextValue.length;
        for (let i = 0; i < count; i++) {
          onTerminalInput("\x7f");
        }
      } else if (nextValue && nextValue !== prev) {
        onTerminalInput(nextValue);
      }
      previousValueRef.current = nextValue;
    },
    [onTerminalInput],
  );

  return (
    <label
      data-native-keyboard-input
      className="block cursor-text pb-2"
    >
      <input
        ref={inputRef}
        data-testid="native-keyboard"
        type="text"
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="enter"
        placeholder="Type for terminal"
        aria-label="Type for terminal"
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onChange={handleChange}
        className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
      />
    </label>
  );
}
