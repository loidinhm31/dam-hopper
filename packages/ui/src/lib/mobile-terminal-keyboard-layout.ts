export type CustomMobileTerminalKeyKind = "text" | "sequence" | "toggle";

export type CustomMobileTerminalToggle =
  | "shift"
  | "ctrl"
  | "caps"
  | "alt"
  | "meta"
  | "symbols";

export interface CustomMobileTerminalKey {
  id: string;
  label: string;
  title: string;
  kind: CustomMobileTerminalKeyKind;
  value?: string;
  sequence?: string;
  toggle?: CustomMobileTerminalToggle;
  units?: number;
  cluster?: "arrows";
}

export interface CustomMobileTerminalKeyModifiers {
  shift: boolean;
  ctrl: boolean;
  caps?: boolean;
  alt?: boolean;
  meta?: boolean;
}

function textKey(
  value: string,
  label = value,
  units = 1,
): CustomMobileTerminalKey {
  return {
    id: `text-${value}`,
    label,
    title: `Send ${value}`,
    kind: "text",
    value,
    units,
  };
}

function sequenceKey(
  id: string,
  label: string,
  title: string,
  sequence: string,
  units = 1,
  cluster?: "arrows",
): CustomMobileTerminalKey {
  return { id, label, title, kind: "sequence", sequence, units, cluster };
}

function toggleKey(
  id: string,
  toggle: CustomMobileTerminalToggle,
  label: string,
  title: string,
  units = 1,
): CustomMobileTerminalKey {
  return { id, label, title, kind: "toggle", toggle, units };
}

export const CUSTOM_MOBILE_TERMINAL_KEY_ROWS: CustomMobileTerminalKey[][] = [
  [
    sequenceKey("escape", "Esc", "Send Escape", "\x1b"),
    textKey("`", "`~"),
    textKey("1", "1!"),
    textKey("2", "2@"),
    textKey("3", "3#"),
    textKey("4", "4$"),
    textKey("5", "5%"),
    textKey("6", "6^"),
    textKey("7", "7&"),
    textKey("8", "8*"),
    textKey("9", "9("),
    textKey("0", "0)"),
    textKey("-", "-_"),
    textKey("=", "=+"),
    sequenceKey("backspace", "Backspace", "Send Backspace", "\x7f", 2),
  ],
  [
    sequenceKey("tab", "Tab", "Send Tab", "\t", 1.5),
    ...Array.from("qwertyuiop", (value) => textKey(value, value.toUpperCase())),
    textKey("[", "[{"),
    textKey("]", "]}"),
    textKey("\\", "\\|"),
    sequenceKey("enter", "Enter", "Send Enter", "\r", 1.75),
  ],
  [
    toggleKey("caps-lock", "caps", "Caps", "Toggle Caps Lock", 1.75),
    ...Array.from("asdfghjkl", (value) => textKey(value, value.toUpperCase())),
    textKey(";", ";:"),
    textKey("'", "'\""),
  ],
  [
    toggleKey("shift-left", "shift", "Shift", "Toggle Shift", 2.25),
    ...Array.from("zxcvbnm", (value) => textKey(value, value.toUpperCase())),
    textKey(",", ",<"),
    textKey(".", ".>"),
    textKey("/", "/?"),
    toggleKey("shift-right", "shift", "Shift", "Toggle Shift", 2.25),
  ],
  [
    toggleKey("ctrl", "ctrl", "Ctrl", "Toggle Ctrl", 1.25),
    toggleKey("meta", "meta", "Win", "Toggle Meta", 1.25),
    toggleKey("alt-left", "alt", "Alt", "Toggle Alt", 1.25),
    sequenceKey("space", "Space", "Send Space", " ", 3),
    toggleKey("alt-right", "alt", "Alt", "Toggle Alt", 1.25),
    toggleKey("symbols", "symbols", "Fn", "Show Function Layer", 1.25),
    sequenceKey("up", "↑", "Send Arrow Up", "\x1b[A", 1, "arrows"),
    sequenceKey("left", "←", "Send Arrow Left", "\x1b[D", 1, "arrows"),
    sequenceKey("down", "↓", "Send Arrow Down", "\x1b[B", 1, "arrows"),
    sequenceKey("right", "→", "Send Arrow Right", "\x1b[C", 1, "arrows"),
  ],
];

export const CUSTOM_MOBILE_TERMINAL_SYMBOL_ROWS: CustomMobileTerminalKey[][] = [
  [
    toggleKey("symbols", "symbols", "ABC", "Show Letters", 1.5),
    sequenceKey("escape", "Esc", "Send Escape", "\x1b"),
    sequenceKey("tab", "Tab", "Send Tab", "\t"),
    sequenceKey("page-up", "PgUp", "Send Page Up", "\x1b[5~"),
    sequenceKey("page-down", "PgDn", "Send Page Down", "\x1b[6~"),
    sequenceKey("backspace", "Backspace", "Send Backspace", "\x7f", 2),
  ],
  [
    textKey("~"),
    textKey("!"),
    textKey("@"),
    textKey("#"),
    textKey("$"),
    textKey("%"),
    textKey("^"),
    textKey("&"),
    textKey("*"),
    textKey("("),
    textKey(")"),
    textKey("_"),
    textKey("+"),
    textKey("|"),
  ],
  [
    textKey("{"),
    textKey("}"),
    textKey("["),
    textKey("]"),
    textKey("<"),
    textKey(">"),
    textKey(":"),
    textKey('"'),
    textKey("?"),
    textKey("`"),
    textKey("~"),
  ],
  [
    sequenceKey("page-up", "PgUp", "Send Page Up", "\x1b[5~"),
    sequenceKey("page-down", "PgDn", "Send Page Down", "\x1b[6~"),
    sequenceKey("escape", "Esc", "Send Escape", "\x1b"),
    sequenceKey("tab", "Tab", "Send Tab", "\t"),
    sequenceKey("space", "Space", "Send Space", " ", 3),
    sequenceKey("enter", "Enter", "Send Enter", "\r", 1.75),
  ],
  [
    toggleKey("ctrl-symbols", "ctrl", "Ctrl", "Toggle Ctrl", 1.25),
    sequenceKey("left", "←", "Send Arrow Left", "\x1b[D", 1, "arrows"),
    sequenceKey("up", "↑", "Send Arrow Up", "\x1b[A", 1, "arrows"),
    sequenceKey("down", "↓", "Send Arrow Down", "\x1b[B", 1, "arrows"),
    sequenceKey("right", "→", "Send Arrow Right", "\x1b[C", 1, "arrows"),
  ],
];

const SHIFTED_TEXT: Record<string, string> = {
  "`": "~",
  "1": "!",
  "2": "@",
  "3": "#",
  "4": "$",
  "5": "%",
  "6": "^",
  "7": "&",
  "8": "*",
  "9": "(",
  "0": ")",
  "-": "_",
  "=": "+",
  "[": "{",
  "]": "}",
  "\\": "|",
  ";": ":",
  "'": '"',
  ",": "<",
  ".": ">",
  "/": "?",
};
const ACCESSIBLE_SYMBOL_NAMES: Record<string, string> = {
  "`": "backtick",
  "~": "tilde",
  "!": "exclamation mark",
  "@": "at sign",
  "#": "hash",
  "$": "dollar sign",
  "%": "percent",
  "^": "caret",
  "&": "ampersand",
  "*": "asterisk",
  "(": "left parenthesis",
  ")": "right parenthesis",
  "-": "hyphen",
  "_": "underscore",
  "=": "equals",
  "+": "plus",
  "[": "left bracket",
  "{": "left brace",
  "]": "right bracket",
  "}": "right brace",
  "\\": "backslash",
  "|": "pipe",
  ";": "semicolon",
  ":": "colon",
  "'": "apostrophe",
  '"': "quotation mark",
  ",": "comma",
  "<": "less-than sign",
  ".": "period",
  ">": "greater-than sign",
  "/": "slash",
  "?": "question mark",
};

export function getCustomMobileTerminalKeyLabel(
  key: CustomMobileTerminalKey,
  isShiftActive: boolean,
): string {
  if (!isShiftActive || key.kind !== "text") return key.label;
  return SHIFTED_TEXT[key.value ?? ""] ?? key.label;
}

export function getCustomMobileTerminalKeyAriaLabel(
  key: CustomMobileTerminalKey,
  modifiers: CustomMobileTerminalKeyModifiers,
): string {
  if (key.kind !== "text") return key.title;

  const value = key.value ?? "";
  if (modifiers.ctrl && /^[a-z]$/.test(value.toLowerCase())) {
    return `Send Ctrl+${value.toUpperCase()}`;
  }

  const output = getCustomMobileTerminalKeySequence(key, {
    ...modifiers,
    alt: false,
    meta: false,
  });
  if (!output) return key.title;

  const modifierPrefix = [
    modifiers.alt ? "Alt" : null,
    modifiers.meta ? "Meta" : null,
  ]
    .filter((modifier): modifier is string => modifier !== null)
    .join("+");
  const accessibleOutput = ACCESSIBLE_SYMBOL_NAMES[output] ?? output;
  return `Send ${modifierPrefix ? `${modifierPrefix}+` : ""}${accessibleOutput}`;
}

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

  const isLetter = /^[a-z]$/.test(lower);
  const isUppercase = Boolean(modifiers.shift) !== Boolean(modifiers.caps);
  const output = isLetter
    ? isUppercase
      ? lower.toUpperCase()
      : lower
    : modifiers.shift
      ? (SHIFTED_TEXT[value] ?? value)
      : value;
  if (modifiers.alt || modifiers.meta) return `\x1b${output}`;
  return output;
}
