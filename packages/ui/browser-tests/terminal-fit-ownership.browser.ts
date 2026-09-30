import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { expect, it } from "vitest";
import { TerminalFindController } from "@/lib/terminal-find-controller.js";
import { createTerminalRendererController } from "@/lib/terminal-renderer.js";
import { attachTerminalsToHost } from "@/lib/terminal-host-attachment.js";
import {
  fitAllTerminals,
  fitTerminalNow,
} from "@/lib/terminal-fit-scheduler.js";
import {
  registerTerminal,
  removeTerminal,
  subscribeToRegistry,
} from "@/lib/terminal-registry.js";
import "@xterm/xterm/css/xterm.css";

it("fits initial attachment with its chosen renderer and preserves geometry while hidden", async () => {
  const host = document.createElement("div");
  host.style.cssText = "position:relative;width:1000px;height:500px";
  document.body.append(host);
  const boundary = document.createElement("div");
  boundary.style.cssText = "position:absolute;inset:0";
  host.append(boundary);
  const terminal = new Terminal({ cols: 80, rows: 24, fontSize: 13 });
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.open(boundary);
  const find = new TerminalFindController(searchAddon);
  const renderer = createTerminalRendererController(terminal);
  const sizes: Array<{ cols: number; rows: number }> = [];
  terminal.onResize(({ cols, rows }) => sizes.push({ cols, rows }));
  const id = "initial-visible-fit";
  const unsubscribe = subscribeToRegistry((changed) => {
    if (changed === id)
      attachTerminalsToHost({
        host,
        sessionIds: [id],
        activeSessionId: id,
        suppressTerminalFocus: true,
      });
  });
  try {
    const entry = registerTerminal(
      id,
      terminal,
      fitAddon,
      find,
      boundary,
      undefined,
      () => renderer.commitRenderer("webgl"),
    );
    const finalSize = { cols: terminal.cols, rows: terminal.rows };
    expect(renderer.currentRenderer).toBe("webgl");
    fitTerminalNow(entry);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    expect(sizes).toEqual([finalSize]);
    host.style.display = "none";
    fitAllTerminals([entry]);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    expect({ cols: terminal.cols, rows: terminal.rows }).toEqual(finalSize);
    expect(sizes).toEqual([finalSize]);
    host.style.display = "block";
    attachTerminalsToHost({
      host,
      sessionIds: [id],
      activeSessionId: id,
      suppressTerminalFocus: true,
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    expect(sizes).toEqual([finalSize]);
  } finally {
    unsubscribe();
    removeTerminal(id);
    find.dispose();
    renderer.dispose();
    terminal.dispose();
    host.remove();
  }
});
