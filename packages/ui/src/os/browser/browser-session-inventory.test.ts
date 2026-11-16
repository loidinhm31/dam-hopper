// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acknowledgeUnknownOperationRisk,
  clearInventoryAcksForTesting,
  closeSelectedInventorySession,
  getVerifiedBrowserSession,
  isOperationRiskAcknowledged,
  listVerifiedBrowserSessions,
} from "./browser-session-inventory.js";
import { clearCloseLifecycleForTesting } from "./browser-close-lifecycle.js";
import type { BrowserOwnerScope } from "./browser-tab-types.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import type { ConnectionRef } from "@/api/ownership.js";
import * as client from "@/api/browser-host-client.js";
import * as ownerScopeModule from "./browser-owner-scope.js";

describe("browser-session-inventory", () => {
  const scope: BrowserOwnerScope = {
    profileId: "p1",
    endpoint: "https://hub.example.com",
    principal: "alice",
    namespace: "prod",
  };
  const owner: ConnectionRef = { profileId: "p1", generation: 1 };

  const runningDto: BrowserSessionDto = {
    browserSessionId: "s-1",
    browserIncarnation: "1",
    profileEpoch: "1",
    navigationRevision: "1",
    viewportEpoch: "1",
    url: "https://example.com/running",
    title: "Running",
    status: "running",
    geometry: { cssWidth: 1280, cssHeight: 800, offsetTop: 0, scrollX: 0, scrollY: 0, pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1 },
    inputAvailable: true,
  };

  const closingDto: BrowserSessionDto = {
    ...runningDto,
    browserSessionId: "s-closing",
    status: "closing",
  };

  beforeEach(() => {
    localStorage.clear();
    clearInventoryAcksForTesting();
    clearCloseLifecycleForTesting();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback(),
      },
    });
    vi.spyOn(ownerScopeModule, "isCapturedBrowserOwnerCurrent").mockReturnValue(true);
  });

  it("lists verified sessions excluding closing/lost targets and respecting owner currency", async () => {
    vi.spyOn(client, "listBrowserSessions").mockResolvedValue([runningDto, closingDto]);

    const sessions = await listVerifiedBrowserSessions(owner, scope);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.browserSessionId).toBe("s-1");

    // Owner mismatch returns empty list
    vi.spyOn(ownerScopeModule, "isCapturedBrowserOwnerCurrent").mockReturnValue(false);
    const staleSessions = await listVerifiedBrowserSessions(owner, scope);
    expect(staleSessions).toHaveLength(0);
  });

  it("retrieves verified session by ID and rejects closing or non-running targets", async () => {
    vi.spyOn(client, "getBrowserSession").mockResolvedValueOnce(runningDto);
    const s1 = await getVerifiedBrowserSession(owner, scope, "s-1");
    expect(s1?.browserSessionId).toBe("s-1");

    vi.spyOn(client, "getBrowserSession").mockResolvedValueOnce(closingDto);
    const sClosing = await getVerifiedBrowserSession(owner, scope, "s-closing");
    expect(sClosing).toBeNull();
  });

  it("delegates selected session closure to closeBrowserTarget", async () => {
    vi.spyOn(client, "getBrowserSession").mockResolvedValue(runningDto);
    const deleteSpy = vi.spyOn(client, "closeBrowserSession").mockResolvedValue(undefined);
    const res = await closeSelectedInventorySession(owner, scope, "s-1", "w-dummy");
    expect(res.kind).toBe("closed");
    expect(deleteSpy).toHaveBeenCalledWith(owner, "s-1", undefined);
  });

  it("tracks explicit duplicate-risk acknowledgment without clearing persistent notices", () => {
    expect(isOperationRiskAcknowledged("op-unk-1")).toBe(false);
    acknowledgeUnknownOperationRisk("op-unk-1");
    expect(isOperationRiskAcknowledged("op-unk-1")).toBe(true);
  });
});
