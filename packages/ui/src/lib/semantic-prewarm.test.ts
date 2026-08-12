import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrewarmIntent } from "@dam-hopper/shared";
import { SemanticPrewarmController } from "./semantic-prewarm.js";

const intent: PrewarmIntent = {
  profileId: "profile",
  workspaceId: "workspace:1",
  workspaceGeneration: 1,
  projectId: "project",
  language: "rust",
  tabGeneration: 1,
};

describe("SemanticPrewarmController", () => {
  afterEach(() => vi.useRealTimers());

  it("includes workspace generations in the prewarm identity", () => {
    vi.useFakeTimers();
    const prewarm = vi.fn(() => true);
    const controller = new SemanticPrewarmController({ prewarm });
    controller.schedule(intent, {
      supported: true,
      hydrated: true,
      active: true,
    });
    controller.schedule(
      { ...intent, workspaceGeneration: 2 },
      { supported: true, hydrated: true, active: true },
    );
    vi.advanceTimersByTime(750);
    expect(prewarm).toHaveBeenCalledOnce();
    expect(prewarm).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceGeneration: 2 }),
    );
  });

  it("waits exactly 750ms and cancels churn", () => {
    vi.useFakeTimers();
    const prewarm = vi.fn(() => true);
    const controller = new SemanticPrewarmController({ prewarm });
    controller.schedule(intent, {
      supported: true,
      hydrated: true,
      active: true,
    });
    vi.advanceTimersByTime(749);
    expect(prewarm).not.toHaveBeenCalled();
    controller.cancel();
    vi.advanceTimersByTime(1);
    expect(prewarm).not.toHaveBeenCalled();
  });

  it("bypasses dwell for explicit navigation and emits once per key", () => {
    vi.useFakeTimers();
    const prewarm = vi.fn(() => true);
    const controller = new SemanticPrewarmController({ prewarm });
    controller.schedule(intent, {
      supported: true,
      hydrated: true,
      active: true,
    });
    controller.navigate(intent);
    expect(prewarm).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(750);
    expect(prewarm).toHaveBeenCalledOnce();
    controller.schedule(
      { ...intent, tabGeneration: 2 },
      { supported: true, hydrated: true, active: true },
    );
    vi.advanceTimersByTime(750);
    controller.schedule(intent, {
      supported: true,
      hydrated: true,
      active: true,
    });
    vi.advanceTimersByTime(750);
    expect(prewarm).toHaveBeenCalledTimes(2);
  });
});
