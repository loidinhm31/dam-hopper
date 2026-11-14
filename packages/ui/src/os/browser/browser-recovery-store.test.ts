// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_RECOVERY_STORAGE_KEY,
  clearRememberedPagesAndSuppress,
  consumeRememberedBrowserGroup,
  isOwnerAddressSuppressed,
  loadBrowserRecoveryDisk,
  resetAddressSuppression,
  saveBrowserRecoveryDisk,
  settleRecoveryOperation,
  stageRecoveryOperation,
  settleRecoveryOperationsIfAuthorized,
  withBrowserRecoveryLock,
} from "./browser-recovery-store.js";
import type {
  BrowserOwnerScope,
  BrowserRecoveryOperation,
  RememberedBrowserGroup,
} from "./browser-tab-types.js";
import { useWindowStore } from "../window-store.js";

describe("browser-recovery-store", () => {
  const scopeA: BrowserOwnerScope = {
    profileId: "p1",
    endpoint: "https://hub.example.com",
    principal: "alice",
    namespace: "prod",
  };
  const scopeB: BrowserOwnerScope = {
    profileId: "p2",
    endpoint: "https://hub.example.com",
    principal: "bob",
    namespace: "dev",
  };

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback(),
      },
    });
  });

  it("fails closed when navigator.locks is unavailable", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await expect(withBrowserRecoveryLock(async () => 42)).rejects.toThrow(/Web Locks API is unavailable/);
  });

  it("converts pending operations to unknown on load", () => {
    const op: BrowserRecoveryOperation = {
      operationId: "op-1",
      ownerScope: scopeA,
      kind: "create",
      windowId: "win-1",
      status: "pending",
    };
    saveBrowserRecoveryDisk({ version: 1, groups: [], addressSuppressedScopes: [], operations: [op] });
    const loaded = loadBrowserRecoveryDisk();
    expect(loaded.operations[0]?.status).toBe("unknown");
  });

  it("stages operation and settles it under lock", async () => {
    const groupA: RememberedBrowserGroup = {
      version: 1,
      groupId: "g-a",
      ownerScope: scopeA,
      addresses: ["https://example.com/a"],
      activeIndex: 0,
    };
    const opA: BrowserRecoveryOperation = {
      operationId: "op-a",
      ownerScope: scopeA,
      kind: "close-window",
      windowId: "w-a",
      status: "pending",
    };

    await stageRecoveryOperation(opA, groupA);
    const disk = loadBrowserRecoveryDisk();
    expect(disk.groups).toHaveLength(1);
    expect(disk.operations).toHaveLength(1);

    await settleRecoveryOperation("op-a");
    const afterSettle = loadBrowserRecoveryDisk();
    expect(afterSettle.operations).toHaveLength(0);
    expect(afterSettle.groups).toHaveLength(1);
  });

  it("blocks group consumption while operations are pending/unknown, consuming only after settlement", async () => {
    const groupA: RememberedBrowserGroup = {
      version: 1,
      groupId: "g-a",
      ownerScope: scopeA,
      addresses: ["https://example.com/1"],
      activeIndex: 0,
    };
    await stageRecoveryOperation(
      { operationId: "op-1", ownerScope: scopeA, kind: "close-window", windowId: "w1", groupId: "g-a", status: "pending" },
      groupA,
    );

    // 1. Pending operation blocks automatic restore
    const blocked = await consumeRememberedBrowserGroup(scopeA);
    expect(blocked).toBeNull();

    // 2. Settle operation under lock
    await settleRecoveryOperation("op-1");

    // 3. Now eligible for single consumption
    const consumed1 = await consumeRememberedBrowserGroup(scopeA);
    expect(consumed1?.groupId).toBe("g-a");

    const consumed2 = await consumeRememberedBrowserGroup(scopeA);
    expect(consumed2).toBeNull();
  });

  it("persists suppression first and clears under lock", async () => {
    let stripped = false;
    const res = await clearRememberedPagesAndSuppress(scopeA, () => { stripped = true; });
    expect(res.success).toBe(true);
    expect(stripped).toBe(true);
    expect(isOwnerAddressSuppressed(scopeA)).toBe(true);

    await resetAddressSuppression(scopeA);
    expect(isOwnerAddressSuppressed(scopeA)).toBe(false);
  });

  it("retains suppression even if OS strip callback fails", async () => {
    const res = await clearRememberedPagesAndSuppress(scopeA, () => {
      throw new Error("Disk full");
    });
    expect(res.success).toBe(false);
    expect(isOwnerAddressSuppressed(scopeA)).toBe(true);
  });

  it("settleRecoveryOperationsIfAuthorized enforces expectedScope and blocks active closing.status === pending windows", async () => {
    const origWindows = useWindowStore.getState().session.windows;
    try {
      useWindowStore.setState({
        session: {
          ...useWindowStore.getState().session,
          windows: {
            "w-pending": {
              id: "w-pending",
              appId: "browser",
              title: "Pending",
              desktopId: "d1",
              mode: "tile",
              minimized: false,
              ctx: { profileId: "p1" },
              appState: { closing: { operationId: "op-win-pending", status: "pending" }, tabs: [], activeTabId: "t1" },
            },
          },
        },
      });

      await stageRecoveryOperation({ operationId: "op-win-pending", ownerScope: scopeA, kind: "close-window", windowId: "w-pending", status: "unknown" });
      await stageRecoveryOperation({ operationId: "op-child-pending", ownerScope: scopeA, kind: "close-tab", windowId: "w-pending", tabId: "t1", sessionId: "s1", status: "unknown" });
      await stageRecoveryOperation({ operationId: "op-foreign", ownerScope: scopeB, kind: "create", windowId: "w-other", tabId: "t2", status: "unknown" });
      await stageRecoveryOperation({ operationId: "op-ok", ownerScope: scopeA, kind: "create", windowId: "w-ok", tabId: "t3", status: "unknown" });

      const settled = await settleRecoveryOperationsIfAuthorized({
        operationIds: ["op-win-pending", "op-child-pending", "op-foreign", "op-ok"],
        expectedScope: scopeA,
        skipActiveClosingWindows: true,
      });

      expect(settled.map((o) => o.operationId)).toEqual(["op-ok"]);
      expect(loadBrowserRecoveryDisk().operations.map((o) => o.operationId)).toEqual([
        "op-win-pending",
        "op-child-pending",
        "op-foreign",
      ]);
    } finally {
      useWindowStore.setState({
        session: { ...useWindowStore.getState().session, windows: origWindows },
      });
    }
  });
});
