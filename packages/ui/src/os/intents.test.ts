import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIntent,
  dispatchIntent,
  globalIntentRouter,
  registerIntentHandler,
} from "./intents.js";

describe("OS Typed Intents", () => {
  beforeEach(() => {
    globalIntentRouter.clear();
  });

  it("returns unhandled safe no-op for unregistered intents without side-effects", async () => {
    const intent = createIntent("file:open", {
      profileId: "p1",
      projectId: "proj1",
      filePath: "/src/main.rs",
    });

    const result = await dispatchIntent(intent);
    expect(result.status).toBe("unhandled");
    if (result.status === "unhandled") {
      expect(result.reason).toContain("No catalog handler registered");
    }
  });

  it("dispatches to registered handler and unsubscribes cleanly", async () => {
    const handler = vi.fn().mockResolvedValue({
      status: "handled" as const,
      targetWindowId: "win-term-1",
    });

    const unsubscribe = registerIntentHandler("terminal:open", handler);

    const intent = createIntent("terminal:open", {
      profileId: "p1",
      cwd: "/home/user",
    });

    const result = await dispatchIntent(intent);
    expect(result.status).toBe("handled");
    if (result.status === "handled") {
      expect(result.targetWindowId).toBe("win-term-1");
    }
    expect(handler).toHaveBeenCalledTimes(1);

    // Unsubscribe handler
    unsubscribe();

    const secondResult = await dispatchIntent(intent);
    expect(secondResult.status).toBe("unhandled");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("handles handler exception fail-closed with invalid status", async () => {
    registerIntentHandler("browser:open", () => {
      throw new Error("Target connection refused");
    });

    const intent = createIntent("browser:open", {
      profileId: "p1",
      url: "http://localhost:3000",
    });

    const result = await dispatchIntent(intent);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.error).toContain("Target connection refused");
    }
  });

  it("dispatches terminal:place-existing with typed TerminalPlacementIntent", async () => {
    const handler = vi.fn().mockResolvedValue({
      status: "handled" as const,
      targetWindowId: "win-term-1",
    });

    registerIntentHandler("terminal:place-existing", handler);

    const intent = createIntent("terminal:place-existing", {
      sourceHubWindowId: "win-hub-1",
      action: "open-beside",
      target: {
        profileId: "p1",
        generation: 1,
        serverEpoch: "c18f1f50-3bf0-4566-b333-e18e8df52ea2",
        terminalId: "term-1",
        incarnation: "1",
      },
    });

    const result = await dispatchIntent(intent);
    expect(result.status).toBe("handled");
    expect(handler).toHaveBeenCalledWith(intent);
  });

  it("dispatches session-changes:open with full ReviewTarget tuple", async () => {
    const handler = vi.fn().mockResolvedValue({
      status: "handled" as const,
      targetWindowId: "win-review-1",
    });

    registerIntentHandler("session-changes:open", handler);

    const intent = createIntent("session-changes:open", {
      profileId: "p1",
      generation: 1,
      terminalId: "term-1",
      terminalIncarnation: "1",
      ompSessionId: "omp-1",
      serverEpoch: "c18f1f50-3bf0-4566-b333-e18e8df52ea2",
      rootId: "git-root",
      baselineId: "base-1",
    });

    const result = await dispatchIntent(intent);
    expect(result.status).toBe("handled");
    expect(handler).toHaveBeenCalledWith(intent);
  });
});
