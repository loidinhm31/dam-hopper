import { describe, expect, it } from "vitest";
import { resolveDragOverlayTitle } from "./SplitLayout.js";

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
