// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamQualityEvent } from "@/api/browser-host-types.js";
import {
  clearAllStreamQualityForTesting,
  clearStreamQuality,
  DEFAULT_STREAM_QUALITY_STATE,
  getQualityPreference,
  getStreamQuality,
  publishStreamQuality,
  releaseGeneration,
  releaseTab,
  releaseWindow,
  setQualityPreference,
  subscribeStreamQuality,
  type StreamQualityTuple,
} from "./browser-stream-quality.js";

const sampleEvent: StreamQualityEvent = {
  kind: "streamQuality",
  subscriptionEpoch: "sub-1",
  preference: "high",
  producerRun: "run-1",
  captureVersion: "100",
  sharedTier: "high",
  viewerTier: "high",
  fps: 30,
  jpegQuality: 85,
  scale: 1,
  imageWidth: 1920,
  imageHeight: 1080,
  audioSuppressed: false,
  audioReason: null,
  status: "effective",
};

describe("browser-stream-quality", () => {
  const tupleA: StreamQualityTuple = {
    profileId: "profile-1",
    generation: 1,
    windowId: "win-1",
    tabId: "tab-1",
  };

  const tupleB: StreamQualityTuple = {
    profileId: "profile-1",
    generation: 1,
    windowId: "win-1",
    tabId: "tab-2",
  };

  const tupleGen2: StreamQualityTuple = {
    profileId: "profile-1",
    generation: 2,
    windowId: "win-1",
    tabId: "tab-1",
  };

  const tupleWin2: StreamQualityTuple = {
    profileId: "profile-1",
    generation: 1,
    windowId: "win-2",
    tabId: "tab-1",
  };

  const tupleProf2: StreamQualityTuple = {
    profileId: "profile-2",
    generation: 1,
    windowId: "win-1",
    tabId: "tab-1",
  };

  beforeEach(() => {
    clearAllStreamQualityForTesting();
    window.localStorage?.clear();
    window.sessionStorage?.clear();
  });

  it("defaults preference to 'auto' with null status and pending false", () => {
    expect(getQualityPreference(tupleA)).toBe("auto");
    expect(getStreamQuality(tupleA)).toEqual(DEFAULT_STREAM_QUALITY_STATE);
  });

  it("sets preference and notifies subscriber with pending=true until server acks preference", () => {
    const listener = vi.fn();
    const unsub = subscribeStreamQuality(tupleA, listener);

    setQualityPreference(tupleA, "medium");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getQualityPreference(tupleA)).toBe("medium");
    expect(getStreamQuality(tupleA).pending).toBe(true);

    // Setting same preference is a no-op
    setQualityPreference(tupleA, "medium");
    expect(listener).toHaveBeenCalledTimes(1);

    // Event with different preference (e.g. stale auto) does NOT clear pending
    publishStreamQuality(tupleA, { ...sampleEvent, preference: "auto" });
    expect(getStreamQuality(tupleA).pending).toBe(true);
    expect(getStreamQuality(tupleA).ackedPreference).toBe("auto");

    // Event acknowledging medium preference clears pending even if settings are unchanged
    publishStreamQuality(tupleA, { ...sampleEvent, preference: "medium" });
    expect(getStreamQuality(tupleA).pending).toBe(false);
    expect(getStreamQuality(tupleA).ackedPreference).toBe("medium");

    unsub();
  });

  it("publishes status and clears pending flag when ack matches", () => {
    const listener = vi.fn();
    subscribeStreamQuality(tupleA, listener);

    setQualityPreference(tupleA, "high");
    expect(listener).toHaveBeenCalledTimes(1);

    publishStreamQuality(tupleA, sampleEvent);
    expect(listener).toHaveBeenCalledTimes(2);

    const state = getStreamQuality(tupleA);
    expect(state.preference).toBe("high");
    expect(state.ackedPreference).toBe("high");
    expect(state.status).toEqual(sampleEvent);
    expect(state.pending).toBe(false);

    // Identical event does not trigger listeners
    publishStreamQuality(tupleA, { ...sampleEvent });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("clears pending on unavailable status", () => {
    setQualityPreference(tupleA, "high");
    expect(getStreamQuality(tupleA).pending).toBe(true);

    publishStreamQuality(tupleA, {
      ...sampleEvent,
      preference: "auto",
      status: "unavailable",
    });

    expect(getStreamQuality(tupleA).pending).toBe(false);
  });

  it("clearStreamQuality clears status, ack, and pending while retaining preference", () => {
    const listener = vi.fn();
    subscribeStreamQuality(tupleA, listener);

    setQualityPreference(tupleA, "low");
    publishStreamQuality(tupleA, { ...sampleEvent, preference: "low" });
    listener.mockClear();

    clearStreamQuality(tupleA);
    expect(listener).toHaveBeenCalledTimes(1);

    const state = getStreamQuality(tupleA);
    expect(state.preference).toBe("low");
    expect(state.ackedPreference).toBeNull();
    expect(state.status).toBeNull();
    expect(state.pending).toBe(false);

    // Subsequent clear on empty status is a no-op
    clearStreamQuality(tupleA);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("isolates state across tab, window, profile, and generation", () => {
    setQualityPreference(tupleA, "high");
    publishStreamQuality(tupleA, sampleEvent);

    expect(getQualityPreference(tupleB)).toBe("auto");
    expect(getStreamQuality(tupleB).status).toBeNull();

    expect(getQualityPreference(tupleWin2)).toBe("auto");
    expect(getStreamQuality(tupleWin2).status).toBeNull();

    expect(getQualityPreference(tupleProf2)).toBe("auto");
    expect(getStreamQuality(tupleProf2).status).toBeNull();

    expect(getQualityPreference(tupleGen2)).toBe("auto");
    expect(getStreamQuality(tupleGen2).status).toBeNull();
  });

  it("releases tab on tab close without affecting sibling tabs", () => {
    setQualityPreference(tupleA, "high");
    setQualityPreference(tupleB, "low");

    releaseTab(tupleA);

    expect(getQualityPreference(tupleA)).toBe("auto");
    expect(getStreamQuality(tupleA)).toEqual(DEFAULT_STREAM_QUALITY_STATE);
    expect(getQualityPreference(tupleB)).toBe("low");
  });

  it("releases window on window close", () => {
    setQualityPreference(tupleA, "high");
    setQualityPreference(tupleB, "medium");
    setQualityPreference(tupleWin2, "low");

    releaseWindow("win-1");

    expect(getQualityPreference(tupleA)).toBe("auto");
    expect(getQualityPreference(tupleB)).toBe("auto");
    expect(getQualityPreference(tupleWin2)).toBe("low");
  });

  it("releases generation when owner generation is retired", () => {
    setQualityPreference(tupleA, "high");
    setQualityPreference(tupleGen2, "medium");

    releaseGeneration("profile-1", 1);

    expect(getQualityPreference(tupleA)).toBe("auto");
    expect(getQualityPreference(tupleGen2)).toBe("medium");
  });

  it("never writes anything to localStorage or sessionStorage", () => {
    setQualityPreference(tupleA, "high");
    publishStreamQuality(tupleA, sampleEvent);
    clearStreamQuality(tupleA);

    expect(window.localStorage?.length ?? 0).toBe(0);
    expect(window.sessionStorage?.length ?? 0).toBe(0);
  });
});
