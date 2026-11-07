// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, useEffect, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import {
  ShellInputProvider,
  useShellInputContext,
  type ShellInputContextValue,
} from "./shell-input-context.js";
import { claimContextMenu, releaseContextMenu } from "@/lib/context-menu-coordinator.js";

describe("ShellInputContext modal registration", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
  });

  it("registers and unregisters modal mount tokens with stable callback identity", async () => {
    let capturedContext: ShellInputContextValue | null = null;

    function TestConsumer(): ReactElement {
      capturedContext = useShellInputContext();
      return createElement("div", null, `depth: ${capturedContext.modalDepth}`);
    }

    await act(async () => {
      root?.render(
        createElement(ShellInputProvider, null, createElement(TestConsumer)),
      );
    });

    expect(capturedContext).not.toBeNull();
    const initialCallback = capturedContext!.registerModalMount;
    expect(capturedContext!.modalDepth).toBe(0);
    expect(capturedContext!.isTerminalSuppressed).toBe(false);

    let unregister: (() => void) | undefined;
    await act(async () => {
      unregister = capturedContext!.registerModalMount("confirm-dialog");
    });

    expect(capturedContext!.modalDepth).toBe(1);
    expect(capturedContext!.isTerminalSuppressed).toBe(true);
    // Callback identity must be stable across registrations
    expect(capturedContext!.registerModalMount).toBe(initialCallback);

    await act(async () => {
      unregister?.();
    });

    expect(capturedContext!.modalDepth).toBe(0);
    expect(capturedContext!.isTerminalSuppressed).toBe(false);
  });

  it("does not cause an effect loop when consumer depends on [open, registerModalMount]", async () => {
    let effectRunCount = 0;
    let setOpenState: ((val: boolean) => void) | null = null;

    function TestConsumer(): ReactElement {
      const { registerModalMount } = useShellInputContext();
      const [open, setOpen] = useState(false);
      setOpenState = setOpen;

      useEffect(() => {
        if (open) {
          effectRunCount += 1;
          return registerModalMount("server-profiles-dialog");
        }
      }, [open, registerModalMount]);

      return createElement("div", null, open ? "open" : "closed");
    }

    await act(async () => {
      root?.render(
        createElement(ShellInputProvider, null, createElement(TestConsumer)),
      );
    });

    expect(effectRunCount).toBe(0);

    // Open modal
    await act(async () => {
      setOpenState?.(true);
    });

    // Effect must run exactly once, NOT loop!
    expect(effectRunCount).toBe(1);

    // Close modal
    await act(async () => {
      setOpenState?.(false);
    });

    expect(effectRunCount).toBe(1);
  });

  it("reflects context menu open state in isTerminalSuppressed", async () => {
    let capturedContext: ShellInputContextValue | null = null;
    function TestConsumer(): ReactElement {
      capturedContext = useShellInputContext();
      return createElement("div");
    }

    await act(async () => {
      root?.render(
        createElement(ShellInputProvider, null, createElement(TestConsumer)),
      );
    });

    expect(capturedContext!.isTerminalSuppressed).toBe(false);

    const close = () => {};
    await act(async () => {
      claimContextMenu(close);
    });

    expect(capturedContext!.isTerminalSuppressed).toBe(true);

    await act(async () => {
      releaseContextMenu(close);
    });

    expect(capturedContext!.isTerminalSuppressed).toBe(false);
  });
});
