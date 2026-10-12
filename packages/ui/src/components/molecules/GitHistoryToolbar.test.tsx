// @vitest-environment jsdom
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { GitHistoryToolbar } from "./GitHistoryToolbar.js";

function triggerInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("GitHistoryToolbar search input focus retention", () => {
  it("keeps search input enabled and interactive when isLoading is true", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(GitHistoryToolbar, {
          searchText: "init",
          onSearchChange: vi.fn(),
          onClearSearch: vi.fn(),
          isLoading: true, // background query is fetching
          disabled: false,
        }),
      );
    });

    const searchInput = container.querySelector("input") as HTMLInputElement;
    expect(searchInput).not.toBeNull();
    expect(searchInput.disabled).toBe(false);

    // Refresh and pagination should remain disabled while loading
    const refreshBtn = container.querySelector(
      'button[aria-label="Refresh history"]',
    ) as HTMLButtonElement;
    expect(refreshBtn?.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("respects explicit disabled prop", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(GitHistoryToolbar, {
          searchText: "",
          onSearchChange: vi.fn(),
          onClearSearch: vi.fn(),
          isLoading: false,
          disabled: true,
        }),
      );
    });

    const searchInput = container.querySelector("input") as HTMLInputElement;
    expect(searchInput).not.toBeNull();
    expect(searchInput.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("retains focus and element identity when search query triggers background isLoading transitions", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function StatefulToolbarHarness() {
      const [searchText, setSearchText] = useState("");
      const [isLoading, setIsLoading] = useState(false);

      const handleSearchChange = (text: string) => {
        setSearchText(text);
        // Simulate query debounce triggering async fetch
        if (text.length >= 1) {
          setIsLoading(true);
        }
      };

      return createElement(GitHistoryToolbar, {
        searchText,
        onSearchChange: handleSearchChange,
        onClearSearch: () => setSearchText(""),
        isLoading,
      });
    }

    await act(async () => {
      root.render(createElement(StatefulToolbarHarness));
    });

    const searchInput = container.querySelector("input") as HTMLInputElement;
    searchInput.focus();
    expect(document.activeElement).toBe(searchInput);

    // Keystroke 1: "f"
    await act(async () => {
      triggerInputValue(searchInput, "f");
    });

    // Input remains enabled and focused despite isLoading transition
    expect(searchInput.disabled).toBe(false);
    expect(document.activeElement).toBe(searchInput);
    expect(searchInput.value).toBe("f");

    // Keystroke 2: "fi"
    await act(async () => {
      triggerInputValue(searchInput, "fi");
    });

    expect(searchInput.disabled).toBe(false);
    expect(document.activeElement).toBe(searchInput);
    expect(searchInput.value).toBe("fi");

    // Keystroke 3: "fix"
    await act(async () => {
      triggerInputValue(searchInput, "fix");
    });

    expect(searchInput.disabled).toBe(false);
    expect(document.activeElement).toBe(searchInput);
    expect(searchInput.value).toBe("fix");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
