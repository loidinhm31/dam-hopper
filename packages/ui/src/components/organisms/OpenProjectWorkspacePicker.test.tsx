// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectKey } from "@/api/ownership.js";
import type { AggregatedProjectItem } from "@/hooks/use-aggregated-projects.js";
import type { ProjectWithStatus } from "@/api/client.js";
import { OpenProjectWorkspacePicker } from "./OpenProjectWorkspacePicker.js";

function makeProjectItem(
  profileId: string,
  projectName: string,
  profileName: string = profileId,
): AggregatedProjectItem {
  const project: ProjectWithStatus = {
    name: projectName,
    path: `/workspace/${projectName}`,
  };
  return {
    profileId,
    profileName,
    serverUrl: `http://${profileId}.local`,
    project,
    ref: { profileId, project: projectName },
  };
}

describe("OpenProjectWorkspacePicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders trigger button with aria-haspopup and aria-expanded", async () => {
    await act(async () => {
      root.render(
        <OpenProjectWorkspacePicker
          items={[]}
          openGroupIds={new Set()}
          onOpen={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open project workspace"]',
    )!;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("lists inventory grouped by profile and marks already-open workspaces as disabled", async () => {
    const item1 = makeProjectItem("server-a", "repo-alpha", "Server Alpha");
    const item2 = makeProjectItem("server-a", "repo-beta", "Server Alpha");
    const item3 = makeProjectItem("server-b", "repo-gamma", "Server Beta");

    const openKey = projectKey(item1.ref);
    const openGroupIds = new Set<string>([openKey]);
    const onOpen = vi.fn();

    await act(async () => {
      root.render(
        <OpenProjectWorkspacePicker
          items={[item1, item2, item3]}
          openGroupIds={openGroupIds}
          onOpen={onOpen}
        />,
      );
    });

    // Open popup
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open project workspace"]',
    )!;
    act(() => trigger.click());

    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    // Check group headers
    const groups = container.querySelectorAll('[role="group"]');
    expect(groups.length).toBe(2);
    expect(groups[0]?.getAttribute("aria-label")).toBe("Server Alpha");
    expect(groups[1]?.getAttribute("aria-label")).toBe("Server Beta");

    // Check options
    const options = container.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options.length).toBe(3);

    // First option (repo-alpha) is already open -> disabled
    expect(options[0]?.textContent).toContain("repo-alpha");
    expect(options[0]?.textContent).toContain("open");
    expect(options[0]?.disabled).toBe(true);
    expect(options[0]?.getAttribute("aria-disabled")).toBe("true");

    // Clicking disabled option does not call onOpen
    act(() => options[0]?.click());
    expect(onOpen).not.toHaveBeenCalled();

    // Clicking enabled option (repo-beta) calls onOpen and closes popup
    act(() => options[1]?.click());
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith({
      profileId: "server-a",
      project: "repo-beta",
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("displays loading state when isLoading is true", async () => {
    await act(async () => {
      root.render(
        <OpenProjectWorkspacePicker
          items={[]}
          openGroupIds={new Set()}
          isLoading={true}
          onOpen={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open project workspace"]',
    )!;
    act(() => trigger.click());

    const listbox = container.querySelector('[role="listbox"]')!;
    expect(listbox.textContent).toContain("Loading projects...");
  });

  it("displays empty state when items is empty and not loading", async () => {
    await act(async () => {
      root.render(
        <OpenProjectWorkspacePicker
          items={[]}
          openGroupIds={new Set()}
          isLoading={false}
          onOpen={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open project workspace"]',
    )!;
    act(() => trigger.click());

    const listbox = container.querySelector('[role="listbox"]')!;
    expect(listbox.textContent).toContain("No projects available");
  });

  it("handles keyboard navigation: Escape closes and restores focus, ArrowDown skips open items, Enter selects", async () => {
    const item1 = makeProjectItem("server-a", "open-proj");
    const item2 = makeProjectItem("server-a", "selectable-proj");
    const openGroupIds = new Set<string>([projectKey(item1.ref)]);
    const onOpen = vi.fn();

    await act(async () => {
      root.render(
        <OpenProjectWorkspacePicker
          items={[item1, item2]}
          openGroupIds={openGroupIds}
          onOpen={onOpen}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open project workspace"]',
    )!;
    trigger.focus();

    // ArrowDown on trigger opens popup and selects first selectable item
    act(() => {
      container.firstElementChild?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    // The selectable item is "selectable-proj"
    const options = container.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");

    // Escape closes popup and restores focus to trigger
    act(() => {
      container.firstElementChild?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // Re-open with ArrowDown and press Enter to select
    act(() => {
      container.firstElementChild?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    act(() => {
      container.firstElementChild?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onOpen).toHaveBeenCalledWith({
      profileId: "server-a",
      project: "selectable-proj",
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});
