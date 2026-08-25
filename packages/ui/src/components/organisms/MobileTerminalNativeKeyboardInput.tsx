import { type ChangeEvent, type KeyboardEvent, type RefObject } from "react";

interface MobileTerminalNativeKeyboardInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function MobileTerminalNativeKeyboardInput({
  inputRef,
  onChange,
  onKeyDown,
}: MobileTerminalNativeKeyboardInputProps) {
  return (
    <div className="pb-2">
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="enter"
        placeholder="Type for terminal"
        onChange={onChange}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
      />
    </div>
  );
}
