import { afterEach, describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { TerminalCursorGeometryAdapter } from "@/lib/terminal-cursor-geometry-adapter.js";
import "@xterm/xterm/css/xterm.css";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height);
}

function eventSource() {
  const listeners = new Set<() => void>();
  return {
    event: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    emit: () => listeners.forEach((listener) => listener()),
  };
}

function terminalFixture(host: HTMLElement): Terminal {
  const cursor = eventSource();
  const write = eventSource();
  const resize = eventSource();
  const scroll = eventSource();
  const bufferChange = eventSource();
  const textarea = document.createElement("textarea");
  // xterm's real helper textarea is intentionally off-screen, so the adapter
  // must use the measured screen-grid fallback in normal terminal rendering.
  textarea.getBoundingClientRect = () => rect(-100, -100, 10, 20);
  return {
    element: host,
    textarea,
    cols: 20,
    rows: 5,
    onCursorMove: cursor.event,
    onWriteParsed: write.event,
    onResize: resize.event,
    onScroll: scroll.event,
    buffer: {
      active: {
        type: "normal",
        cursorX: 1,
        cursorY: 1,
        viewportY: 0,
        baseY: 0,
      },
      onBufferChange: bufferChange.event,
    },
  } as unknown as Terminal;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("TerminalCursorGeometryAdapter in Chromium", () => {
  const hosts: HTMLElement[] = [];

  afterEach(() => hosts.splice(0).forEach((host) => host.remove()));

  it("coalesces geometry work and hides after host detachment", async () => {
    const host = document.createElement("div");
    host.getBoundingClientRect = () => rect(0, 0, 200, 100);
    const screen = document.createElement("div");
    screen.className = "xterm-screen";
    screen.getBoundingClientRect = () => rect(0, 0, 200, 100);
    host.append(screen);
    document.body.append(host);
    hosts.push(host);

    const geometries: Array<{ x: number } | null> = [];
    const adapter = new TerminalCursorGeometryAdapter(
      terminalFixture(host),
      (geometry) => geometries.push(geometry),
    );
    await nextFrame();
    expect(geometries).toEqual([
      expect.objectContaining({ x: 10, y: 20, availableWidth: 190 }),
    ]);

    adapter.invalidate();
    adapter.invalidate();
    adapter.invalidate();
    await nextFrame();
    expect(geometries).toHaveLength(2);

    host.remove();
    adapter.invalidate();
    await nextFrame();
    expect(geometries.at(-1)).toBeNull();
    adapter.dispose();
  });

  it("measures a live xterm screen grid when its helper textarea is off-host", async () => {
    const host = document.createElement("div");
    host.style.cssText = "width: 400px; height: 160px; position: fixed; left: 0; top: 0;";
    document.body.append(host);
    hosts.push(host);
    const terminal = new Terminal({ cols: 40, rows: 8, fontSize: 13 });
    terminal.open(host);
    await new Promise<void>((resolve) => terminal.write("git", resolve));
    // Keep the real terminal/screen layout, but simulate a renderer where the
    // helper textarea is not a reliable cursor rectangle.
    terminal.textarea.getBoundingClientRect = () => rect(-100, -100, 10, 20);

    const geometries: Array<{ x: number; availableWidth: number } | null> = [];
    const adapter = new TerminalCursorGeometryAdapter(terminal, (geometry) => {
      geometries.push(geometry);
    });
    await nextFrame();

    expect(geometries.at(-1)).toEqual(
      expect.objectContaining({ x: expect.any(Number), availableWidth: expect.any(Number) }),
    );
    adapter.dispose();
    terminal.dispose();
  });
});
