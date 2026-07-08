import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadJson, formatDownloadTimestamp } from "./download-json.js";

describe("download-json", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const localTimestamp = new Date(2026, 6, 7, 18, 29, 5);

  it("formats timestamps for deterministic file names", () => {
    expect(formatDownloadTimestamp(localTimestamp)).toBe("20260707-182905");
  });

  it("downloads JSON and cleans up the temporary object URL", () => {
    const click = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click,
    };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    const createElement = vi.fn(() => anchor);
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();

    vi.stubGlobal("document", {
      createElement,
      body: {
        appendChild,
        removeChild,
      },
    });
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });

    const fileName = downloadJson(
      { diagnosticSchemaVersion: 1, frontend: { logs: [] } },
      {
        filePrefix: "dam-hopper-diagnostics",
        now: localTimestamp,
      },
    );

    expect(fileName).toBe("dam-hopper-diagnostics-20260707-182905.json");
    expect(createElement).toHaveBeenCalledWith("a");
    expect(anchor.href).toBe("blob:test");
    expect(anchor.download).toBe(
      "dam-hopper-diagnostics-20260707-182905.json",
    );
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledTimes(1);
    expect(removeChild).toHaveBeenCalledWith(anchor);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
