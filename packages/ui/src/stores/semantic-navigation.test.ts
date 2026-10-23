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
});
