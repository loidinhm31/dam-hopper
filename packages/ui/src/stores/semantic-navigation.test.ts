// @vitest-environment jsdom
import { vi } from "vitest";
const currentAuthority = vi.hoisted(() => ({
  serverUrl: "http://127.0.0.1:4803", configuredRoot: "/srv/proj", actor: "basic:alice:tok-a",
}));
vi.mock("@/lib/semantic-model-uri.js", async () => ({
  ...await vi.importActual<typeof import("@/lib/semantic-model-uri.js")>("@/lib/semantic-model-uri.js"),
  captureSemanticProvenance: () => currentAuthority,
}));

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
import { defaultSemanticModelRegistry } from "@/lib/semantic-model-uri.js";

describe("semantic-navigation store", () => {
  beforeEach(() => {
    defaultSemanticModelRegistry.clearAll();
    useSemanticNavigationStore.getState().disconnectAll();
    useSemanticNavigationStore.setState({
      globalSemanticEnabled: false,
      profileSemanticEnabled: {},
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

  it("enforces exact expectedClient on releaseClient/disconnectClient and fences findClientForTab by provenance", () => {
    const store = useSemanticNavigationStore.getState();
    const prov = {
      serverUrl: "http://127.0.0.1:4803",
      configuredRoot: "/srv/proj",
      actor: "basic:alice:tok-a",
    };
    const opts = {
      wsUrl: "ws://127.0.0.1:4803/ws/semantic/v1",
      serverUrl: "http://127.0.0.1:4803",
      token: "tok-a",
      profileId: "prof-1",
      project: "proj-1",
      targetKey: "root",
      connectionGeneration: 1,
      targetGeneration: 1,
      provenance: prov,
    };
    const scopeKey = buildSemanticScopeKey(
      opts.profileId,
      opts.serverUrl,
      opts.project,
      opts.targetKey,
      opts.connectionGeneration,
    );

    const clientA = store.getOrCreateClient(opts);
    store.disconnectClient(scopeKey, clientA);
    expect(store.getClient(scopeKey)).toBeNull();

    // Replacement clientB on same scopeKey
    const clientB = store.getOrCreateClient(opts);
    expect(clientB).not.toBe(clientA);
    const spyDisconnectB = vi.spyOn(clientB, "disconnect");

    // Late release/disconnect citing retired clientA must NOT touch clientB
    store.releaseClient(scopeKey, clientA);
    store.disconnectClient(scopeKey, clientA);
    expect(spyDisconnectB).not.toHaveBeenCalled();
    expect(store.getClient(scopeKey)).toBe(clientB);

    // findClientForTab requires matching provenance
    defaultSemanticModelRegistry.registerModel({
      tabKey: "tab-ok",
      profileId: "prof-1",
      project: "proj-1",
      targetKey: "root",
      relativePath: "src/ok.ts",
      provenance: prov,
    });
    defaultSemanticModelRegistry.registerModel({
      tabKey: "tab-foreign",
      profileId: "prof-1",
      project: "proj-1",
      targetKey: "root",
      relativePath: "src/foreign.ts",
      provenance: { ...prov, actor: "basic:bob:tok-b" },
    });

    expect(store.findClientForTab("tab-ok")).toBe(clientB);
    expect(store.findClientForTab("tab-foreign")).toBeNull();

    spyDisconnectB.mockRestore();
  });

  it("enforces expectedIntent identity and isCurrent predicate in consumeRevealIntent", () => {
    const store = useSemanticNavigationStore.getState();
    let valid = true;
    const intent1: NavigationRevealIntent = {
      targetId: "t-1",
      profileId: "prof-1",
      project: "proj-1",
      targetKey: "root",
      relativePath: "src/a.ts",
      range: {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 5,
      },
      createdAt: Date.now(),
      isCurrent: () => valid,
    };
    const intent2: NavigationRevealIntent = {
      ...intent1,
      range: {
        startLineNumber: 20,
        startColumn: 1,
        endLineNumber: 20,
        endColumn: 5,
      },
    };

    store.setRevealIntent(intent2);
    // Older async completion passing intent1 must not consume or clear intent2
    expect(
      store.consumeRevealIntent("prof-1", "proj-1", "root", "src/a.ts", intent1),
    ).toBeNull();
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toBe(intent2);

    // If isCurrent predicate turns false on intent1, it clears and returns null
    store.setRevealIntent(intent1);
    valid = false;
    expect(
      store.consumeRevealIntent("prof-1", "proj-1", "root", "src/a.ts", intent1),
    ).toBeNull();
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toBeNull();
  });
});
