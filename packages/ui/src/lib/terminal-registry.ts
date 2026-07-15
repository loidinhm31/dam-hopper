// Module-level singleton registry for xterm.js Terminal instances.
// Terminals must NOT be stored in React state — this module provides
// imperative access keyed by sessionId.

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalFindController } from "@/lib/terminal-find-controller.js";
import { cancelScheduledTerminalFit } from "@/lib/terminal-fit-scheduler.js";

export interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  findController: TerminalFindController;
  baseKeyEventHandler?: (event: KeyboardEvent) => boolean;
}

export const terminalRegistry = new Map<string, TerminalEntry>();

type RegistrySubscriber = (id: string) => void;
const subscribers = new Set<RegistrySubscriber>();

export function registerTerminal(
  id: string,
  terminal: Terminal,
  fitAddon: FitAddon,
  findController: TerminalFindController,
): TerminalEntry {
  const entry = { terminal, fitAddon, findController };
  terminalRegistry.set(id, entry);
  // Notify subscribers that a new terminal is ready
  subscribers.forEach((cb) => cb(id));
  return entry;
}

export function subscribeToRegistry(callback: RegistrySubscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function getTerminal(id: string): TerminalEntry | undefined {
  return terminalRegistry.get(id);
}

export function removeTerminal(id: string): void {
  cancelScheduledTerminalFit(terminalRegistry.get(id));
  terminalRegistry.delete(id);
}
