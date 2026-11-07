import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  globalTopicBroker,
  publishTopic,
  subscribeTopic,
} from "./topics.js";

describe("OS Topics Broker", () => {
  beforeEach(() => {
    globalTopicBroker.clear();
  });

  it("isolates topics strictly by profileId and generation", () => {
    const ownerA1 = { profileId: "profile-a", generation: 1 };
    const ownerA2 = { profileId: "profile-a", generation: 2 };
    const ownerB1 = { profileId: "profile-b", generation: 1 };

    const fnA1 = vi.fn();
    const fnA2 = vi.fn();
    const fnB1 = vi.fn();

    subscribeTopic("agent:status", ownerA1, fnA1);
    subscribeTopic("agent:status", ownerA2, fnA2);
    subscribeTopic("agent:status", ownerB1, fnB1);

    publishTopic("agent:status", ownerA1, { status: "active", count: 1 });

    expect(fnA1).toHaveBeenCalledTimes(1);
    expect(fnA1).toHaveBeenCalledWith({ status: "active", count: 1 });
    expect(fnA2).not.toHaveBeenCalled();
    expect(fnB1).not.toHaveBeenCalled();

    // Publish to profile B
    publishTopic("agent:status", ownerB1, { status: "idle" });
    expect(fnB1).toHaveBeenCalledTimes(1);
    expect(fnA1).toHaveBeenCalledTimes(1);
  });

  it("delivers cached snapshot to late subscriber and unsubscribes cleanly", () => {
    const owner = { profileId: "profile-1", generation: 1 };
    publishTopic("host:resources", owner, { cpu: 25, memory: 40 });

    const listener = vi.fn();
    const unsubscribe = subscribeTopic("host:resources", owner, listener);

    // Initial delivery of snapshot
    expect(listener).toHaveBeenCalledWith({ cpu: 25, memory: 40 });

    // Unsubscribe removes listener
    unsubscribe();
    expect(globalTopicBroker.listenerCount("host:resources", owner)).toBe(0);

    publishTopic("host:resources", owner, { cpu: 80, memory: 90 });
    expect(listener).toHaveBeenCalledTimes(1); // No second call
  });
});
