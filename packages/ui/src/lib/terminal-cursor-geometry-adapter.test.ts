import { describe, expect, it } from "vitest";
import {
  geometryFromScreenGrid,
  geometryFromTextarea,
  normalizeCursorGeometry,
} from "./terminal-cursor-geometry-adapter.js";

const host = {
  left: 10,
  top: 20,
  right: 210,
  bottom: 120,
  width: 200,
  height: 100,
};

describe("terminal cursor geometry", () => {
  it("uses a validated textarea rectangle relative to the terminal host", () => {
    expect(
      geometryFromTextarea(host, {
        left: 50,
        top: 40,
        right: 60,
        bottom: 60,
        width: 10,
        height: 20,
      }),
    ).toEqual({ x: 50, y: 20, lineHeight: 20, availableWidth: 150 });
  });

  it("rejects an off-host textarea measurement", () => {
    expect(
      geometryFromTextarea(host, {
        left: -9,
        top: 40,
        right: 1,
        bottom: 60,
        width: 10,
        height: 20,
      }),
    ).toBeNull();
  });

  it("falls back to a validated screen grid", () => {
    expect(geometryFromScreenGrid(host, host, 20, 5, 4, 2)).toEqual({
      x: 40,
      y: 40,
      lineHeight: 20,
      availableWidth: 160,
    });
  });

  it("rejects cursor positions outside the visible grid", () => {
    expect(geometryFromScreenGrid(host, host, 20, 5, 20, 2)).toBeNull();
  });

  it("normalizes rendered geometry into host CSS pixels", () => {
    expect(
      normalizeCursorGeometry(
        { x: 40, y: 20, lineHeight: 16, availableWidth: 128 },
        { left: 0, top: 0, right: 160, bottom: 80, width: 160, height: 80 },
        { clientWidth: 200, clientHeight: 100 },
      ),
    ).toEqual({ x: 50, y: 25, lineHeight: 20, availableWidth: 160 });
  });

  it("rejects normalization when the host has no layout size", () => {
    expect(
      normalizeCursorGeometry(
        { x: 40, y: 20, lineHeight: 16, availableWidth: 128 },
        host,
        { clientWidth: 0, clientHeight: 100 },
      ),
    ).toBeNull();
  });
});
