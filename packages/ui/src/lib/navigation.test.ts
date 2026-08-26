import { describe, expect, it } from "vitest";
import { BASE_NAV, getNavEntries } from "./navigation.js";

describe("getNavEntries", () => {
  it("keeps SSH forwarding absent without the native desktop host", () => {
    expect(getNavEntries({ sshForwardHostAvailable: false })).toEqual(BASE_NAV);
    expect(
      getNavEntries({ sshForwardHostAvailable: false }).some(
        (entry) => entry.to === "/ssh-forwarding",
      ),
    ).toBe(false);
  });

  it("adds the exact SSH forwarding entry only when available", () => {
    const entries = getNavEntries({ sshForwardHostAvailable: true });
    expect(entries.at(-1)).toMatchObject({
      to: "/ssh-forwarding",
      label: "SSH FORWARDS",
    });
  });
});
