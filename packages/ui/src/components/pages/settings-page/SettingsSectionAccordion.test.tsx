// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsSectionAccordion } from "./SettingsSectionAccordion.js";

describe("SettingsSectionAccordion", () => {
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

  it("toggles open and closed in uncontrolled mode", () => {
    act(() => {
      root.render(
        <SettingsSectionAccordion
          title="Appearance"
          description="Theme and styling preferences"
          defaultOpen={false}
        >
          <div>Accordion Content</div>
        </SettingsSectionAccordion>,
      );
    });

    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      button.click();
    });

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Accordion Content");

    act(() => {
      button.click();
    });

    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("respects controlled open and invokes onOpenChange", () => {
    const onOpenChange = vi.fn();

    act(() => {
      root.render(
        <SettingsSectionAccordion
          title="Appearance"
          description="Theme and styling preferences"
          open={true}
          onOpenChange={onOpenChange}
        >
          <div>Controlled Content</div>
        </SettingsSectionAccordion>,
      );
    });

    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      button.click();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
