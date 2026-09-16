// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsImportExportPanel } from "./SettingsImportExportPanel.js";

describe("SettingsImportExportPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders export and import action rows with active workspace wording", () => {
    act(() => {
      root.render(
        <SettingsImportExportPanel
          onExport={vi.fn()}
          exportPending={false}
          exportMsg={null}
          exportErr={null}
          onImportFile={vi.fn()}
          importPending={false}
          importMsg={null}
          importErr={null}
        />,
      );
    });

    expect(container.textContent).toContain("Export Settings");
    expect(container.textContent).toContain("Download the active workspace");
    expect(container.textContent).toContain("Import Settings");
    expect(container.textContent).toContain("Replace the active workspace configuration");
  });

  it("calls onExport when export button is clicked", () => {
    const onExport = vi.fn();
    act(() => {
      root.render(
        <SettingsImportExportPanel
          onExport={onExport}
          exportPending={false}
          exportMsg={null}
          exportErr={null}
          onImportFile={vi.fn()}
          importPending={false}
          importMsg={null}
          importErr={null}
        />,
      );
    });

    const exportBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Export"),
    );
    expect(exportBtn).toBeTruthy();

    act(() => {
      exportBtn?.click();
    });
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("triggers hidden file input and calls onImportFile upon selection", () => {
    const onImportFile = vi.fn();
    act(() => {
      root.render(
        <SettingsImportExportPanel
          onExport={vi.fn()}
          exportPending={false}
          exportMsg={null}
          exportErr={null}
          onImportFile={onImportFile}
          importPending={false}
          importMsg={null}
          importErr={null}
        />,
      );
    });

    const fileInput = container.querySelector<HTMLInputElement>("input[type='file']");
    expect(fileInput).toBeTruthy();
    expect(fileInput?.accept).toBe(".toml");

    const clickSpy = vi.spyOn(fileInput!, "click");
    const importBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Import"),
    );
    expect(importBtn).toBeTruthy();

    act(() => {
      importBtn?.click();
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const testFile = new File(["[workspace]\nname = 'test'\n"], "dam-hopper.toml", {
      type: "application/toml",
    });

    act(() => {
      Object.defineProperty(fileInput, "files", {
        value: [testFile],
        writable: true,
      });
      fileInput?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onImportFile).toHaveBeenCalledTimes(1);
    expect(onImportFile).toHaveBeenCalledWith(testFile);
    // Value was reset to allow re-selection of same file
    expect(fileInput?.value).toBe("");
  });

  it("disables buttons when operations are pending", () => {
    act(() => {
      root.render(
        <SettingsImportExportPanel
          onExport={vi.fn()}
          exportPending={true}
          exportMsg={null}
          exportErr={null}
          onImportFile={vi.fn()}
          importPending={true}
          importMsg={null}
          importErr={null}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[0]?.textContent).toContain("Exporting…");
    expect(buttons[1]?.disabled).toBe(true);
    expect(buttons[1]?.textContent).toContain("Importing…");
  });

  it("displays success and error status messages", () => {
    act(() => {
      root.render(
        <SettingsImportExportPanel
          onExport={vi.fn()}
          exportPending={false}
          exportMsg="Exported successfully"
          exportErr={null}
          onImportFile={vi.fn()}
          importPending={false}
          importMsg={null}
          importErr="Failed to import"
        />,
      );
    });

    expect(container.textContent).toContain("Exported successfully");
    expect(container.textContent).toContain("Failed to import");
  });
});
