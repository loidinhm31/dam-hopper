import { describe, expect, it } from "vitest";
import {
  formatClaimKey,
  ResourceRegistry,
} from "./resource-registry.js";
import type { ResourceClaimKey } from "./types.js";

describe("ResourceRegistry", () => {
  it("formats claim key deterministically with optional fields", () => {
    const key1: ResourceClaimKey = {
      resourceKind: "terminal",
      profileId: "p1",
      generation: 1,
      resourceId: "term-123",
    };
    expect(formatClaimKey(key1)).toBe("terminal/p1/1/term-123");

    const key2: ResourceClaimKey = {
      resourceKind: "terminal",
      profileId: "p1",
      generation: 2,
      resourceId: "term-123",
      incarnation: 5,
      epoch: 42,
    };
    expect(formatClaimKey(key2)).toBe("terminal/p1/2/term-123/inc:5/ep:42");
  });

  it("claims a resource successfully and rejects conflicting duplicate claim", () => {
    const registry = new ResourceRegistry();
    const key: ResourceClaimKey = {
      resourceKind: "terminal",
      profileId: "p1",
      generation: 1,
      resourceId: "term-1",
    };

    // First claim by window-1
    const res1 = registry.claim(key, "window-1");
    expect(res1.success).toBe(true);

    // Re-claim by the same window-1 is allowed (idempotent)
    const resIdempotent = registry.claim(key, "window-1");
    expect(resIdempotent.success).toBe(true);

    // Second claim by different window-2 is rejected with holder identity
    const res2 = registry.claim(key, "window-2");
    expect(res2.success).toBe(false);
    expect(res2.existingHolderWindowId).toBe("window-1");
  });

  it("releases claim and allows another window to claim", () => {
    const registry = new ResourceRegistry();
    const key: ResourceClaimKey = {
      resourceKind: "editor",
      profileId: "p1",
      generation: 1,
      resourceId: "/path/to/file.ts",
    };

    registry.claim(key, "window-1");
    registry.release(key, "window-1");

    const res2 = registry.claim(key, "window-2");
    expect(res2.success).toBe(true);
  });

  it("releases all claims for a closing window", () => {
    const registry = new ResourceRegistry();
    const key1: ResourceClaimKey = {
      resourceKind: "terminal",
      profileId: "p1",
      generation: 1,
      resourceId: "t1",
    };
    const key2: ResourceClaimKey = {
      resourceKind: "terminal",
      profileId: "p1",
      generation: 1,
      resourceId: "t2",
    };

    registry.claim(key1, "win-a");
    registry.claim(key2, "win-a");
    expect(registry.getClaimsForWindow("win-a").length).toBe(2);

    registry.releaseAllForWindow("win-a");
    expect(registry.getClaimsForWindow("win-a").length).toBe(0);
  });

  it("reactively provides claim status and notifies listeners on release", () => {
    const registry = new ResourceRegistry();
    const key: ResourceClaimKey = {
      resourceKind: "terminal",
      profileId: "p1",
      generation: 1,
      resourceId: "t1",
    };

    registry.claim(key, "win-1");
    let notified = false;
    const unsubscribe = registry.subscribe(() => {
      notified = true;
    });

    // win-2 cannot claim
    const res2 = registry.claim(key, "win-2");
    expect(res2.success).toBe(false);

    // win-1 releases
    registry.release(key, "win-1");
    expect(notified).toBe(true);

    // now win-2 can claim
    const res3 = registry.claim(key, "win-2");
    expect(res3.success).toBe(true);

    unsubscribe();
  });
});
