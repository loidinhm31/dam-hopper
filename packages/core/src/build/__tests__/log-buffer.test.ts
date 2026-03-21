import { describe, it, expect, beforeEach } from "vitest";
import { LogBuffer } from "../log-buffer.js";
import type { ProcessLogEntry } from "../types.js";

function entry(line: string, stream: "stdout" | "stderr" = "stdout"): ProcessLogEntry {
  return { timestamp: new Date(), stream, line };
}

describe("LogBuffer", () => {
  let buf: LogBuffer;

  beforeEach(() => {
    buf = new LogBuffer(5); // small maxSize for testing
  });

  it("starts empty", () => {
    expect(buf.getAll()).toEqual([]);
  });

  it("stores pushed entries", () => {
    buf.push(entry("a"));
    buf.push(entry("b"));
    expect(buf.getAll()).toHaveLength(2);
    expect(buf.getAll()[0].line).toBe("a");
    expect(buf.getAll()[1].line).toBe("b");
  });

  it("evicts oldest when exceeding maxSize", () => {
    for (let i = 0; i < 7; i++) buf.push(entry(String(i)));
    const all = buf.getAll();
    expect(all).toHaveLength(5);
    expect(all[0].line).toBe("2");
    expect(all[4].line).toBe("6");
  });

  it("getLast returns last N entries", () => {
    for (let i = 0; i < 5; i++) buf.push(entry(String(i)));
    const last = buf.getLast(3);
    expect(last).toHaveLength(3);
    expect(last[0].line).toBe("2");
    expect(last[2].line).toBe("4");
  });

  it("getLast with N > buffer size returns all", () => {
    buf.push(entry("a"));
    buf.push(entry("b"));
    expect(buf.getLast(10)).toHaveLength(2);
  });

  it("clear empties buffer", () => {
    buf.push(entry("x"));
    buf.clear();
    expect(buf.getAll()).toEqual([]);
  });

  it("uses default maxSize of 1000", () => {
    const big = new LogBuffer();
    for (let i = 0; i < 1001; i++) big.push(entry(String(i)));
    expect(big.getAll()).toHaveLength(1000);
    expect(big.getAll()[0].line).toBe("1");
  });
});
