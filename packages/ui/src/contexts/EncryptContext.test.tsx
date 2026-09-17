// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React, { useEffect } from "react";
import {
  EncryptProvider,
  useEncryptMode,
  toEncryptKey,
  extractProjectFromKey,
  extractOwnerFromKey,
  type EncryptContextValue,
} from "./EncryptContext.js";
import type { ConnectionRef } from "@/api/client.js";

const connectionsMock = vi.hoisted(() => {
  const currentConnections = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    currentConnections,
    listeners,
    isCurrentConnection: vi.fn((owner: ConnectionRef) => {
      return currentConnections.has(`${owner.profileId}@${owner.generation}`);
    }),
    subscribeConnections: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emitConnectionChange: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
});

vi.mock("@/api/connections.js", () => connectionsMock);

describe("EncryptContext", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let contextValue: EncryptContextValue | null = null;

  function TestConsumer() {
    const ctx = useEncryptMode();
    useEffect(() => {
      contextValue = ctx;
    });
    contextValue = ctx;
    return null;
  }

  beforeEach(() => {
    connectionsMock.currentConnections.clear();
    connectionsMock.listeners.clear();
    connectionsMock.currentConnections.add("p1@1");
    connectionsMock.currentConnections.add("p2@1");

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    contextValue = null;
    vi.clearAllMocks();
  });

  it("toEncryptKey correctly derives owner-qualified and ambient keys", () => {
    const ownerA: ConnectionRef = { profileId: "p1", generation: 1 };
    const ownerB: ConnectionRef = { profileId: "p2", generation: 2 };

    expect(toEncryptKey("my-project", ownerA)).toBe("p1@1:my-project");
    expect(toEncryptKey("my-project", ownerB)).toBe("p2@2:my-project");
    expect(toEncryptKey("my-project")).toBe("ambient:my-project");
    expect(toEncryptKey({ project: "my-project", profileId: "p1" })).toBe(
      "p1@1:my-project",
    );
    expect(toEncryptKey("already:qualified")).toBe("already:qualified");

    expect(extractProjectFromKey("p1@1:my-project")).toBe("my-project");
    expect(extractOwnerFromKey("p1@1:my-project")).toEqual({
      profileId: "p1",
      generation: 1,
    });
    expect(extractOwnerFromKey("ambient:my-project")).toBeNull();
  });

  it("maintains separate lock status and sessions across same-named projects on different owners", async () => {
    await act(async () => {
      root?.render(
        <EncryptProvider>
          <TestConsumer />
        </EncryptProvider>,
      );
    });

    const ownerA: ConnectionRef = { profileId: "p1", generation: 1 };
    const ownerB: ConnectionRef = { profileId: "p2", generation: 1 };

    await act(async () => {
      contextValue?.setEncryptEnabled("shared-project", true, ownerA);
      contextValue?.setPassphrase("shared-project", "pass-a", ownerA);
    });

    expect(contextValue?.isEncryptEnabled("shared-project", ownerA)).toBe(true);
    expect(contextValue?.isEncryptEnabled("shared-project", ownerB)).toBe(
      false,
    );
    expect(contextValue?.getPassphrase("shared-project", ownerA)).toBe(
      "pass-a",
    );
    expect(contextValue?.getPassphrase("shared-project", ownerB)).toBeNull();

    // Disabling owner A does not affect owner B
    await act(async () => {
      contextValue?.setEncryptEnabled("shared-project", false, ownerA);
    });
    expect(contextValue?.isEncryptEnabled("shared-project", ownerA)).toBe(
      false,
    );
    expect(contextValue?.getPassphrase("shared-project", ownerA)).toBeNull();
  });

  it("queues passphrase prompts without replacing active prompt resolvers", async () => {
    await act(async () => {
      root?.render(
        <EncryptProvider>
          <TestConsumer />
        </EncryptProvider>,
      );
    });

    const ownerA: ConnectionRef = { profileId: "p1", generation: 1 };
    const ownerB: ConnectionRef = { profileId: "p2", generation: 1 };

    let promiseA!: Promise<string>;
    let promiseB!: Promise<string>;

    act(() => {
      promiseA = contextValue!.promptPassphrase(
        "project-a",
        ownerA,
        "Profile One",
      );
      promiseB = contextValue!.promptPassphrase(
        "project-b",
        ownerB,
        "Profile Two",
      );
    });

    // Front prompt is A
    expect(contextValue?.isPrompting).toBe(true);
    expect(contextValue?.promptingProject).toBe("project-a");
    expect(contextValue?.promptingProfileId).toBe("p1");
    expect(contextValue?.promptingProfileName).toBe("Profile One");

    // Resolve A
    await act(async () => {
      contextValue?.resolvePrompt("passphrase-a");
    });

    await expect(promiseA).resolves.toBe("passphrase-a");

    // Now B is the active prompt!
    expect(contextValue?.isPrompting).toBe(true);
    expect(contextValue?.promptingProject).toBe("project-b");
    expect(contextValue?.promptingProfileId).toBe("p2");
    expect(contextValue?.promptingProfileName).toBe("Profile Two");

    // Resolve B
    await act(async () => {
      contextValue?.resolvePrompt("passphrase-b");
    });

    await expect(promiseB).resolves.toBe("passphrase-b");
    expect(contextValue?.isPrompting).toBe(false);
  });

  it("deduplicates exact same owned prompt request", async () => {
    await act(async () => {
      root?.render(
        <EncryptProvider>
          <TestConsumer />
        </EncryptProvider>,
      );
    });

    const ownerA: ConnectionRef = { profileId: "p1", generation: 1 };

    let p1!: Promise<string>;
    let p2!: Promise<string>;

    act(() => {
      p1 = contextValue!.promptPassphrase("project-a", ownerA);
      p2 = contextValue!.promptPassphrase("project-a", ownerA);
    });

    await act(async () => {
      contextValue?.resolvePrompt("shared-secret");
    });

    await expect(p1).resolves.toBe("shared-secret");
    await expect(p2).resolves.toBe("shared-secret");
    expect(contextValue?.isPrompting).toBe(false);
  });

  it("invalidates cached sessions and zeroes keys when connection drops", async () => {
    await act(async () => {
      root?.render(
        <EncryptProvider>
          <TestConsumer />
        </EncryptProvider>,
      );
    });

    const ownerA: ConnectionRef = { profileId: "p1", generation: 1 };
    const keyBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    await act(async () => {
      contextValue?.setSession(
        "project-a",
        {
          sessionId: "sess-1",
          sessionKeyB64: "key",
          exportKeyB64: "exp",
          serverPublicKeyB64: "pub",
          aesKey: keyBytes,
        },
        ownerA,
      );
    });

    expect(contextValue?.getSession("project-a", ownerA)).not.toBeNull();

    // Owner A drops connection
    await act(async () => {
      connectionsMock.currentConnections.delete("p1@1");
      connectionsMock.emitConnectionChange();
    });

    // Session is evicted and key buffer is zeroed
    expect(contextValue?.getSession("project-a", ownerA)).toBeNull();
    expect(Array.from(keyBytes)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
