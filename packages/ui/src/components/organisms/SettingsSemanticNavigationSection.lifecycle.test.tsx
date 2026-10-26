// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { profileQueryKey } from "@/api/query-client.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "@/api/connections.js";
import { createApiClient } from "@/api/client.js";
import type { Transport } from "@/api/transport.js";
import { SettingsSemanticNavigationSection } from "./SettingsSemanticNavigationSection.js";

describe("SettingsSemanticNavigationSection real QueryClient failed-OFF lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let qc: QueryClient;

  beforeEach(() => {
    const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    actEnv.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    resetConnections();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    qc.clear();
    resetConnections();
  });

  it("refetches on failed OFF settlement and presents mismatch banner alongside retained action error", async () => {
    const owner = { profileId: "prof-1", generation: 1 };
    const queryKey = profileQueryKey(owner, "semantic", "settings");

    let currentBackendStatus = {
      configuredEnabled: true,
      runtimeEnabled: true,
      runtimeState: "ready",
      integrityStatus: "Valid",
      toolchainReady: true,
      tupleIdentifier: "node-24.16.0-ts-5.9.3-tsls-6.0.2-linux-x64",
      policyCapability: "cgroup-v2",
      resourceWarning: undefined,
      activeTrees: 1,
      openDocuments: 1,
      totalOverlayBytes: 512,
      generation: 1,
      transitionError: undefined,
      canMutate: true,
    };

    let rejectUpdatePromise: ((err: Error) => void) | undefined;

    const mockTransport: Transport = {
      invoke: vi.fn().mockImplementation((method) => {
        if (method === "semantic:settings") {
          return Promise.resolve(currentBackendStatus);
        }
        if (method === "semantic:updateSettings") {
          const { promise, reject } = Promise.withResolvers<unknown>();
          rejectUpdatePromise = reject;
          return promise;
        }
        return Promise.resolve({});
      }),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      destroy: vi.fn(),
    };

    __setConnectionSnapshotForTests("prof-1", {
      owner,
      status: "connected",
      api: createApiClient(owner, mockTransport),
    });
    qc.setQueryData(queryKey, currentBackendStatus);

    // 1. Initial render: healthy enabled status
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(SettingsSemanticNavigationSection, { owner }),
        ),
      );
    });

    expect(container.textContent).toContain("Enable Semantic Navigation");
    expect(container.textContent).toContain("ready");
    expect(container.textContent).not.toContain("Configuration / Runtime Mismatch");

    // 2. Locate toggle and trigger OFF
    const switchButton = container.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(switchButton).not.toBeNull();
    expect(switchButton.getAttribute("aria-checked")).toBe("true");

    // Simulate backend transitioning to safe-disabled
    currentBackendStatus = {
      ...currentBackendStatus,
      configuredEnabled: true,
      runtimeEnabled: false,
      runtimeState: "safe-disabled",
      transitionError: "Failed to reap language server processes within deadline",
    };

    await act(async () => {
      switchButton.click();
    });
    // Settle mutation with failure
    await act(async () => {
      rejectUpdatePromise!(new Error("Failed to teardown semantic engine"));
    });

    // Wait for the automatic settlement refetch to complete and UI to re-render
    await act(async () => {
      await Promise.resolve();
    });
    // 3. Verify mismatch banner AND retained action error are displayed simultaneously
    expect(container.textContent).toContain("Configuration / Runtime Mismatch");
    expect(container.textContent).toContain("effective runtime state is safe-disabled");
    expect(container.textContent).toContain("Failed to reap language server processes within deadline");
    expect(container.textContent).toContain("Failed to teardown semantic engine");
  });

  it("isolates settlement refetch to captured owner when generation or profile changes mid-flight", async () => {
    const ownerGen1 = { profileId: "prof-1", generation: 1 };
    const ownerGen2 = { profileId: "prof-1", generation: 2 };
    const keyGen1 = profileQueryKey(ownerGen1, "semantic", "settings");
    const keyGen2 = profileQueryKey(ownerGen2, "semantic", "settings");

    let resolveUpdatePromise: ((val: unknown) => void) | undefined;

    const mockTransport: Transport = {
      invoke: vi.fn().mockImplementation((method) => {
        if (method === "semantic:settings") {
          return Promise.resolve({
            configuredEnabled: true,
            runtimeEnabled: true,
            runtimeState: "ready",
            canMutate: true,
          });
        }
        if (method === "semantic:updateSettings") {
          const { promise, resolve } = Promise.withResolvers<unknown>();
          resolveUpdatePromise = resolve;
          return promise;
        }
        return Promise.resolve({});
      }),
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      destroy: vi.fn(),
    };

    __setConnectionSnapshotForTests("prof-1", {
      owner: ownerGen1,
      status: "connected",
      api: createApiClient(ownerGen1, mockTransport),
    });

    const fullStatus = {
      configuredEnabled: true,
      runtimeEnabled: true,
      runtimeState: "ready",
      integrityStatus: "Valid",
      toolchainReady: true,
      tupleIdentifier: "node-24.16.0-ts-5.9.3-tsls-6.0.2-linux-x64",
      policyCapability: "cgroup-v2",
      activeTrees: 0,
      openDocuments: 0,
      totalOverlayBytes: 0,
      generation: 1,
      canMutate: true,
    };
    qc.setQueryData(keyGen1, fullStatus);
    qc.setQueryData(keyGen2, fullStatus);
    let activeOwner = ownerGen1;

    function Harness(props: { owner: typeof ownerGen1 }) {
      return createElement(SettingsSemanticNavigationSection, { owner: props.owner });
    }

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(Harness, { owner: activeOwner }),
        ),
      );
    });

    const switchButton = container.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(switchButton).not.toBeNull();

    // Click toggle under generation 1
    await act(async () => {
      switchButton.click();
    });

    // Reconnect/upgrade generation to 2 mid-flight
    activeOwner = ownerGen2;
    __setConnectionSnapshotForTests("prof-1", {
      owner: ownerGen2,
      status: "connected",
      api: createApiClient(ownerGen2, mockTransport),
    });

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(Harness, { owner: activeOwner }),
        ),
      );
    });

    // Settle mutation from generation 1
    await act(async () => {
      resolveUpdatePromise!({ configuredEnabled: false, runtimeEnabled: false, canMutate: true });
    });

    // keyGen1 (captured owner) was invalidated
    expect(qc.getQueryCache().find({ queryKey: keyGen1 })?.isStale()).toBe(true);

    // keyGen2 (replacement generation) was NOT invalidated or altered by generation 1 settlement
    expect(qc.getQueryCache().find({ queryKey: keyGen2 })?.isStale()).toBe(false);
  });
});
