// @vitest-environment jsdom
import { vi } from "vitest";

vi.hoisted(() => {
  if (
    typeof document !== "undefined" &&
    !("queryCommandSupported" in document)
  ) {
    (document as unknown as Record<string, unknown>).queryCommandSupported =
      () => false;
  }
  if (typeof window !== "undefined" && !window.CSS) {
    (window as unknown as Record<string, unknown>).CSS = {
      escape: (s: string) => s,
    };
  }
  if (typeof window !== "undefined" && !window.matchMedia) {
    (window as unknown as Record<string, unknown>).matchMedia = () => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
});
import "@/lib/monaco-setup.js";
import { describe, it, expect, beforeEach } from "vitest";
import {
  useSemanticNavigationStore,
  buildSemanticScopeKey,
  type NavigationRevealIntent,
} from "./semantic-navigation.js";
import { defaultSemanticMonacoManager } from "@/lib/semantic-monaco.js";

describe("semantic-navigation store", () => {
  beforeEach(() => {
    useSemanticNavigationStore.getState().disconnectAll();
    useSemanticNavigationStore.setState({
      globalSemanticEnabled: false,
      activeRevealIntent: null,
      clientStatuses: {},
    });
  });

  it("builds deterministic scope key", () => {
    expect(
      buildSemanticScopeKey(
        "prof-1",
        "ws://127.0.0.1:4803",
        "my-project",
        "target-1",
        2,
      ),
    ).toBe("prof-1::ws://127.0.0.1:4803::my-project::target-1::gen_2");
  });

  it("sets and consumes reveal intent atomically", () => {
    const intent: NavigationRevealIntent = {
      targetId: "target-1",
      profileId: "prof-1",
      project: "my-project",
      targetKey: "target-1",
      relativePath: "src/utils.ts",
      range: {
        startLineNumber: 10,
        startColumn: 1,
        endLineNumber: 10,
        endColumn: 20,
      },
      createdAt: Date.now(),
    };

    useSemanticNavigationStore.getState().setRevealIntent(intent);
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toEqual(
      intent,
    );

    // Consume with wrong path -> returns null and leaves intent
    const miss = useSemanticNavigationStore
      .getState()
      .consumeRevealIntent("prof-1", "my-project", "target-1", "src/other.ts");
    expect(miss).toBeNull();
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toEqual(
      intent,
    );

    // Consume with matching path -> returns intent and clears it
    const hit = useSemanticNavigationStore
      .getState()
      .consumeRevealIntent("prof-1", "my-project", "target-1", "src/utils.ts");
    expect(hit).toEqual(intent);
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toBeNull();

    // Second consume returns null
    const hit2 = useSemanticNavigationStore
      .getState()
      .consumeRevealIntent("prof-1", "my-project", "target-1", "src/utils.ts");
    expect(hit2).toBeNull();
  });

  it("manages global semantic toggle and monaco activation", () => {
    const spyActivate = vi
      .spyOn(defaultSemanticMonacoManager, "activate")
      .mockImplementation(() => {});
    const spyDeactivate = vi
      .spyOn(defaultSemanticMonacoManager, "deactivate")
      .mockImplementation(() => {});

    useSemanticNavigationStore.getState().setGlobalSemanticEnabled(true);
    expect(useSemanticNavigationStore.getState().globalSemanticEnabled).toBe(
      true,
    );
    expect(spyActivate).toHaveBeenCalled();

    useSemanticNavigationStore.getState().setGlobalSemanticEnabled(false);
    expect(useSemanticNavigationStore.getState().globalSemanticEnabled).toBe(
      false,
    );
    expect(spyDeactivate).toHaveBeenCalled();

    spyActivate.mockRestore();
    spyDeactivate.mockRestore();
  });
  it("scopes enablement per profile and disconnects only matching profile clients on disable", () => {
    const store = useSemanticNavigationStore.getState();

    store.setProfileSemanticEnabled("prof-a", true);
    store.setProfileSemanticEnabled("prof-b", true);
    expect(store.isSemanticEnabledForProfile("prof-a")).toBe(true);
    expect(store.isSemanticEnabledForProfile("prof-b")).toBe(true);

    const clientA = store.getOrCreateClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      serverUrl: "http://127.0.0.1:4803",
      token: "tok-a",
      profileId: "prof-a",
      project: "proj-a",
      targetKey: "target-a",
      connectionGeneration: 1,
      targetGeneration: 1,
    });

    const clientB = store.getOrCreateClient({
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      serverUrl: "http://127.0.0.1:4803",
      token: "tok-b",
      profileId: "prof-b",
      project: "proj-b",
      targetKey: "target-b",
      connectionGeneration: 1,
      targetGeneration: 1,
    });

    const spyDisconnectA = vi.spyOn(clientA, "disconnect");
    const spyDisconnectB = vi.spyOn(clientB, "disconnect");

    // Disable prof-a
    store.setProfileSemanticEnabled("prof-a", false);
    expect(store.isSemanticEnabledForProfile("prof-a")).toBe(false);
    expect(store.isSemanticEnabledForProfile("prof-b")).toBe(true);

    expect(spyDisconnectA).toHaveBeenCalledTimes(1);
    expect(spyDisconnectB).not.toHaveBeenCalled();

    spyDisconnectA.mockRestore();
    spyDisconnectB.mockRestore();
  });

  it("reference-counts shared clients so unmounting one editor does not disconnect other tabs", () => {
    const store = useSemanticNavigationStore.getState();
    const opts = {
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      serverUrl: "http://127.0.0.1:4803",
      token: "tok-shared",
      profileId: "prof-shared",
      project: "proj-shared",
      targetKey: "target-shared",
      connectionGeneration: 1,
      targetGeneration: 1,
    };

    // Editor 1 opens
    const client1 = store.getOrCreateClient(opts);
    // Editor 2 opens same target
    const client2 = store.getOrCreateClient(opts);
    expect(client1).toBe(client2);

    const spyDisconnect = vi.spyOn(client1, "disconnect");
    const scopeKey = buildSemanticScopeKey(
      opts.profileId,
      opts.serverUrl,
      opts.project,
      opts.targetKey,
      opts.connectionGeneration,
    );

    // Editor 1 unmounts / releases
    store.releaseClient(scopeKey);
    expect(spyDisconnect).not.toHaveBeenCalled();
    expect(store.getClient(scopeKey)).toBe(client1);

    // Editor 2 unmounts / releases final reference
    store.releaseClient(scopeKey);
    expect(spyDisconnect).toHaveBeenCalledTimes(1);
    expect(store.getClient(scopeKey)).toBeNull();

    spyDisconnect.mockRestore();
  });
});
