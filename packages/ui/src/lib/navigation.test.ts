import { describe, expect, it } from "vitest";
import { BASE_NAV, getNavEntries } from "./navigation.js";

describe("getNavEntries", () => {
  it("returns BASE_NAV without SSH forwarding entry", () => {
    const entries = getNavEntries();
    expect(entries).toEqual(BASE_NAV);
    expect(entries.some((entry) => entry.to === "/ssh-forwarding")).toBe(false);
    expect(entries.some((entry) => entry.to === "/usage")).toBe(false);
  });
});
