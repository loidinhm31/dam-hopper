// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import {
  EncryptProvider,
  useEncryptMode,
  type EncryptContextValue,
} from "@/contexts/EncryptContext.js";
import {
  useEncryptedWrite,
  type UseEncryptedWriteReturn,
  type EncryptedUploadResult,
} from "./use-encrypted-write.js";
import type { ConnectionRef } from "@/api/client.js";

const opaqueMock = vi.hoisted(() => ({
  opaqueRegisterAndLogin: vi.fn(
    async (_transport: unknown, identifier: string) => {
      return {
        sessionId: "test-sess",
        sessionKeyB64: "key",
        exportKeyB64: "exp",
        serverPublicKeyB64: "pub",
        aesKey: new Uint8Array(32).fill(7),
        identifier,
      };
    },
  ),
}));

vi.mock("@/lib/opaque-session.js", () => opaqueMock);

const cryptoMock = vi.hoisted(() => ({
  encryptFile: vi.fn(async (file: File) => ({
    blob: new Blob(["encrypted:" + file.name]),
  })),
  encryptText: vi.fn(async (text: string) => ({
    blob: new Blob(["encrypted:" + text]),
  })),
}));

vi.mock("@/lib/crypto.js", () => cryptoMock);

const connectionsMock = vi.hoisted(() => {
  const currentConnections = new Set<string>();
  const listeners = new Set<() => void>();
  const mockTransport = {
    fsPutFile: vi.fn(async () => ({ ok: true, newMtime: 12345 })),
    fsPutSave: vi.fn(async () => ({ ok: true, newMtime: 12345 })),
  };
  return {
    mockTransport,
    currentConnections,
    listeners,
    isCurrentConnection: vi.fn((owner: ConnectionRef) => {
      return currentConnections.has(`${owner.profileId}@${owner.generation}`);
    }),
    captureConnection: vi.fn((profileId: string) => ({
      profileId,
      generation: 1,
    })),
    getConnectionSnapshot: vi.fn((profileId: string) => ({
      owner: { profileId, generation: 1 },
      status: "connected",
      serverUrl: "https://api.test",
    })),
    getTransport: vi.fn(() => mockTransport),
    subscribeConnections: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
});

vi.mock("@/api/connections.js", () => connectionsMock);

describe("useEncryptedWrite", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let hookValue: UseEncryptedWriteReturn | null = null;
  let encryptModeValue: EncryptContextValue | null = null;

  function TestComponent() {
    hookValue = useEncryptedWrite();
    encryptModeValue = useEncryptMode();
    return null;
  }

  beforeEach(() => {
    connectionsMock.currentConnections.clear();
    connectionsMock.currentConnections.add("p1@1");
    connectionsMock.currentConnections.add("p2@1");
    connectionsMock.mockTransport.fsPutFile.mockClear();
    connectionsMock.mockTransport.fsPutSave.mockClear();
    opaqueMock.opaqueRegisterAndLogin.mockClear();
    cryptoMock.encryptFile.mockClear();
    cryptoMock.encryptText.mockClear();

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
    hookValue = null;
    encryptModeValue = null;
    vi.clearAllMocks();
  });

  it("uses collision-free random identifier and executes upload via single captured transport", async () => {
    await act(async () => {
      root?.render(
        <EncryptProvider>
          <TestComponent />
        </EncryptProvider>,
      );
    });

    const ownerA: ConnectionRef = { profileId: "p1", generation: 1 };
    act(() => {
      encryptModeValue?.setEncryptEnabled("my-project", true, ownerA);
    });

    const file = new File(["plain"], "secret.txt", { type: "text/plain" });

    let result!: EncryptedUploadResult;
    await act(async () => {
      result = await hookValue!.uploadFile(
        { project: "my-project", profileId: "p1" },
        "docs",
        file,
        "passphrase-123",
        undefined,
        ownerA,
      );
    });

    expect(result.ok).toBe(true);
    expect(connectionsMock.getTransport).toHaveBeenCalledWith(ownerA);
    expect(opaqueMock.opaqueRegisterAndLogin).toHaveBeenCalledOnce();

    // Verify collision-free random identifier format: enc-my-project-<12 hex>
    const usedIdentifier = opaqueMock.opaqueRegisterAndLogin.mock.calls[0][1];
    expect(usedIdentifier).toMatch(/^enc-my-project-[0-9a-f]{12}$/);

    // Verify fsPutFile called on the exact same transport instance
    expect(connectionsMock.mockTransport.fsPutFile).toHaveBeenCalledWith(
      expect.objectContaining({ project: "my-project" }),
      "docs",
      expect.any(File),
      "test-sess",
      expect.any(String),
      undefined,
    );
  });

  it("aborts encrypted save if lock mode is turned off during operation", async () => {
    await act(async () => {
      root?.render(
        <EncryptProvider>
          <TestComponent />
        </EncryptProvider>,
      );
    });

    const ownerA: ConnectionRef = { profileId: "p1", generation: 1 };
    act(() => {
      encryptModeValue?.setEncryptEnabled("my-project", true, ownerA);
    });

    // Make handshake disable lock mode before resolving
    opaqueMock.opaqueRegisterAndLogin.mockImplementationOnce(async () => {
      act(() => {
        encryptModeValue?.setEncryptEnabled("my-project", false, ownerA);
      });
      return {
        sessionId: "stale-sess",
        sessionKeyB64: "key",
        exportKeyB64: "exp",
        serverPublicKeyB64: "pub",
        aesKey: new Uint8Array(32).fill(9),
      };
    });

    let result!: EncryptedUploadResult;
    await act(async () => {
      result = await hookValue!.saveText(
        { project: "my-project", profileId: "p1" },
        "file.txt",
        "secret content",
        "passphrase-123",
        ownerA,
      );
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cancelled");
    expect(connectionsMock.mockTransport.fsPutSave).not.toHaveBeenCalled();
  });
});
