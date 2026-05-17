import { describe, expect, it } from "vitest";
import { withUiConfigDefaults } from "./ui-config.js";

describe("withUiConfigDefaults", () => {
  it("hydrates new shortcut defaults when ui config is absent", () => {
    const ui = withUiConfigDefaults();
    expect(ui.searchTextShortcut).toBe("Mod+Shift+KeyF");
    expect(ui.searchFilenameShortcut).toBe("DoubleShift");
  });

  it("preserves existing fields while normalizing provided shortcuts", () => {
    const ui = withUiConfigDefaults({
      editorFontSize: 18,
      terminalOrder: ["one"],
      searchTextShortcut: "ctrl+shift+p",
    });

    expect(ui.editorFontSize).toBe(18);
    expect(ui.terminalOrder).toEqual(["one"]);
    expect(ui.searchTextShortcut).toBe("Ctrl+Shift+KeyP");
    expect(ui.searchFilenameShortcut).toBe("DoubleShift");
  });
});
