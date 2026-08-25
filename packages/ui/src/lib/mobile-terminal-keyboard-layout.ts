export type CustomMobileTerminalKeyKind = "text" | "sequence" | "toggle";

export type CustomMobileTerminalToggle = "shift" | "ctrl" | "symbols";

export interface CustomMobileTerminalKey {
  id: string;
  label: string;
  title: string;
  kind: CustomMobileTerminalKeyKind;
  value?: string;
  sequence?: string;
  toggle?: CustomMobileTerminalToggle;
  wide?: boolean;
}

export interface CustomMobileTerminalKeyModifiers {
  shift: boolean;
  ctrl: boolean;
}

function textKey(value: string): CustomMobileTerminalKey {
  return {
    id: `text-${value}`,
    label: value,
    title: `Send ${value}`,
    kind: "text",
    value,
  };
}

function sequenceKey(
  id: string,
  label: string,
  title: string,
  sequence: string,
  wide = false,
): CustomMobileTerminalKey {
  return { id, label, title, kind: "sequence", sequence, wide };
}

function toggleKey(
  toggle: CustomMobileTerminalToggle,
  label: string,
  title: string,
): CustomMobileTerminalKey {
  return { id: `toggle-${toggle}`, label, title, kind: "toggle", toggle };
}

const QWERTY_ROWS = ["qwertyuiop", "asdfghjkl"];

export const CUSTOM_MOBILE_TERMINAL_KEY_ROWS: CustomMobileTerminalKey[][] = [
  QWERTY_ROWS[0].split("").map(textKey),
  QWERTY_ROWS[1].split("").map(textKey),
  [
    toggleKey("shift", "Shift", "Toggle Shift"),
    ..."zxcvbnm".split("").map(textKey),
    sequenceKey("backspace", "Del", "Send Backspace", "\x7f"),
  ],
  [
    toggleKey("ctrl", "Ctrl", "Toggle Ctrl"),
    sequenceKey("escape", "Esc", "Send Escape", "\x1b"),
    sequenceKey("tab", "Tab", "Send Tab", "\t"),
    sequenceKey("space", "Space", "Send Space", " ", true),
    sequenceKey("enter", "Enter", "Send Enter", "\r"),
  ],
  [
    toggleKey("symbols", "123", "Show Symbols"),
    sequenceKey("page-up", "PgUp", "Send Page Up", "\x1b[5~"),
    sequenceKey("up", "Up", "Send Arrow Up", "\x1b[A"),
    sequenceKey("page-down", "PgDn", "Send Page Down", "\x1b[6~"),
    sequenceKey("left", "Left", "Send Arrow Left", "\x1b[D"),
    sequenceKey("down", "Down", "Send Arrow Down", "\x1b[B"),
    sequenceKey("right", "Right", "Send Arrow Right", "\x1b[C"),
  ],
];

export const CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS: CustomMobileTerminalKey[][] = [
  "1234567890".split("").map(textKey),
  "-/:;()$&@\"".split("").map(textKey),
  ".,?!'`~|\\ ".trimEnd().split("").map(textKey),
  ["{", "}", "[", "]", "<", ">", "_", "+", "="].map(textKey),
  [
    toggleKey("symbols", "ABC", "Show Letters"),
    toggleKey("ctrl", "Ctrl", "Toggle Ctrl"),
    sequenceKey("escape", "Esc", "Send Escape", "\x1b"),
    sequenceKey("tab", "Tab", "Send Tab", "\t"),
    sequenceKey("space", "Space", "Send Space", " ", true),
    sequenceKey("enter", "Enter", "Send Enter", "\r"),
    sequenceKey("backspace", "Del", "Send Backspace", "\x7f"),
  ],
];

export function getCustomMobileTerminalKeySequence(
  key: CustomMobileTerminalKey,
  modifiers: CustomMobileTerminalKeyModifiers,
): string | null {
  if (key.kind === "toggle") return null;
  if (key.kind === "sequence") return key.sequence ?? null;

  const value = key.value ?? "";
  if (!value) return null;
  const lower = value.toLowerCase();
  if (modifiers.ctrl && /^[a-z]$/.test(lower)) {
    return String.fromCharCode(lower.charCodeAt(0) - 96);
  }
  if (modifiers.shift && /^[a-z]$/.test(value)) return value.toUpperCase();
  return value;
}
