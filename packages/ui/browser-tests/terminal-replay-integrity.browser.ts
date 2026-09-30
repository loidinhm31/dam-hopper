import { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTerminalBufferReplay } from "@/lib/terminal-buffer-replay.js";
import {
  createTerminalStreamReplayGate,
  resetTerminalStreamReplayGateForAttach,
  shouldForwardTerminalData,
} from "@/lib/terminal-stream-replay-gate.js";
import "@xterm/xterm/css/xterm.css";

function write(terminal: Terminal, data: string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  terminal.write(data, resolve);
  return promise;
}

describe("terminal replay state in Chromium", () => {
  let host: HTMLDivElement;
  let terminal: Terminal;

  beforeEach(() => {
    host = document.createElement("div");
    host.style.cssText = "width:800px;height:400px;position:relative";
    document.body.append(host);
    terminal = new Terminal({ cols: 80, rows: 16 });
    terminal.open(host);
  });

  afterEach(() => {
    terminal.dispose();
    host.remove();
  });

  it("replaces the old prompt and terminal modes during full replay", async () => {
    await write(terminal, "\x1b[?1049h\x1b[?7l\x1b[5;9H❯ ");
    const replay = Promise.withResolvers<void>();
    applyTerminalBufferReplay(
      terminal,
      { data: "❯ ", offset: 4, reset: true, truncated: false, incarnation: 1 },
      replay.resolve,
    );
    await replay.promise;

    expect(terminal.buffer.active.type).toBe("normal");
    expect(terminal.modes.wraparoundMode).toBe(true);
    expect(terminal.buffer.active.cursorX).toBe(2);
    expect(terminal.buffer.active.cursorY).toBe(0);
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
      "❯ ",
    );
  });

  it("preserves cursor and alternate-screen modes for contiguous delta replay", async () => {
    await write(terminal, "\x1b[?1049h\x1b[?7l\x1b[5;9H❯ ");
    const replay = Promise.withResolvers<void>();
    applyTerminalBufferReplay(
      terminal,
      { data: "界", offset: 7, reset: false, truncated: false, incarnation: 1 },
      replay.resolve,
    );
    await replay.promise;

    expect(terminal.buffer.active.type).toBe("alternate");
    expect(terminal.modes.wraparoundMode).toBe(false);
    expect(terminal.buffer.active.cursorX).toBe(12);
    expect(terminal.buffer.active.cursorY).toBe(4);
    expect(terminal.buffer.active.getLine(4)?.translateToString(true)).toBe(
      "        ❯ 界",
    );
  });

  it("drains preceding parser writes before replacing the screen", async () => {
    terminal.write("stale prompt ❯ ");
    const replay = Promise.withResolvers<void>();
    applyTerminalBufferReplay(
      terminal,
      {
        data: "fresh ❯ ",
        offset: 10,
        reset: true,
        truncated: false,
        incarnation: 1,
      },
      replay.resolve,
    );
    await replay.promise;
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
      "fresh ❯ ",
    );
  });

  it("fences historical replies across attach resets without suppressing live replies", async () => {
    const gate = createTerminalStreamReplayGate();
    const replies: string[] = [];
    const forwarded: string[] = [];
    terminal.onData((data) => {
      replies.push(data);
      if (shouldForwardTerminalData(gate)) forwarded.push(data);
    });
    const replay = Promise.withResolvers<void>();
    applyTerminalBufferReplay(
      terminal,
      {
        data: "\x1b[6n\x1b]10;?\x07\x1b]11;?\x07\x1b[c",
        offset: 30,
        reset: true,
        truncated: false,
        incarnation: 1,
      },
      replay.resolve,
      gate,
    );
    resetTerminalStreamReplayGateForAttach(gate);
    await replay.promise;
    expect(replies).toContain("\x1b[1;1R");
    expect(forwarded).toEqual([]);

    await write(terminal, "\x1b[6n");
    expect(forwarded).toEqual(["\x1b[1;1R"]);
  });
});
