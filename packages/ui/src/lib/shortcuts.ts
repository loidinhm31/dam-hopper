export const DOUBLE_SHIFT_SHORTCUT = "DoubleShift";
export const DEFAULT_SEARCH_TEXT_SHORTCUT = "Mod+Shift+KeyF";
export const DEFAULT_SEARCH_FILENAME_SHORTCUT = DOUBLE_SHIFT_SHORTCUT;
export const DEFAULT_TERMINAL_WORKSPACE_SHORTCUT = "Mod+Shift+Backquote";
export const DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT = "Mod+Shift+KeyE";
export const DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT = "Alt+F1";
export const DEFAULT_GIT_PANEL_SHORTCUT = "Mod+Shift+KeyG";
export const DEFAULT_PORTS_PANEL_SHORTCUT = "Mod+Shift+KeyP";
export const DEFAULT_FLEET_TERMINAL_SHORTCUT = "Mod+Shift+KeyM";
export const DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT =
  "Ctrl+Alt+Shift+Equal";
export const DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT = "Ctrl+Alt+Minus";
export const EDITOR_ZOOM_WHEEL_SHORTCUT = "Mod+Wheel";

const DOUBLE_SHIFT_MS = 450;

type ShortcutKind = "keyboard" | "double-shift" | "wheel";

interface ShortcutMods {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface ParsedShortcut extends ShortcutMods {
  kind: ShortcutKind;
  code?: string;
}

export interface ShortcutKeyEvent {
  type?: string;
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  preventDefault?: () => void;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export interface ShortcutWheelEvent {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

function emptyMods(): ShortcutMods {
  return { mod: false, ctrl: false, meta: false, alt: false, shift: false };
}

export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(globalThis.navigator?.platform ?? "");
}

export function parseShortcut(shortcut: string): ParsedShortcut | null {
  const trimmed = shortcut.trim();
  if (trimmed.toLowerCase() === DOUBLE_SHIFT_SHORTCUT.toLowerCase()) {
    return { kind: "double-shift", ...emptyMods() };
  }

  const parts = trimmed
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const mods = emptyMods();
  let terminal: string | undefined;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod") mods.mod = true;
    else if (lower === "ctrl" || lower === "control") mods.ctrl = true;
    else if (lower === "cmd" || lower === "meta" || lower === "command")
      mods.meta = true;
    else if (lower === "alt" || lower === "option") mods.alt = true;
    else if (lower === "shift") mods.shift = true;
    else if (terminal) return null;
    else terminal = part;
  }

  if (!terminal) return null;
  if (terminal.toLowerCase() === "wheel") return { kind: "wheel", ...mods };

  return { kind: "keyboard", ...mods, code: normalizeCode(terminal) };
}

export function validateShortcut(shortcut: string): string | null {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return "Invalid shortcut";
  if (parsed.kind === "keyboard" && !parsed.code) return "Missing key";
  if (parsed.kind === "wheel" && !hasAnyModifier(parsed)) {
    return "Wheel shortcut requires a modifier";
  }
  return null;
}

export function formatShortcut(shortcut: string): string {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return shortcut;
  if (parsed.kind === "double-shift") return DOUBLE_SHIFT_SHORTCUT;

  const parts: string[] = [];
  if (parsed.mod) parts.push("Mod");
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.meta) parts.push("Cmd");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(parsed.kind === "wheel" ? "Wheel" : (parsed.code ?? ""));
  return parts.join("+");
}

export function displayShortcut(
  shortcut: string,
  isMac = isMacPlatform(),
): string {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return shortcut;
  if (parsed.kind === "double-shift") return "Double Shift";

  const parts: string[] = [];
  if (parsed.mod) parts.push(isMac ? "Cmd" : "Ctrl");
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.meta) parts.push("Cmd");
  if (parsed.alt) parts.push(isMac ? "Option" : "Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(
    parsed.kind === "wheel" ? "Wheel" : displayCode(parsed.code ?? ""),
  );
  return parts.join("+");
}

export function shortcutFromKeyboardEvent(event: ShortcutKeyEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.metaKey) parts.push("Cmd");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(event.code);
  return formatShortcut(parts.join("+"));
}

export function matchesKeyboardShortcut(
  shortcut: string,
  event: ShortcutKeyEvent,
  isMac = isMacPlatform(),
): boolean {
  if (event.repeat || event.isComposing) return false;
  const parsed = parseShortcut(shortcut);
  if (!parsed || parsed.kind !== "keyboard" || !parsed.code) return false;
  return (
    parsed.code === event.code &&
    expectedCtrl(parsed, isMac) === event.ctrlKey &&
    expectedMeta(parsed, isMac) === event.metaKey &&
    parsed.alt === event.altKey &&
    parsed.shift === event.shiftKey
  );
}

export function matchesNewTerminalShortcut(event: ShortcutKeyEvent): boolean {
  return (
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.code === "Backquote"
  );
}

export function matchesWheelShortcut(
  shortcut: string,
  event: ShortcutWheelEvent,
  isMac = isMacPlatform(),
): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed || parsed.kind !== "wheel") return false;
  return (
    expectedCtrl(parsed, isMac) === event.ctrlKey &&
    expectedMeta(parsed, isMac) === event.metaKey &&
    parsed.alt === event.altKey &&
    parsed.shift === event.shiftKey
  );
}

export class DoubleShiftDetector {
  private lastShiftAt = 0;

  constructor(private readonly thresholdMs = DOUBLE_SHIFT_MS) {}

  match(event: ShortcutKeyEvent, now = Date.now()): boolean {
    if (event.repeat || event.isComposing || event.key !== "Shift") {
      return false;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      this.lastShiftAt = 0;
      return false;
    }
    const matched =
      this.lastShiftAt > 0 && now - this.lastShiftAt <= this.thresholdMs;
    this.lastShiftAt = matched ? 0 : now;
    return matched;
  }

  reset() {
    this.lastShiftAt = 0;
  }
}

function expectedCtrl(parsed: ShortcutMods, isMac: boolean): boolean {
  return parsed.ctrl || (parsed.mod && !isMac);
}

function expectedMeta(parsed: ShortcutMods, isMac: boolean): boolean {
  return parsed.meta || (parsed.mod && isMac);
}

function hasAnyModifier(parsed: ShortcutMods): boolean {
  return parsed.mod || parsed.ctrl || parsed.meta || parsed.alt || parsed.shift;
}

function normalizeCode(code: string): string {
  if (/^[a-z]$/i.test(code)) return `Key${code.toUpperCase()}`;
  if (/^[0-9]$/.test(code)) return `Digit${code}`;
  if (/^f\d{1,2}$/i.test(code)) return code.toUpperCase();
  if (code.toLowerCase() === "backquote") return "Backquote";
  if (code.toLowerCase() === "equal") return "Equal";
  if (code.toLowerCase() === "minus") return "Minus";
  return code;
}

function displayCode(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}
