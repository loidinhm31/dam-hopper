// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HubStuckLaunchNotice } from "./HubStuckLaunchNotice.js";
import type { StuckLaunchResolution } from "../terminal-launch-lifecycle.js";
import { terminalKey } from "@/api/ownership.js";

describe("HubStuckLaunchNotice", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("renders blocked reason and triggers resolveStuckLaunch on Clear stuck launch", async () => {
    const resolveStuckLaunchFn = vi.fn().mockResolvedValue({
      kind: "found",
      target: {
        profileId: "p1",
        generation: 1,
        terminalId: "term-100",
        incarnation: "inc-1",
      },
    } as StuckLaunchResolution);

    const onSelectTerminal = vi.fn();
    const onDismiss = vi.fn();

    act(() => {
      root?.render(
        <HubStuckLaunchNotice
          reason="Launch blocked by active lock"
          attemptId="attempt-123"
          profileId="p1"
          onSelectTerminal={onSelectTerminal}
          onDismiss={onDismiss}
          resolveStuckLaunchFn={resolveStuckLaunchFn}
        />,
      );
    });

    expect(container?.textContent).toContain("Launch blocked by active lock");
    const clearBtn = container?.querySelector("button:not([aria-label])") as HTMLButtonElement;
    expect(clearBtn.textContent).toContain("Clear stuck launch");

    await act(async () => {
      clearBtn.click();
    });

    expect(resolveStuckLaunchFn).toHaveBeenCalledWith({
      attemptId: "attempt-123",
      confirmNotCreated: false,
    });
    expect(onSelectTerminal).toHaveBeenCalledWith(
      terminalKey({ profileId: "p1", id: "term-100" }),
    );
    expect(onDismiss).toHaveBeenCalled();
  });

  it("handles definitely-absent by opening ConfirmDialog, and confirms with confirmNotCreated: true", async () => {
    let callCount = 0;
    const resolveStuckLaunchFn = vi.fn().mockImplementation(async (input: { attemptId: string; confirmNotCreated: boolean }) => {
      callCount++;
      if (input.confirmNotCreated) {
        return { kind: "cleared" } as StuckLaunchResolution;
      }
      return { kind: "definitely-absent" } as StuckLaunchResolution;
    });

    const onCleared = vi.fn();
    const onLaunchAgain = vi.fn();
    const onDismiss = vi.fn();

    act(() => {
      root?.render(
        <HubStuckLaunchNotice
          reason="Launch blocked by stuck attempt"
          attemptId="attempt-456"
          profileId="p1"
          onCleared={onCleared}
          onLaunchAgain={onLaunchAgain}
          onDismiss={onDismiss}
          resolveStuckLaunchFn={resolveStuckLaunchFn}
        />,
      );
    });

    const clearBtn = container?.querySelector("button:not([aria-label])") as HTMLButtonElement;
    await act(async () => {
      clearBtn.click();
    });

    // Confirm dialog should be open
    expect(document.body.textContent).toContain("Mark launch not created?");
    expect(document.body.textContent).toContain("No terminal with id attempt-456 exists on p1");

    // Click confirm in dialog
    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Mark not created",
    );
    expect(confirmBtn).toBeDefined();

    await act(async () => {
      confirmBtn?.click();
    });

    expect(resolveStuckLaunchFn).toHaveBeenCalledWith({
      attemptId: "attempt-456",
      confirmNotCreated: true,
    });
    expect(onCleared).toHaveBeenCalled();

    // Now "Launch again" button should be visible
    const launchAgainBtn = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.trim() === "Launch again",
    );
    expect(launchAgainBtn).toBeDefined();

    act(() => {
      launchAgainBtn?.click();
    });
    expect(onLaunchAgain).toHaveBeenCalled();
  });

  it("handles non-cleared resolutions by showing informative message without offering Launch again", async () => {
    const resolveStuckLaunchFn = vi.fn().mockResolvedValue({
      kind: "in-flight",
    } as StuckLaunchResolution);

    act(() => {
      root?.render(
        <HubStuckLaunchNotice
          reason="Blocked"
          attemptId="attempt-99"
          profileId="p1"
          onDismiss={() => {}}
          resolveStuckLaunchFn={resolveStuckLaunchFn}
        />,
      );
    });

    const clearBtn = container?.querySelector("button:not([aria-label])") as HTMLButtonElement;
    await act(async () => {
      clearBtn.click();
    });

    expect(container?.textContent).toContain("Launch still in progress in this window — wait");
    // "Launch again" MUST NOT be present
    expect(container?.textContent).not.toContain("Launch again");
    // "Clear stuck launch" is still retryable
    expect(container?.textContent).toContain("Clear stuck launch");
  });
});
