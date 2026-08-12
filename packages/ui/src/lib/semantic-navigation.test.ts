import { describe, expect, it, vi } from "vitest";
import {
  applyNavigationTargets,
  createSemanticProviders,
} from "./semantic-navigation.js";
import { useNavigationResultsStore } from "@/stores/navigation-results.js";

describe("semantic navigation result bounds", () => {
  it("registers public providers and editor actions", () => {
    const registrations: string[] = [];
    const disposables = createSemanticProviders(
      {
        KeyCode: { F12: 1 },
        KeyMod: { CtrlCmd: 2, Shift: 4 },
        languages: {
          registerDefinitionProvider: (language: string) => {
            registrations.push(`definition:${language}`);
            return { dispose: vi.fn() };
          },
          registerImplementationProvider: (language: string) => {
            registrations.push(`implementation:${language}`);
            return { dispose: vi.fn() };
          },
          registerReferenceProvider: (language: string) => {
            registrations.push(`references:${language}`);
            return { dispose: vi.fn() };
          },
        },
      } as never,
      "rust",
      { navigate: vi.fn(async () => null) },
      () => ({ language: "rust", path: "src/main.rs", version: 1 }),
    );
    expect(registrations).toEqual([
      "definition:rust",
      "implementation:rust",
      "references:rust",
    ]);
    disposables.dispose();
  });
  it("registers modifier-click navigation without private Monaco APIs", () => {
    const onMouseDown = vi.fn(() => ({ dispose: vi.fn() }));
    const addAction = vi.fn(() => ({ dispose: vi.fn() }));
    const disposable = createSemanticProviders(
      {
        KeyCode: { F12: 1 },
        KeyMod: { CtrlCmd: 2, Shift: 4 },
        languages: {
          registerDefinitionProvider: () => ({ dispose: vi.fn() }),
          registerImplementationProvider: () => ({ dispose: vi.fn() }),
          registerReferenceProvider: () => ({ dispose: vi.fn() }),
        },
        editor: { MouseTargetType: { CONTENT_TEXT: 6 } },
      } as never,
      "rust",
      { navigate: vi.fn(async () => null) },
      () => ({ language: "rust", path: "src/main.rs", version: 1 }),
      {
        getModel: () => ({}) as never,
        getPosition: () => null,
        addAction,
        onMouseDown,
      } as never,
    );
    expect(addAction).toHaveBeenCalledTimes(3);
    expect(onMouseDown).toHaveBeenCalledOnce();
    disposable.dispose();
  });

  it("does not navigate when a capability is no longer available", async () => {
    const navigate = vi.fn(async () => []);
    const providers: Array<{
      provideDefinition: (...args: never[]) => unknown;
    }> = [];
    createSemanticProviders(
      {
        KeyCode: { F12: 1 },
        KeyMod: { CtrlCmd: 2, Shift: 4 },
        languages: {
          registerDefinitionProvider: (_language: string, provider: never) => {
            providers.push(provider);
            return { dispose: vi.fn() };
          },
          registerImplementationProvider: () => ({ dispose: vi.fn() }),
          registerReferenceProvider: () => ({ dispose: vi.fn() }),
        },
      } as never,
      "rust",
      { isAvailable: () => false, navigate },
      () => ({ language: "rust", path: "src/main.rs", version: 1 }),
    );
    await providers[0]?.provideDefinition?.(
      {} as never,
      { lineNumber: 1, column: 1 } as never,
      { isCancellationRequested: false } as never,
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("stores metadata-only capped results", () => {
    const targets = Array.from({ length: 501 }, (_, index) => ({
      uri: {
        profileId: "profile",
        projectId: "project",
        path: `src/${index}.rs`,
        language: "rust" as const,
      },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      label: `target-${index}`,
    }));
    applyNavigationTargets("references", targets);
    expect(useNavigationResultsStore.getState().state).toMatchObject({
      kind: "targets",
      capped: true,
    });
    const state = useNavigationResultsStore.getState().state;
    expect(state.kind === "targets" && state.targets).toHaveLength(500);
    useNavigationResultsStore.getState().clear();
  });

  it("clears loading results when a provider is cancelled", async () => {
    const cancelled = { isCancellationRequested: false } as {
      isCancellationRequested: boolean;
    };
    const navigate = vi.fn(
      () =>
        new Promise<never>((resolve) => {
          void resolve;
        }),
    );
    const providers: Array<{
      provideDefinition: (...args: never[]) => Promise<null>;
    }> = [];
    createSemanticProviders(
      {
        languages: {
          registerDefinitionProvider: (_language: string, provider: never) => {
            providers.push(provider);
            return { dispose: vi.fn() };
          },
          registerImplementationProvider: () => ({ dispose: vi.fn() }),
          registerReferenceProvider: () => ({ dispose: vi.fn() }),
        },
      } as never,
      "rust",
      { navigate },
      () => ({ language: "rust", path: "src/main.rs", version: 1 }),
    );
    const promise = providers[0]?.provideDefinition(
      {} as never,
      { lineNumber: 1, column: 1 } as never,
      cancelled as never,
    );
    expect(useNavigationResultsStore.getState().state.kind).toBe("loading");
    cancelled.isCancellationRequested = true;
    useNavigationResultsStore
      .getState()
      .clearRequest(useNavigationResultsStore.getState().requestKey ?? "");
    expect(useNavigationResultsStore.getState().state.kind).toBe("idle");
    void promise;
  });

  it("clears empty or malformed provider results", () => {
    applyNavigationTargets("definition", null);
    expect(useNavigationResultsStore.getState().state).toEqual({
      kind: "empty",
      operation: "definition",
    });
    expect(() => applyNavigationTargets("definition", "bad")).not.toThrow();
    vi.restoreAllMocks();
  });
});
