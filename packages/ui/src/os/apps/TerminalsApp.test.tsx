// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalFindController } from "@/lib/terminal-find-controller.js";
import { TerminalsApp } from "./TerminalsApp.js";
import { WindowContextProvider } from "../window-context.js";
import { useWindowStore } from "../window-store.js";
import { globalResourceRegistry, formatClaimKey } from "../resource-registry.js";
import {
  registerTerminal,
  unregisterTerminal,
  terminalRegistry,
} from "@/lib/terminal-registry.js";
import {
  acquireTerminalPresentation,
  computePresentedInputSuppression,
  isCurrentTerminalPresenter,
  type TerminalPresentationToken,
} from "@/lib/terminal-presentation-input.js";
import { __setConnectionSnapshotForTests } from "@/api/connections.js";
import type { OsWindow } from "../types.js";
import { getLaunchAttempt, reserveTerminalLaunch } from "../persistence.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function createMockTerminal(): Terminal {
  const textarea = document.createElement("textarea");
  textarea.tabIndex = 0;
  const element = document.createElement("div");
  element.appendChild(textarea);
  return {
    options: {
      disableStdin: false,
    },
    textarea,
    element,
  } as unknown as Terminal;
}

const mockFitAddon = {
  fit: () => {},
  proposeDimensions: () => ({ cols: 80, rows: 24 }),
} as unknown as FitAddon;

const mockFindController = {
  findNext: () => false,
  findPrevious: () => false,
  close: () => {},
} as unknown as TerminalFindController;

describe("TerminalsApp (Phase 04 B1 revealWindow & F2 presentation input)", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    localStorage.clear();
    globalResourceRegistry.clear();
    terminalRegistry.clear();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    __setConnectionSnapshotForTests("profile-1", {
      status: "connected",
      owner: { profileId: "profile-1", generation: 1 },
      intent: true,
      serverUrl: "http://127.0.0.1:4803",
    });

    useWindowStore.setState({
      session: {
        schema: 1,
        activeDesktopId: "desk-1",
        desktops: [
          {
            id: "desk-1",
            name: "Desktop 1",
            tree: null,
            floatingWindowIds: ["term-win-1"],
            focusedWindowId: "term-win-1",
          },
          {
            id: "desk-2",
            name: "Desktop 2",
            tree: null,
            floatingWindowIds: ["win-holder"],
            focusedWindowId: null,
          },
        ],
        windows: {
          "term-win-1": {
            id: "term-win-1",
            appId: "terminals",
            title: "Terminals",
            ctx: { profileId: "profile-1" },
            mode: "float",
            desktopId: "desk-1",
            maximized: false,
            minimized: false,
            appState: {
              sessionId: "term-session-1",
              attachPolicy: "existing-only",
              incarnation: 1,
            },
          },
          "win-holder": {
            id: "win-holder",
            appId: "terminals",
            title: "Holder Terminals",
            ctx: { profileId: "profile-1" },
            mode: "float",
            desktopId: "desk-2",
            maximized: false,
            minimized: true, // minimized on desktop 2
            appState: {
              sessionId: "term-session-1",
            },
          },
        },
      },
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
    terminalRegistry.clear();
    globalResourceRegistry.clear();
  });

  it("calls revealWindow on denied button click, restoring and focusing holder window across desktops (B1)", async () => {
    // Pre-claim the terminal session under win-holder
    globalResourceRegistry.claim(
      {
        resourceKind: "terminal",
        profileId: "profile-1",
        generation: 1,
        resourceId: "term-session-1",
      },
      "win-holder",
    );

    const win = useWindowStore.getState().session.windows["term-win-1"];

    await act(async () => {
      root?.render(
        <WindowContextProvider
          window={win}
          isFocused={true}
          isActiveDesktop={true}
        >
          <TerminalsApp window={win} />
        </WindowContextProvider>,
      );
    });

    const deniedContainer = container?.querySelector('[data-os-claim-denied="true"]');
    expect(deniedContainer).not.toBeNull();

    const focusBtn = container?.querySelector('button[type="button"]') as HTMLButtonElement | null;
    expect(focusBtn).not.toBeNull();
    expect(focusBtn?.textContent).toBe("Focus Existing Window");

    // Click Focus Existing Window
    await act(async () => {
      focusBtn?.click();
    });

    // B1: Switched to Desktop 2, restored minimized win-holder, and focused it
    const session = useWindowStore.getState().session;
    expect(session.activeDesktopId).toBe("desk-2");
    expect(session.windows["win-holder"].minimized).toBe(false);
    const desk2 = session.desktops.find((d) => d.id === "desk-2")!;
    expect(desk2.focusedWindowId).toBe("win-holder");
  });

  it("acquires presentation on claim success + attach and releases symmetrically on unmount (F2)", async () => {
    const mockTerm = createMockTerminal();
    registerTerminal(
      { profileId: "profile-1", id: "term-session-1" },
      mockTerm,
      mockFitAddon,
      mockFindController,
    );

    const win = useWindowStore.getState().session.windows["term-win-1"];

    await act(async () => {
      root?.render(
        <WindowContextProvider
          window={win}
          isFocused={true}
          isActiveDesktop={true}
        >
          <TerminalsApp window={win} />
        </WindowContextProvider>,
      );
    });

    // Presentation acquired for terminals:term-win-1
    expect(computePresentedInputSuppression(mockTerm, false)).toBe(false);

    // Unmount TerminalsApp
    await act(async () => {
      root?.unmount();
      root = null;
    });

    // Presentation was symmetrically released: term has no presenter -> suppressed
    expect(computePresentedInputSuppression(mockTerm, false)).toBe(true);
  });

  it("handles successor takeover where unmounting old presenter does not disrupt successor (F2)", async () => {
    const mockTerm = createMockTerminal();
    registerTerminal(
      { profileId: "profile-1", id: "term-session-1" },
      mockTerm,
      mockFitAddon,
      mockFindController,
    );

    const win = useWindowStore.getState().session.windows["term-win-1"];

    await act(async () => {
      root?.render(
        <WindowContextProvider
          window={win}
          isFocused={true}
          isActiveDesktop={true}
        >
          <TerminalsApp window={win} />
        </WindowContextProvider>,
      );
    });

    // Successor (e.g. Hub pane) acquires presentation
    const successorToken = acquireTerminalPresentation(mockTerm, "hub:hub-win-1:pane-1");
    expect(isCurrentTerminalPresenter(mockTerm, successorToken)).toBe(true);
    expect(computePresentedInputSuppression(mockTerm, false)).toBe(false);

    // Now unmount TerminalsApp
    await act(async () => {
      root?.unmount();
      root = null;
    });

    // Successor is STILL the active presenter and stdin remains interactive!
    expect(isCurrentTerminalPresenter(mockTerm, successorToken)).toBe(true);
    expect(computePresentedInputSuppression(mockTerm, false)).toBe(false);
  });

  it("acquires presentation upon late renderer registration via registry change", async () => {
    const win = useWindowStore.getState().session.windows["term-win-1"];

    await act(async () => {
      root?.render(
        <WindowContextProvider
          window={win}
          isFocused={true}
          isActiveDesktop={true}
        >
          <TerminalsApp window={win} />
        </WindowContextProvider>,
      );
    });

    // Renderer not yet registered
    const mockTerm = createMockTerminal();

    // Late register
    await act(async () => {
      registerTerminal(
        { profileId: "profile-1", id: "term-session-1" },
        mockTerm,
        mockFitAddon,
        mockFindController,
      );
    });

    // Late registration triggered attach and acquired presentation
    expect(computePresentedInputSuppression(mockTerm, false)).toBe(false);
  });

  describe("Component launch lifecycle & parity (R5, Invariant C)", () => {
    function ConnectedTerminalsApp({ windowId }: { windowId: string }) {
      const win = useWindowStore((state) => state.session.windows[windowId]);
      if (!win) return null;
      return (
        <WindowContextProvider
          window={win}
          isFocused={true}
          isActiveDesktop={true}
        >
          <TerminalsApp window={win} />
        </WindowContextProvider>
      );
    }

    it("performs normal launch and updates appState and settles journal", async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        id: "term-session-new",
        incarnationExact: "1",
        incarnation: 1,
        serverEpoch: "123e4567-e89b-12d3-a456-426614174000",
      });

      __setConnectionSnapshotForTests("profile-1", {
        status: "connected",
        owner: { profileId: "profile-1", generation: 1 },
        intent: true,
        serverUrl: "http://127.0.0.1:4803",
        api: {
          terminal: {
            create: mockCreate,
          },
        } as unknown as Parameters<typeof __setConnectionSnapshotForTests>[1],
      });

      // Reserve an attempt in the store
      const identity = {
        profileId: "profile-1",
        endpointBinding: "default-endpoint",
        action: "terminal.create" as const,
        targetKind: "workspace",
        workspaceId: "profile-1",
        cwd: null,
      };
      const reserved = await reserveTerminalLaunch(identity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      const launchWin: OsWindow = {
        id: "win-launching",
        appId: "terminals",
        title: "Terminals",
        ctx: { profileId: "profile-1" },
        mode: "float",
        desktopId: "desk-1",
        maximized: false,
        minimized: false,
        appState: {
          sessionId: reserved.requestedTerminalId,
          requestedTerminalId: reserved.requestedTerminalId,
          attemptId: reserved.attemptId,
          dispatched: false,
        },
      };

      useWindowStore.getState().openWindow(launchWin, "desk-1");

      await act(async () => {
        root?.render(<ConnectedTerminalsApp windowId="win-launching" />);
      });

      // Verified API called
      expect(mockCreate).toHaveBeenCalled();

      // Verified appState updated
      const win = useWindowStore.getState().session.windows["win-launching"];
      expect(win.appState?.target).toEqual({
        profileId: "profile-1",
        generation: 1,
        terminalId: reserved.requestedTerminalId,
        incarnation: "1",
        serverEpoch: "123e4567-e89b-12d3-a456-426614174000",
      });
      expect(win.appState?.serverEpoch).toBe("123e4567-e89b-12d3-a456-426614174000");
      expect(win.appState?.createError).toBeUndefined();
    });

    it("unmount while create is pending settles journal normally (Hub-closed-while-pending semantics)", async () => {
      const { promise: createPromise, resolve: resolveCreate } =
        Promise.withResolvers<{
          id: string;
          incarnationExact: string;
          incarnation: number;
          serverEpoch: string;
        }>();

      __setConnectionSnapshotForTests("profile-1", {
        status: "connected",
        owner: { profileId: "profile-1", generation: 1 },
        intent: true,
        serverUrl: "http://127.0.0.1:4803",
        api: {
          terminal: {
            create: () => createPromise,
          },
        } as unknown as Parameters<typeof __setConnectionSnapshotForTests>[1],
      });

      const identity = {
        profileId: "profile-1",
        endpointBinding: "default-endpoint",
        action: "terminal.create" as const,
        targetKind: "workspace",
        workspaceId: "profile-1",
        cwd: null,
      };
      const reserved = await reserveTerminalLaunch(identity, {
        generation: 1,
        desktopId: "desk-1",
      });
      if (reserved.status !== "reserved") throw new Error("Reservation failed");

      const launchWin: OsWindow = {
        id: "win-pending",
        appId: "terminals",
        title: "Terminals",
        ctx: { profileId: "profile-1" },
        mode: "float",
        desktopId: "desk-1",
        maximized: false,
        minimized: false,
        appState: {
          sessionId: reserved.requestedTerminalId,
          requestedTerminalId: reserved.requestedTerminalId,
          attemptId: reserved.attemptId,
          dispatched: false,
        },
      };

      useWindowStore.getState().openWindow(launchWin, "desk-1");

      await act(async () => {
        root?.render(
          <WindowContextProvider
            window={launchWin}
            isFocused={true}
            isActiveDesktop={true}
          >
            <TerminalsApp window={launchWin} />
          </WindowContextProvider>,
        );
      });

      // Unmount component while launch is still in flight!
      await act(async () => {
        root?.unmount();
        root = null;
      });

      // Now server responds with success
      await act(async () => {
        resolveCreate({
          id: reserved.requestedTerminalId,
          incarnationExact: "1",
          incarnation: 1,
          serverEpoch: "123e4567-e89b-12d3-a456-426614174000",
        });
      });

      // Durable journal MUST be settled confirmed-success
      const read = getLaunchAttempt(reserved.attemptId);
      expect(read.status).toBe("ok");
      if (read.status === "ok") {
        expect(read.record.state).toBe("confirmed-success");
      }
    });
  });
});
