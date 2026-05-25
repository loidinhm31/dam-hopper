import { describe, expect, it } from "vitest";
import { splitActionToPaneDirection } from "./TabBar.js";

describe("splitActionToPaneDirection", () => {
  it("maps split-right to a horizontal pane split", () => {
    expect(splitActionToPaneDirection("right")).toBe("horizontal");
  });

  it("maps split-down to a vertical pane split", () => {
    expect(splitActionToPaneDirection("down")).toBe("vertical");
  });
});
