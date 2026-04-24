// Module-level singleton registry for xterm.js Terminal instances.
// Terminals must NOT be stored in React state — this module provides
// imperative access keyed by sessionId.

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

export interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
}

export const terminalRegistry = new Map<string, TerminalEntry>();

export function registerTerminal(id: string, terminal: Terminal, fitAddon: FitAddon): void {
  terminalRegistry.set(id, { terminal, fitAddon });
}

export function getTerminal(id: string): TerminalEntry | undefined {
  return terminalRegistry.get(id);
}

export function removeTerminal(id: string): void {
  terminalRegistry.delete(id);
}
