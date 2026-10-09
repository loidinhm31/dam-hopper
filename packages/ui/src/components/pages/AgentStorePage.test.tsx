// @vitest-environment jsdom
import { act, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { api, type AgentStoreItem } from "@/api/client.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ServerProfile } from "@/api/server-config.js";
import { buildAgentSettingsHref } from "@/lib/agent-store-navigation.js";
import type * as ServerConfigModule from "@/api/server-config.js";
import type * as ConnectionsModule from "@/api/connections.js";
import type * as QueriesModule from "@/api/queries.js";
import { AgentStorePage } from "./AgentStorePage.js";

const state = vi.hoisted(() => ({
  profiles: [] as ServerProfile[],
  activeId: "A",
  connections: new Map<string, ConnectionSnapshot>(),
  profileListeners: new Set<() => void>(),
  connectionListeners: new Set<() => void>(),
  clients: new Map<string, {
    agentStore: { list: Mock; matrix: Mock };
    projects: { list: Mock };
  }>(),
  getApi: vi.fn(),
  setActiveProfile: vi.fn(),
  updateProfile: vi.fn(),
  connectProfile: vi.fn(),
  itemsHook: vi.fn(),
  matrixHook: vi.fn(),
  projectsHook: vi.fn(),
  installOmp: vi.fn(),
  installNative: vi.fn(),
}));

vi.mock("@/api/server-config.js", async (importOriginal) => ({
  ...await importOriginal<typeof ServerConfigModule>(),
  getProfiles: () => state.profiles,
  getActiveProfileId: () => state.activeId,
  subscribeToProfileChanges: (listener: () => void) => {
    state.profileListeners.add(listener);
    return () => state.profileListeners.delete(listener);
  },
  setActiveProfile: state.setActiveProfile,
  updateProfile: state.updateProfile,
}));

vi.mock("@/api/connections.js", async (importOriginal) => {
  return {
    ...await importOriginal<typeof ConnectionsModule>(),
    getApi: state.getApi,
    getConnectionSnapshot: (id: string) => state.connections.get(id) ?? null,
    connectProfile: state.connectProfile,
    useConnectionSnapshot: (id: string) => useSyncExternalStore(
      (listener) => {
        state.connectionListeners.add(listener);
        return () => state.connectionListeners.delete(listener);
      },
      () => state.connections.get(id) ?? null,
      () => null,
    ),
  };
});

// Run the real query hooks: denial assertions cover both mounts and API work.
vi.mock("@/api/queries.js", async (importOriginal) => {
  const original = await importOriginal<typeof QueriesModule>();
  return {
    ...original,
    useAgentStoreItems: state.itemsHook.mockImplementation(original.useAgentStoreItems),
    useAgentStoreMatrix: state.matrixHook.mockImplementation(original.useAgentStoreMatrix),
    useProjects: state.projectsHook.mockImplementation(original.useProjects),
    useInstallOmpExtension: state.installOmp,
    useInstallNativeIntegration: state.installNative,
  };
});

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ title, children }: { title: string; children: ReactNode }) => (
    <main><h1>{title}</h1>{children}</main>
  ),
}));
vi.mock("@/components/organisms/DiagnosticsExportButton.js", () => ({
  DiagnosticsExportButton: () => <button>Export</button>,
}));
vi.mock("@/components/organisms/StoreInventory.js", () => ({
  StoreInventory: ({ items, onSelect }: { items: AgentStoreItem[]; onSelect: (item: AgentStoreItem) => void }) => (
    <div>{items.map((item) => <button key={item.name} onClick={() => onSelect(item)}>{item.name}</button>)}</div>
  ),
}));
vi.mock("@/components/organisms/ItemDetail.js", () => ({
  ItemDetail: ({ item, onShip }: { item: AgentStoreItem; onShip: () => void }) => (
    <section aria-label="Item preview">{item.name}<button onClick={onShip}>Ship item</button></section>
  ),
}));
vi.mock("@/components/organisms/DistributionMatrix.js", () => ({
  DistributionMatrix: ({ owner }: { owner: ConnectionRef }) => <div aria-label="Distribution" data-owner={JSON.stringify(owner)} />,
}));
vi.mock("@/components/organisms/HealthStatus.js", () => ({
  HealthStatus: ({ owner }: { owner: ConnectionRef }) => <div aria-label="Health" data-owner={JSON.stringify(owner)} />,
}));
vi.mock("@/components/organisms/AgentSettings.js", () => ({
  AgentSettings: ({ owner, profileId }: { owner: ConnectionRef; profileId: string }) => (
    <section aria-label="Settings panel" data-owner={JSON.stringify(owner)} data-profile={profileId}>
      <input aria-label="Settings draft" defaultValue="" />
    </section>
  ),
}));
vi.mock("@/components/organisms/MemoryEditor.js", () => ({
  MemoryEditor: ({ owner, profileId }: { owner: ConnectionRef; profileId: string }) => (
    <section aria-label="Memory editor" data-owner={JSON.stringify(owner)} data-profile={profileId} />
  ),
}));
vi.mock("@/components/organisms/ShipDialog.js", () => ({
  ShipDialog: ({ owner, onClose }: { owner: ConnectionRef; onClose: () => void }) => (
    <div role="dialog" aria-label="Ship" data-owner={JSON.stringify(owner)}><button onClick={onClose}>Close ship</button></div>
  ),
}));
vi.mock("@/components/organisms/ImportDialog.js", () => ({
  ImportDialog: ({ owner, onClose }: { owner: ConnectionRef; onClose: () => void }) => (
    <div role="dialog" aria-label="Import" data-owner={JSON.stringify(owner)}><button onClick={onClose}>Close import</button></div>
  ),
}));

function NavigationControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return <aside>
    <button onClick={() => navigate(buildAgentSettingsHref("B"))}>Settings for B</button>
    <button onClick={() => navigate(buildAgentSettingsHref("A"))}>Settings for A</button>
    <button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => navigate(1)}>Forward</button>
    <output aria-label="Current route">{location.pathname}{location.search}</output>
  </aside>;
}

function profile(id: string): ServerProfile {
  return { id, name: `Server ${id}`, url: "http://localhost:4800", authType: "none", createdAt: 0, autoConnect: false };
}
function item(name: string): AgentStoreItem {
  return { name, category: "skill", relativePath: `${name}/SKILL.md`, compatibleAgents: ["claude"] };
}
function connect(id: string, generation = 1, status: ConnectionSnapshot["status"] = "connected") {
  const owner = { profileId: id, generation };
  state.connections.set(id, { owner, status, intent: false, serverUrl: "http://localhost:4800", error: null });
  const client = {
    agentStore: { list: vi.fn().mockResolvedValue([item(`${id}-${generation}-skill`)]), matrix: vi.fn().mockResolvedValue({}) },
    projects: { list: vi.fn().mockResolvedValue([]) },
  };
  state.clients.set(JSON.stringify(owner), client);
  return client;
}

describe("AgentStorePage profile navigation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    state.profiles = [profile("A"), profile("B")];
    state.activeId = "A";
    state.connections.clear();
    state.clients.clear();
    state.profileListeners.clear();
    state.connectionListeners.clear();
    connect("A");
    connect("B");
    state.getApi.mockImplementation((owner: ConnectionRef) => {
      const snapshot = state.connections.get(owner.profileId);
      if (snapshot?.status !== "connected" || snapshot.owner.generation !== owner.generation) throw new Error("Stale owner");
      return state.clients.get(JSON.stringify(owner));
    });
    vi.spyOn(api.agentStore, "list").mockResolvedValue([]);
    vi.spyOn(api.agentStore, "matrix").mockResolvedValue({});
    vi.spyOn(api.projects, "list").mockResolvedValue([]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  });

  afterEach(() => {
    expect(api.agentStore.list).not.toHaveBeenCalled();
    expect(api.agentStore.matrix).not.toHaveBeenCalled();
    expect(api.projects.list).not.toHaveBeenCalled();
    expect(state.setActiveProfile).not.toHaveBeenCalled();
    expect(state.updateProfile).not.toHaveBeenCalled();
    expect(state.connectProfile).not.toHaveBeenCalled();
    expect(state.installOmp).not.toHaveBeenCalled();
    expect(state.installNative).not.toHaveBeenCalled();
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(route = "/agent-store") {
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}><NavigationControls /><AgentStorePage /></MemoryRouter>
      </QueryClientProvider>,
    ));
  }
  async function click(name: string) {
    const button = Array.from(container.querySelectorAll("button")).find((element) => element.textContent === name);
    expect(button, name).toBeDefined();
    await act(async () => button!.click());
  }
  function panel(name: string) { return container.querySelector(`[aria-label="${name}"]`); }
  function expectOwner(name: string, profileId: string, generation = 1) {
    expect(panel(name)?.getAttribute("data-owner")).toBe(JSON.stringify({ profileId, generation }));
  }
  async function waitForPanel(name: string) {
    await vi.waitFor(async () => {
      await act(async () => { await Promise.resolve(); });
      expect(panel(name)).not.toBeNull();
    });
  }
  async function waitForItem(name: string) {
    await vi.waitFor(async () => {
      await act(async () => { await Promise.resolve(); });
      expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === name)).toBe(true);
    });
  }
  async function choose(id: string) {
    const select = container.querySelector("select")!;
    await act(async () => {
      select.value = id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function publishConnections() {
    await act(async () => state.connectionListeners.forEach((listener) => listener()));
  }
  async function publishProfiles() {
    await act(async () => state.profileListeners.forEach((listener) => listener()));
  }
  function expectNoWork() {
    expect(state.itemsHook).not.toHaveBeenCalled();
    expect(state.matrixHook).not.toHaveBeenCalled();
    expect(state.projectsHook).not.toHaveBeenCalled();
    expect(state.getApi).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(panel("Settings panel")).toBeNull();
  }

  it("renders bare entry without loops and retains default A through tab switching", async () => {
    await render();
    await waitForItem("A-1-skill");
    expectOwner("Health", "A");
    await click("Agent Settings");
    await waitForPanel("Settings panel");
    expectOwner("Settings panel", "A");
    expect(panel("Current route")?.textContent).toBe("/agent-store?tab=settings&profileId=A");
    await click("Memory Files");
    await waitForPanel("Memory editor");
    expectOwner("Memory editor", "A");
  });

  it("validates active profile before choosing the ordinary first default", async () => {
    state.activeId = "missing";
    await render();
    await waitForItem("A-1-skill");
    expectOwner("Distribution", "A");
  });

  it("opens requested B Settings while active A remains unchanged", async () => {
    await render(buildAgentSettingsHref("B"));
    await waitForPanel("Settings panel");
    expectOwner("Settings panel", "B");
    expect(panel("Settings panel")?.getAttribute("data-profile")).toBe("B");
    expect(state.getApi.mock.calls.every(([owner]) => owner.profileId === "B")).toBe(true);
    expect(state.activeId).toBe("A");
  });

  it("opens encoded reserved-character targets without re-decoding", async () => {
    const id = "B &?#%26 máy";
    state.profiles.push(profile(id));
    connect(id);
    await render(buildAgentSettingsHref(id));
    await waitForPanel("Settings panel");
    expectOwner("Settings panel", id);
  });

  it.each(["disconnected", "connecting", "offline", "login-required", "mfa-required", "unsupported"] as const)(
    "denies all work for explicit B in %s state", async (status) => {
      connect("B", 1, status);
      await render(buildAgentSettingsHref("B"));
      expectNoWork();
      expect(container.querySelector("select")?.value).toBe("B");
      expect(container.textContent).toContain(`Server B is unavailable (${status})`);
    },
  );

  it("denies registered target with missing or mismatched connection evidence", async () => {
    state.connections.delete("B");
    await render(buildAgentSettingsHref("B"));
    expectNoWork();
    state.connections.set("B", state.connections.get("A")!);
    await publishConnections();
    expectNoWork();
  });

  it.each(["?tab=settings&profileId=missing", "?tab=settings&profileId=", "?tab=settings&profileId=B&profileId=B"])(
    "fails closed before queries for %s until deliberate selection", async (search) => {
      await render(`/agent-store${search}`);
      expectNoWork();
      state.activeId = "B";
      await publishProfiles();
      expectNoWork();
      await choose("A");
      await waitForPanel("Settings panel");
      expectOwner("Settings panel", "A");
    },
  );

  it("requires a deliberate chooser selection even with only one connected profile", async () => {
    state.profiles = [profile("B")];
    await render(buildAgentSettingsHref(null));
    expectNoWork();
    expect(container.querySelector("select")?.value).toBe("");
    await choose("B");
    await waitForPanel("Settings panel");
    expectOwner("Settings panel", "B");
  });

  it.each(["Store", "Memory Files", "Import"])(
    "keeps unresolved Settings ownership when %s is requested", async (tab) => {
      await render(buildAgentSettingsHref(null));
      await click(tab);
      expect(container.querySelector("select")?.value).toBe("");
      expectNoWork();
      expect(panel("Current route")?.textContent).toBe("/agent-store?tab=settings");

      await choose("B");
      await waitForPanel("Settings panel");
      await click(tab);
      if (tab === "Store") await waitForItem("B-1-skill");
      else if (tab === "Memory Files") await waitForPanel("Memory editor");
      else {
        await click("Import from Repo");
        await waitForPanel("Import");
      }
      expect(state.getApi.mock.calls.every(([owner]) => owner.profileId === "B")).toBe(true);
      expect(state.activeId).toBe("A");
    },
  );

  it("restores unresolved ownership through Back and Forward without adopting default A", async () => {
    await render(buildAgentSettingsHref(null));
    await click("Memory Files");
    expectNoWork();
    await choose("B");
    await waitForPanel("Settings panel");
    await click("Back");
    expect(container.querySelector("select")?.value).toBe("");
    expect(panel("Settings panel")).toBeNull();
    const callsBeforeAttempt = state.getApi.mock.calls.length;
    await click("Store");
    expect(state.getApi).toHaveBeenCalledTimes(callsBeforeAttempt);
    expect(panel("Current route")?.textContent).toBe("/agent-store?tab=settings");
    await click("Forward");
    await waitForPanel("Settings panel");
    expectOwner("Settings panel", "B");
    expect(state.getApi.mock.calls.every(([owner]) => owner.profileId === "B")).toBe(true);
  });

  it("keeps unknown tab default separate from explicit B targeting", async () => {
    await render("/agent-store?tab=unknown&profileId=B");
    await waitForItem("B-1-skill");
    expectOwner("Health", "B");
  });

  it("reacts to same-page navigation and Back/Forward for both target and tab", async () => {
    await render();
    await waitForItem("A-1-skill");
    await click("Settings for B");
    await waitForPanel("Settings panel");
    expectOwner("Settings panel", "B");
    await click("Memory Files");
    await waitForPanel("Memory editor");
    expectOwner("Memory editor", "B");
    await click("Back");
    await waitForPanel("Settings panel");
    expectOwner("Settings panel", "B");
    await click("Back");
    expect(panel("Settings panel")).toBeNull();
    expectOwner("Health", "A");
    await click("Forward");
    await waitForPanel("Settings panel");
    expectOwner("Settings panel", "B");
  });

  it("retires selected items and ship dialogs when B is removed without falling back", async () => {
    await render("/agent-store?profileId=B");
    await waitForItem("B-1-skill");
    await click("B-1-skill");
    await click("Ship item");
    expectOwner("Ship", "B");
    state.profiles = [profile("A")];
    await publishProfiles();
    expect(panel("Ship")).toBeNull();
    expect(panel("Item preview")).toBeNull();
    expect(container.textContent).toContain("Profile B is no longer available");
    const callsAfterRemoval = state.getApi.mock.calls.length;
    state.activeId = "A";
    await publishProfiles();
    expect(state.getApi).toHaveBeenCalledTimes(callsAfterRemoval);
    await choose("A");
    await waitForItem("A-1-skill");
    expect(panel("Item preview")).toBeNull();
    expect(panel("Ship")).toBeNull();
  });

  it("does not replace a removed ordinary default with the first remaining profile", async () => {
    await render();
    await waitForItem("A-1-skill");
    state.profiles = [profile("B")];
    await publishProfiles();
    expect(panel("Health")).toBeNull();
    expect(container.textContent).toContain("Profile A is no longer available");
    expect(state.clients.get(JSON.stringify({ profileId: "B", generation: 1 }))?.agentStore.list).not.toHaveBeenCalled();
  });

  it("retires actionable state on same-profile generation replacement", async () => {
    await render("/agent-store?profileId=B");
    await waitForItem("B-1-skill");
    await click("B-1-skill");
    await click("Ship item");
    connect("B", 2);
    await publishConnections();
    await waitForItem("B-2-skill");
    expectOwner("Health", "B", 2);
    expect(panel("Item preview")).toBeNull();
    expect(panel("Ship")).toBeNull();
    await click("B-2-skill");
    await click("Ship item");
    expectOwner("Ship", "B", 2);
    expect(queryClient.getQueryData(["profile", "B", 2, "agent-store", "items", "all"])).toEqual([item("B-2-skill")]);
  });

  it("retires import and settings draft on disconnect/reconnect and forwards the new owner", async () => {
    await render("/agent-store?tab=import&profileId=B");
    await click("Import from Repo");
    await waitForPanel("Import");
    expectOwner("Import", "B");
    connect("B", 2, "disconnected");
    await publishConnections();
    expect(panel("Import")).toBeNull();
    const calls = state.getApi.mock.calls.length;
    expect(container.querySelector("select")?.value).toBe("B");
    connect("B", 3);
    await publishConnections();
    expect(panel("Import")).toBeNull();
    await click("Import from Repo");
    await waitForPanel("Import");
    expectOwner("Import", "B", 3);
    expect(state.getApi.mock.calls.slice(calls).every(([owner]) => owner.profileId === "B" && owner.generation === 3)).toBe(true);
    await click("Close import");
    await click("Agent Settings");
    await waitForPanel("Settings panel");
    const draft = panel("Settings panel")!.querySelector("input")!;
    draft.value = "old owner draft";
    connect("B", 4);
    await publishConnections();
    await waitForPanel("Settings panel");
    expectOwner("Settings panel", "B", 4);
    expect(panel("Settings panel")!.querySelector("input")!.value).toBe("");
  });

  it("does not publish a late old-generation inventory response in the current child", async () => {
    let resolveOld!: (items: AgentStoreItem[]) => void;
    const oldResponse = new Promise<AgentStoreItem[]>((resolve) => { resolveOld = resolve; });
    state.clients.get(JSON.stringify({ profileId: "B", generation: 1 }))!.agentStore.list.mockReturnValue(oldResponse);
    await render("/agent-store?profileId=B");
    connect("B", 2);
    await publishConnections();
    await waitForItem("B-2-skill");
    await act(async () => { resolveOld([item("stale-generation-skill")]); await oldResponse; });
    expect(container.textContent).not.toContain("stale-generation-skill");
    expect(container.textContent).toContain("B-2-skill");
    expectOwner("Health", "B", 2);
  });

  it("delays MemoryEditor mounting until owner projects query resolves", async () => {
    let resolveProjects!: (projects: ProjectConfig[]) => void;
    const pendingProjects = new Promise<ProjectConfig[]>((resolve) => {
      resolveProjects = resolve;
    });
    state.clients.get(JSON.stringify({ profileId: "B", generation: 1 }))!.projects.list.mockReturnValue(pendingProjects);
    await render("/agent-store?tab=memory&profileId=B");
    expect(container.textContent).toContain("Loading agent store…");
    expect(panel("Memory editor")).toBeNull();
    await act(async () => {
      resolveProjects([{ name: "deferred-project" } as ProjectConfig]);
      await pendingProjects;
    });
    await waitForPanel("Memory editor");
    expectOwner("Memory editor", "B", 1);
  });
});
