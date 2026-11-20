import { describe, expect, it } from "vitest";
import type { CanvasPointerInput } from "@/browser-host/input-controller.js";
import {
  clearPreClickHoverBuffer,
  computeClickDwellMs,
  consumePreClickHoverTrail,
  createPreClickHoverBuffer,
  recordPreClickHover,
} from "./browser-preclick-hover.js";

function pointerAt(clientX: number, clientY: number): CanvasPointerInput {
  return {
    currentTarget: null,
    clientX,
    clientY,
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };
}

describe("browser-preclick-hover", () => {
  it("caps recent moves to 5 within 600ms, falls back to latest past 600ms, and clears on consume", () => {
    const buffer = createPreClickHoverBuffer();
    for (let i = 1; i <= 7; i += 1) {
      recordPreClickHover(buffer, pointerAt(i * 10, i * 10), 1000 + i * 10);
    }

    const trail = consumePreClickHoverTrail(buffer, pointerAt(80, 80), 1100);
    expect(trail.map((p) => p.clientX)).toEqual([30, 40, 50, 60, 70, 80]);
    expect(consumePreClickHoverTrail(buffer, pointerAt(80, 80), 1100)).toEqual([]);

    recordPreClickHover(buffer, pointerAt(42, 42), 1000);
    const staleTrail = consumePreClickHoverTrail(buffer, pointerAt(42, 42), 2000);
    expect(staleTrail.map((p) => p.clientX)).toEqual([42]);

    recordPreClickHover(buffer, pointerAt(99, 99), 2100);
    clearPreClickHoverBuffer(buffer);
    expect(consumePreClickHoverTrail(buffer, pointerAt(100, 100), 2110)).toEqual([]);
  });

  it("clamps click dwell between 45ms and 180ms and handles non-finite timestamps", () => {
    expect(computeClickDwellMs(1000, 1000)).toBe(45);
    expect(computeClickDwellMs(1000, 1010)).toBe(45);
    expect(computeClickDwellMs(1000, 1110)).toBe(110);
    expect(computeClickDwellMs(1000, 1500)).toBe(180);
    expect(computeClickDwellMs(Number.NaN, 1000)).toBe(45);
    expect(computeClickDwellMs(1000, Number.POSITIVE_INFINITY)).toBe(45);
  });
});
