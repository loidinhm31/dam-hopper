export type MobileTerminalKeyId =
  | "escape"
  | "tab"
  | "ctrl-c"
  | "page-up"
  | "page-down"
  | "up"
  | "down"
  | "left"
  | "right";

export interface MobileTerminalKeyDefinition {
  id: MobileTerminalKeyId;
  label: string;
  title: string;
}

export const MOBILE_TERMINAL_KEYS: MobileTerminalKeyDefinition[] = [
  { id: "escape", label: "Esc", title: "Send Escape" },
  { id: "tab", label: "Tab", title: "Send Tab" },
  { id: "ctrl-c", label: "^C", title: "Send Ctrl+C" },
  { id: "page-up", label: "PgUp", title: "Send Page Up" },
  { id: "page-down", label: "PgDn", title: "Send Page Down" },
  { id: "up", label: "Up", title: "Send Arrow Up" },
  { id: "left", label: "Left", title: "Send Arrow Left" },
  { id: "down", label: "Down", title: "Send Arrow Down" },
  { id: "right", label: "Right", title: "Send Arrow Right" },
];

export function getMobileTerminalKeySequence(
  id: MobileTerminalKeyId,
): string | null {
  switch (id) {
    case "escape":
      return "\x1b";
    case "tab":
      return "\t";
    case "ctrl-c":
      return "\x03";
    case "page-up":
      return "\x1b[5~";
    case "page-down":
      return "\x1b[6~";
    case "up":
      return "\x1b[A";
    case "down":
      return "\x1b[B";
    case "right":
      return "\x1b[C";
    case "left":
      return "\x1b[D";
  }
}
