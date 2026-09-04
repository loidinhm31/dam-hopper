import { describe, expect, it } from "vitest";
import {
  buildForcePushDialogDescription,
  buildForcePushDialogWarning,
  GitForcePushDialog,
} from "./GitForcePushDialog.js";

describe("GitForcePushDialog", () => {
  it("builds destructive copy for the selected project and root", () => {
    expect(buildForcePushDialogDescription("dam-hopper", "Project root")).toBe(
      "Overwrite the upstream history for dam-hopper on Project root.",
    );
    expect(buildForcePushDialogWarning()).toContain("This is destructive.");
  });

  it("exports a component", () => {
    expect(typeof GitForcePushDialog).toBe("function");
    expect(GitForcePushDialog.name).toBe("GitForcePushDialog");
  });
});
