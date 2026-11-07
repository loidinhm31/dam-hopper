import { describe, expect, it } from "vitest";
import { parseDockTarget, resolveDragOverlayTitle } from "./SplitLayout.js";

describe("resolveDragOverlayTitle", () => {
  it("keeps the structured title for open tabs", () => {
    const title = {
      baseLabel: "a very long terminal",
      ordinal: 2,
      fullText: "a very long terminal #2",
    };
    expect(
      resolveDragOverlayTitle({
        sessionId: "stable-session-id",
        label: title.baseLabel,
        title,
      }),
    ).toEqual({ title, label: title.baseLabel });
  });

  it("uses a readable fallback without exposing an identity", () => {
    expect(resolveDragOverlayTitle(undefined)).toEqual({
      title: undefined,
      label: "Terminal",
    });
  });
});

describe("parseDockTarget", () => {
  it("parses pane center target", () => {
    expect(parseDockTarget("pane:pane-1:center")).toEqual({
      kind: "pane-center",
      paneId: "pane-1",
    });
  });

  it("parses pane edge targets", () => {
    expect(parseDockTarget("pane:pane-1:edge:left")).toEqual({
      kind: "pane-edge",
      paneId: "pane-1",
      edge: "left",
    });
    expect(parseDockTarget("pane:pane-1:edge:bottom")).toEqual({
      kind: "pane-edge",
      paneId: "pane-1",
      edge: "bottom",
    });
  });

  it("parses tabs index target", () => {
    expect(parseDockTarget("tabs:pane-2:index:3")).toEqual({
      kind: "tab-index",
      paneId: "pane-2",
      index: 3,
    });
  });

  it("returns null for invalid targets", () => {
    expect(parseDockTarget("invalid")).toBeNull();
    expect(parseDockTarget("pane:p1:unknown")).toBeNull();
    expect(parseDockTarget("tabs:p1:index:not-a-number")).toBeNull();
  });
});
