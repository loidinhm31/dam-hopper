// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";
import {
  formatClaimKey,
  globalResourceRegistry,
} from "@/os/resource-registry.js";
import { buildTerminalClaimKey } from "@/os/terminal-claim-key.js";
import { registerTerminal, terminalRegistry } from "@/lib/terminal-registry.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import type { TerminalAttachGate } from "@/components/organisms/MultiTerminalDisplay.js";
import {
  useHubTerminalAttachGate,
  type UseHubTerminalAttachGateOptions,
} from "./use-hub-terminal-attach-gate.js";

function makeTarget(
  profileId: string,
  terminalId: string,
  incarnation = "1",
  serverEpoch = "epoch-1",
  generation = 1,
): TerminalTarget {
  return {
    profileId,
    generation,
    terminalId,
    incarnation,
    serverEpoch,
  };
}

describe("useHubTerminalAttachGate", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestGate: TerminalAttachGate | undefined;

  function TestHarness({
    options,
  }: {
    options: UseHubTerminalAttachGateOptions | null;
  }) {
    latestGate = useHubTerminalAttachGate(options);
    return null;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    globalResourceRegistry.clear();
    terminalRegistry.clear();
    useWindowStore.getState().setSession(createDefaultOsSession("desk-1", "Main"));
    latestGate = undefined;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    globalResourceRegistry.clear();
    terminalRegistry.clear();
    container.remove();
    document.body.innerHTML = "";
  });

  it("returns undefined when options is null and holds no claims", () => {
    act(() => {
      root.render(createElement(TestHarness, { options: null }));
    });
    expect(latestGate).toBeUndefined();
    expect(globalResourceRegistry.getClaimsForWindow("hub-1")).toHaveLength(0);
  });

  it("claims all desired sessions including hidden tabs", () => {
    const t1 = makeTarget("p1", "term-1");
    const t2 = makeTarget("p1", "term-2");
    const targets: Record<string, TerminalTarget> = {
      "term-1": t1,
      "term-2": t2,
    };

    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-1",
            sessionIds: ["term-1", "term-2"],
            resolveTarget: (id) => targets[id],
          },
        }),
      );
    });

    expect(latestGate).toBeDefined();
    const claims = globalResourceRegistry.getClaimsForWindow("hub-1");
    expect(claims).toHaveLength(2);

    const k1 = formatClaimKey(buildTerminalClaimKey({ target: t1 }));
    const k2 = formatClaimKey(buildTerminalClaimKey({ target: t2 }));
    expect(claims.some((c) => formatClaimKey(c.key) === k1)).toBe(true);
    expect(claims.some((c) => formatClaimKey(c.key) === k2)).toBe(true);
  });

  it("first claim wins vs competing window and yields placeholder for loser", () => {
    const target = makeTarget("p1", "term-1");
    // Window win-1 claims first
    const key = buildTerminalClaimKey({ target });
    globalResourceRegistry.claim(key, "win-1");

    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-2",
            sessionIds: ["term-1"],
            resolveTarget: () => target,
          },
        }),
      );
    });

    expect(latestGate).toBeDefined();
    // hub-2 does NOT hold the claim
    expect(globalResourceRegistry.getClaimsForWindow("hub-2")).toHaveLength(0);

    // resolveTerminal returns undefined for lost claim
    expect(latestGate?.resolveTerminal("term-1")).toBeUndefined();

    // renderPlaceholder returns placeholder indicating claimed-elsewhere by win-1
    const placeholder = latestGate?.renderPlaceholder("term-1");
    expect(placeholder).not.toBeNull();
  });

  it("takes over claim after previous holder releases", () => {
    const target = makeTarget("p1", "term-1");
    const key = buildTerminalClaimKey({ target });
    globalResourceRegistry.claim(key, "win-1");

    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-2",
            sessionIds: ["term-1"],
            resolveTarget: () => target,
          },
        }),
      );
    });

    expect(globalResourceRegistry.getClaimsForWindow("hub-2")).toHaveLength(0);

    // Now win-1 releases
    act(() => {
      globalResourceRegistry.release(key, "win-1");
    });

    // hub-2 takes over!
    expect(globalResourceRegistry.getClaimsForWindow("hub-2")).toHaveLength(1);
    expect(latestGate?.renderPlaceholder("term-1")).toBeNull();
  });

  it("releases only its own claims on unmount", () => {
    const target1 = makeTarget("p1", "term-1");
    const target2 = makeTarget("p1", "term-2");

    // Other window holds target2
    const key2 = buildTerminalClaimKey({ target: target2 });
    globalResourceRegistry.claim(key2, "other-win");

    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-1",
            sessionIds: ["term-1"],
            resolveTarget: () => target1,
          },
        }),
      );
    });

    expect(globalResourceRegistry.getClaimsForWindow("hub-1")).toHaveLength(1);
    expect(globalResourceRegistry.getClaimsForWindow("other-win")).toHaveLength(1);

    // Unmount hub-1
    act(() => {
      root.unmount();
    });

    // hub-1 claims released, other-win claims untouched
    expect(globalResourceRegistry.getClaimsForWindow("hub-1")).toHaveLength(0);
    expect(globalResourceRegistry.getClaimsForWindow("other-win")).toHaveLength(1);
  });

  it("leaves exactly one claim under StrictMode double-mount lifecycle", () => {
    const target = makeTarget("p1", "term-1");

    // First mount
    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-1",
            sessionIds: ["term-1"],
            resolveTarget: () => target,
          },
        }),
      );
    });
    expect(globalResourceRegistry.getClaimsForWindow("hub-1")).toHaveLength(1);

    // Simulate StrictMode unmount
    act(() => {
      root.unmount();
    });
    expect(globalResourceRegistry.getClaimsForWindow("hub-1")).toHaveLength(0);

    // Remount
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-1",
            sessionIds: ["term-1"],
            resolveTarget: () => target,
          },
        }),
      );
    });
    expect(globalResourceRegistry.getClaimsForWindow("hub-1")).toHaveLength(1);
  });

  it("causes zero claim churn on re-renders with equal key sets", () => {
    const target = makeTarget("p1", "term-1");
    const claimSpy = vi.spyOn(globalResourceRegistry, "claim");
    const releaseSpy = vi.spyOn(globalResourceRegistry, "release");

    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-1",
            sessionIds: ["term-1"],
            resolveTarget: () => target,
          },
        }),
      );
    });

    expect(claimSpy).toHaveBeenCalledTimes(1);
    expect(releaseSpy).not.toHaveBeenCalled();

    claimSpy.mockClear();
    releaseSpy.mockClear();

    // Re-render with new array instance but identical sessions
    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-1",
            sessionIds: ["term-1"],
            resolveTarget: () => target,
          },
        }),
      );
    });

    // Zero claim/release churn!
    expect(claimSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();

    claimSpy.mockRestore();
    releaseSpy.mockRestore();
  });

  it("releases old incarnation claim and claims new incarnation on same-id replacement", () => {
    const targetV1 = makeTarget("p1", "term-1", "1", "epoch-1");
    const targetV2 = makeTarget("p1", "term-1", "2", "epoch-1");
    let currentTarget = targetV1;

    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-1",
            sessionIds: ["term-1"],
            resolveTarget: () => currentTarget,
          },
        }),
      );
    });

    const keyV1 = formatClaimKey(buildTerminalClaimKey({ target: targetV1 }));
    const claimsV1 = globalResourceRegistry.getClaimsForWindow("hub-1");
    expect(claimsV1).toHaveLength(1);
    expect(formatClaimKey(claimsV1[0].key)).toBe(keyV1);

    // Replacement incarnation arrives
    currentTarget = targetV2;
    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-1",
            sessionIds: ["term-1"],
            resolveTarget: () => currentTarget,
          },
        }),
      );
    });

    const keyV2 = formatClaimKey(buildTerminalClaimKey({ target: targetV2 }));
    const claimsV2 = globalResourceRegistry.getClaimsForWindow("hub-1");
    expect(claimsV2).toHaveLength(1);
    expect(formatClaimKey(claimsV2[0].key)).toBe(keyV2);
  });

  it("detects legacy presenter from window store when untargeted standalone has matching PTY", () => {
    const target = makeTarget("p1", "term-legacy");

    // Add untargeted standalone window to windowStore
    useWindowStore.setState((s) => ({
      ...s,
      session: {
        ...s.session,
        windows: {
          ...s.session.windows,
          "win-legacy": {
            id: "win-legacy",
            appId: "terminals",
            title: "Terminal",
            desktopId: "desk-1",
            bounds: { x: 0, y: 0, width: 800, height: 600 },
            state: "normal",
            zIndex: 1,
            ctx: { profileId: "p1" },
            appState: { sessionId: "term-legacy" },
          },
        },
      },
    }));

    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-1",
            sessionIds: ["term-legacy"],
            resolveTarget: () => target,
          },
        }),
      );
    });

    const placeholder = latestGate?.renderPlaceholder("term-legacy");
    expect(placeholder).not.toBeNull();
  });

  it("releases claims without leak when options transitions from active to null", () => {
    const target = makeTarget("p1", "term-1");

    act(() => {
      root.render(
        createElement(TestHarness, {
          options: {
            hubWindowId: "hub-1",
            sessionIds: ["term-1"],
            resolveTarget: () => target,
          },
        }),
      );
    });

    expect(globalResourceRegistry.getClaimsForWindow("hub-1")).toHaveLength(1);

    // Transition to null
    act(() => {
      root.render(createElement(TestHarness, { options: null }));
    });

    expect(latestGate).toBeUndefined();
    expect(globalResourceRegistry.getClaimsForWindow("hub-1")).toHaveLength(0);
  });
});
