import { describe, expect, it } from "vitest";
import {
  createRememberedBrowserGroup,
  MAX_BROWSER_METADATA_BYTES,
  normalizeBrowserCommittedUrl,
  parseBrowserWindowDisk,
  projectBrowserWindowState,
} from "./browser-persistence.js";
import type { BrowserOwnerScope, BrowserWindowState } from "./browser-tab-types.js";

describe("browser-persistence", () => {
  const sampleOwner: BrowserOwnerScope = {
    profileId: "prof-1",
    endpoint: "https://hub.example.com",
    principal: "alice",
    namespace: "prod",
  };

  describe("normalizeBrowserCommittedUrl", () => {
    it("preserves query and hash parameters for ordinary URLs", () => {
      const url = "https://example.com/search?q=test&lang=en#heading-2";
      expect(normalizeBrowserCommittedUrl(url)).toBe(url);
    });

    it("conveniently prefixes schemeless localhost with http", () => {
      expect(normalizeBrowserCommittedUrl("localhost:3000/docs")).toBe("http://localhost:3000/docs");
      expect(normalizeBrowserCommittedUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080/");
    });

    it("conveniently prefixes other schemeless hosts with https", () => {
      expect(normalizeBrowserCommittedUrl("example.org/page")).toBe("https://example.org/page");
    });

    it("omits/rejects userinfo-bearing URLs", () => {
      expect(normalizeBrowserCommittedUrl("https://user:pass@example.com/page")).toBeUndefined();
    });

    it("rejects non-http(s) schemes and arbitrary search terms", () => {
      expect(normalizeBrowserCommittedUrl("ftp://files.example.com")).toBeUndefined();
      expect(normalizeBrowserCommittedUrl("javascript:alert(1)")).toBeUndefined();
      expect(normalizeBrowserCommittedUrl("file:///etc/passwd")).toBeUndefined();
      expect(normalizeBrowserCommittedUrl("not a url with spaces")).toBeUndefined();
    });
  });

  describe("projectBrowserWindowState", () => {
    const runtimeState: BrowserWindowState = {
      browserStateVersion: 1,
      ownerScope: sampleOwner,
      tabs: [
        {
          tabId: "tab-1",
          kind: "ordinary",
          committedUrl: "https://example.com/one?q=1#sec",
          sessionId: "sess-1",
          phase: "live",
          draft: { value: "https://example.com/one?q=1#sec", dirty: false },
          actionSequence: 1,
        },
        {
          tabId: "tab-popup",
          kind: "popup",
          committedUrl: "https://example.com/oauth/popup",
          sessionId: "sess-popup",
          parentTabId: "tab-1",
          phase: "live",
          draft: { value: "", dirty: false },
          actionSequence: 0,
        },
        {
          tabId: "tab-2",
          kind: "ordinary",
          committedUrl: "https://example.com/two",
          phase: "new-tab",
          draft: { value: "", dirty: false },
          actionSequence: 0,
        },
      ],
      activeTabId: "tab-popup",
    };

    it("projects local disk format retaining owner, ordinary session hints, excluding popups, and remapping active tab", () => {
      const projected = projectBrowserWindowState(runtimeState, "local");
      expect(projected.browserStateVersion).toBe(1);
      expect("ownerScope" in projected && projected.ownerScope).toEqual(sampleOwner);
      expect(projected.tabs).toHaveLength(2);
      expect(projected.tabs[0]).toEqual({
        tabId: "tab-1",
        committedUrl: "https://example.com/one?q=1#sec",
        sessionId: "sess-1",
      });
      // Popups are excluded; activeTabId was tab-popup whose parent is tab-1 -> remapped to tab-1
      expect(projected.activeTabId).toBe("tab-1");
    });

    it("projects portable/recipe format stripping ownerScope and session IDs", () => {
      const portable = projectBrowserWindowState(runtimeState, "portable");
      expect(portable.browserStateVersion).toBe(1);
      expect("ownerScope" in portable).toBe(false);
      expect(portable.tabs).toHaveLength(2);
      expect(portable.tabs[0]).toEqual({
        tabId: "tab-1",
        committedUrl: "https://example.com/one?q=1#sec",
      });
      expect("sessionId" in portable.tabs[0]!).toBe(false);
    });
  });

  describe("parseBrowserWindowDisk", () => {
    it("converts legacy flat schema into canonical browser state", () => {
      const legacy = {
        url: "https://legacy.example.com/dashboard",
        sessionId: "old-sess-99",
      };
      const res = parseBrowserWindowDisk(legacy, "local");
      expect(res.valid).toBe(true);
      expect(res.state?.browserStateVersion).toBe(1);
      expect(res.state?.tabs).toHaveLength(1);
      expect(res.state?.tabs[0]?.committedUrl).toBe("https://legacy.example.com/dashboard");
      // Unqualified legacy session ID is dropped per spec
      expect(res.state?.tabs[0]?.sessionId).toBeUndefined();
    });

    it("regenerates client tab IDs when importing", () => {
      const disk = {
        browserStateVersion: 1,
        tabs: [
          { tabId: "fixed-id-1", committedUrl: "https://example.com/a" },
          { tabId: "fixed-id-2", committedUrl: "https://example.com/b" },
        ],
        activeTabId: "fixed-id-2",
      };
      const res = parseBrowserWindowDisk(disk, "import");
      expect(res.valid).toBe(true);
      expect(res.state?.tabs[0]?.tabId).not.toBe("fixed-id-1");
      expect(res.state?.tabs[1]?.tabId).not.toBe("fixed-id-2");
      expect(res.state?.activeTabId).toBe(res.state?.tabs[1]?.tabId);
      expect(res.state?.tabs[0]?.phase).toBe("unavailable");
    });

    it("rejects oversized metadata above MAX_BROWSER_METADATA_BYTES", () => {
      const hugeData = {
        browserStateVersion: 1,
        tabs: [{ tabId: "t1", committedUrl: "https://example.com/" + "a".repeat(MAX_BROWSER_METADATA_BYTES + 10) }],
        activeTabId: "t1",
      };
      const res = parseBrowserWindowDisk(hugeData, "local");
      expect(res.valid).toBe(false);
      expect(res.error).toContain("exceeds limit");
    });

    it("rejects unsupported browserStateVersion", () => {
      const invalid = { browserStateVersion: 2, tabs: [{ tabId: "t1" }], activeTabId: "t1" };
      const res = parseBrowserWindowDisk(invalid, "local");
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Unsupported browserStateVersion");
    });
  });

  describe("createRememberedBrowserGroup", () => {
    it("creates remembered group filtering out popups and empty tabs", () => {
      const state: BrowserWindowState = {
        browserStateVersion: 1,
        tabs: [
          {
            tabId: "t1",
            kind: "ordinary",
            committedUrl: "https://example.com/1",
            phase: "live",
            draft: { value: "", dirty: false },
            actionSequence: 0,
          },
          {
            tabId: "t2",
            kind: "popup",
            committedUrl: "https://example.com/popup",
            phase: "live",
            draft: { value: "", dirty: false },
            actionSequence: 0,
          },
          {
            tabId: "t3",
            kind: "ordinary",
            phase: "new-tab",
            draft: { value: "", dirty: false },
            actionSequence: 0,
          },
          {
            tabId: "t4",
            kind: "ordinary",
            committedUrl: "https://example.com/4",
            phase: "live",
            draft: { value: "", dirty: false },
            actionSequence: 0,
          },
        ],
        activeTabId: "t4",
      };

      const group = createRememberedBrowserGroup(sampleOwner, state, "group-123");
      expect(group).not.toBeNull();
      expect(group?.groupId).toBe("group-123");
      expect(group?.addresses).toEqual(["https://example.com/1", "https://example.com/4"]);
      expect(group?.activeIndex).toBe(1); // t4 was active -> index 1 in addresses
    });

    it("returns null when no valid committed addresses exist", () => {
      const state: BrowserWindowState = {
        browserStateVersion: 1,
        tabs: [{
          tabId: "t1",
          kind: "ordinary",
          phase: "new-tab",
          draft: { value: "", dirty: false },
          actionSequence: 0,
        }],
        activeTabId: "t1",
      };
      expect(createRememberedBrowserGroup(sampleOwner, state)).toBeNull();
    });
  });
});
