// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const boundaries = vi.hoisted(() => ({
  enabled: false,
  provenance: { serverUrl: "http://127.0.0.1:4803", configuredRoot: "/projects/example", actor: "actor-a" },
  register: vi.fn(),
}));
vi.mock("@/lib/monaco-setup.js", () => ({}));
vi.mock("@/lib/semantic-monaco.js", () => ({ defaultSemanticMonacoManager: { register: boundaries.register } }));
vi.mock("@/lib/semantic-model-uri.js", async () => {
  const actual = await vi.importActual<typeof import("@/lib/semantic-model-uri.js")>("@/lib/semantic-model-uri.js");
  return { ...actual, captureSemanticProvenance: () => boundaries.provenance };
});
vi.mock("@/api/connections.js", () => ({
  useConnectionSnapshot: () => ({ status: "connected", serverUrl: "http://127.0.0.1:4803", owner: { generation: 1 } }),
  getConnectionSnapshot: () => ({ status: "connected", serverUrl: "http://127.0.0.1:4803", owner: { generation: 1 } }),
}));
vi.mock("@/api/server-config.js", async () => {
  const actual = await vi.importActual<typeof import("@/api/server-config.js")>("@/api/server-config.js");
  return { ...actual, getAuthToken: () => "test-token" };
});
vi.mock("@/contexts/EncryptContext.js", () => ({ useEncryptMode: () => ({ isEncryptEnabled: () => false }) }));
vi.mock("@/api/queries.js", () => ({
  useGitDiff: () => ({ data: undefined }), useGitFileDiff: () => ({ data: undefined }),
  useSemanticSettings: () => ({ data: { runtimeEnabled: boundaries.enabled } }),
}));
vi.mock("@/api/transport.js", () => ({ getTransport: () => ({ onStatusChange: () => () => {} }) }));
vi.mock("@/components/organisms/MonacoHost.js", () => ({ MonacoHost: () => <div>Monaco</div> }));
import { editorFileTabKey, useEditorStore, type Tab } from "@/stores/editor.js";
import { EditorTabs } from "./EditorTabs.js";
import { useSemanticNavigationStore } from "@/stores/semantic-navigation.js";
import type { SemanticClient, SemanticClientOptions } from "@/api/semantic-client.js";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const target = { project: "example", profileId: "profile-a", worktreePath: "/worktrees/feature" };
function tab(): Tab {
  return { key: editorFileTabKey(target, "src/main.ts"), target, project: target.project,
    targetKey: "worktree:/worktrees/feature", path: "src/main.ts", name: "main.ts", targetAvailable: true,
    content: "unsaved text", savedContent: "saved text", semanticProvenance: boundaries.provenance,
    dirty: true, tier: "normal", mtime: 1, size: 12, loading: false, saving: false, conflicted: false };
}

const originalReconcileTabFreshness = useEditorStore.getState().reconcileTabFreshness;
const originalGetOrCreateClient = useSemanticNavigationStore.getState().getOrCreateClient;
const originalReleaseClient = useSemanticNavigationStore.getState().releaseClient;

describe("EditorTabs semantic binding integration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let client: Partial<SemanticClient>;
  let dispose: () => void;
  beforeEach(() => {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    boundaries.enabled = false;
    dispose = vi.fn(); boundaries.register.mockReset().mockReturnValue({ dispose });
    useEditorStore.setState({ tabs: [], activeKeys: {}, reconcileTabFreshness: vi.fn().mockResolvedValue(undefined) });
    useSemanticNavigationStore.setState({
      getOrCreateClient: originalGetOrCreateClient,
      releaseClient: originalReleaseClient,
      globalSemanticEnabled: false,
      profileSemanticEnabled: {},
      activeRevealIntent: null,
      clientStatuses: {},
    });
    useSemanticNavigationStore.getState().disconnectAll();
    client = { getStatus: () => "disconnected", connect: vi.fn().mockResolvedValue(undefined), canAccessModel: vi.fn().mockReturnValue(true) };
    useSemanticNavigationStore.setState({
      getOrCreateClient: vi.fn().mockReturnValue(client as SemanticClient),
      releaseClient: vi.fn(),
    });
  });
  afterEach(() => {
    act(() => root.unmount()); container.remove(); queryClient.clear(); vi.restoreAllMocks();
    useEditorStore.setState({ tabs: [], activeKeys: {}, reconcileTabFreshness: originalReconcileTabFreshness });
    useSemanticNavigationStore.setState({
      getOrCreateClient: originalGetOrCreateClient,
      releaseClient: originalReleaseClient,
      globalSemanticEnabled: false,
      profileSemanticEnabled: {},
      activeRevealIntent: null,
      clientStatuses: {},
    });
    useSemanticNavigationStore.getState().disconnectAll();
  });
  async function render() {
    await act(async () => root.render(<QueryClientProvider client={queryClient}><EditorTabs project="example" target={target} /></QueryClientProvider>));
  }
  it("creates no client while semantics is OFF", async () => {
    await render();
    expect(useSemanticNavigationStore.getState().getOrCreateClient).not.toHaveBeenCalled();
    expect(boundaries.register).not.toHaveBeenCalled();
  });
  it("passes immutable authority and exact worktreePath to the client", async () => {
    boundaries.enabled = true; await render();
    expect(useSemanticNavigationStore.getState().getOrCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      profileId: target.profileId, project: target.project, worktreePath: target.worktreePath,
      provenance: boundaries.provenance, connectionGeneration: 1,
    }));
    expect(client.connect).toHaveBeenCalledTimes(1);
  });
  it("guards getModelText against foreign or unavailable retained drafts before returning source", async () => {
    boundaries.enabled = true; await render();
    const create = vi.mocked(useSemanticNavigationStore.getState().getOrCreateClient);
    const options: SemanticClientOptions = create.mock.calls[0][0];
    const retained = tab();
    act(() => useEditorStore.setState({ tabs: [retained] }));
    expect(options.getModelText?.(retained.key)).toBe("unsaved text");
    act(() => useEditorStore.setState({ tabs: [{ ...retained, semanticProvenance: { ...boundaries.provenance, actor: "actor-b" } }] }));
    expect(options.getModelText?.(retained.key)).toBeUndefined();
    act(() => useEditorStore.setState({ tabs: [{ ...retained, targetAvailable: false }] }));
    expect(options.getModelText?.(retained.key)).toBeUndefined();
    act(() => useEditorStore.setState({ tabs: [retained] }));
    vi.mocked(client.canAccessModel!).mockReturnValue(false);
    expect(options.getModelText?.(retained.key)).toBeUndefined();
  });
  it("releases the exact client and only its own registration on unmount", async () => {
    boundaries.enabled = true;
    const release = vi.mocked(useSemanticNavigationStore.getState().releaseClient);
    await render();
    expect(boundaries.register).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    expect(release).toHaveBeenCalledWith(expect.any(String), client);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
