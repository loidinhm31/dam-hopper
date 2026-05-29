export type TerminalUsageMode = "traditional" | "runtime";

const TERMINAL_USAGE_MODE_KEY = "dam-hopper:terminal-usage-mode";
const DEFAULT_TERMINAL_USAGE_MODE: TerminalUsageMode = "traditional";

export function isTerminalUsageMode(
  value: unknown,
): value is TerminalUsageMode {
  return value === "traditional" || value === "runtime";
}

export function loadTerminalUsageMode(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): TerminalUsageMode {
  try {
    const value = storage?.getItem(TERMINAL_USAGE_MODE_KEY);
    return isTerminalUsageMode(value) ? value : DEFAULT_TERMINAL_USAGE_MODE;
  } catch {
    return DEFAULT_TERMINAL_USAGE_MODE;
  }
}

export function saveTerminalUsageMode(
  mode: TerminalUsageMode,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
) {
  try {
    storage?.setItem(TERMINAL_USAGE_MODE_KEY, mode);
  } catch {}
}
