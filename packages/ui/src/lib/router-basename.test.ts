import { describe, expect, it } from "vitest";
import { normalizeRouterBasename } from "./router-basename.js";

describe("normalizeRouterBasename", () => {
  it("falls back to root for relative Vite base values", () => {
    expect(normalizeRouterBasename(undefined)).toBe("/");
    expect(normalizeRouterBasename(".")).toBe("/");
    expect(normalizeRouterBasename("./")).toBe("/");
    expect(normalizeRouterBasename("./nested/")).toBe("/");
  });

  it("preserves absolute basenames that React Router can match", () => {
    expect(normalizeRouterBasename("/")).toBe("/");
    expect(normalizeRouterBasename("/dam-hopper/")).toBe("/dam-hopper");
    expect(normalizeRouterBasename("dam-hopper/")).toBe("/dam-hopper");
  });
});
