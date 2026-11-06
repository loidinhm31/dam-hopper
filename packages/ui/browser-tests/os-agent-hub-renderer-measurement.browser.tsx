import "@/index.css";
import "@/os/os.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OsResourceHost } from "@/os/OsResourceHost.js";
import { AgentHubApp } from "@/os/apps/AgentHubApp.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { useHubTerminalMountsStore } from "@/os/agent-hub/hub-terminal-mounts-store.js";
import { terminalRegistry } from "@/lib/terminal-registry.js";
import { __setConnectionSnapshotForTests, resetConnections } from "@/api/connections.js";
import { saveProfiles, type ServerProfile } from "@/api/server-config.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import type { WsTransport } from "@/api/ws-transport.js";
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function readJsHeapBytes(): number | null {
  if (typeof performance === "undefined") return null;
  const perfWithMem = performance as Performance & {
    memory?: { usedJSHeapSize: number };
  };
  const mem = perfWithMem.memory;
  if (mem && typeof mem.usedJSHeapSize === "number") {
    return mem.usedJSHeapSize;
  }
  return null;
}

import type { SessionInfo } from "@/api/client.js";
import type { OsWindow } from "@/os/types.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const profileAlpha: ServerProfile = {
  id: "profile-alpha",
  name: "Host Alpha",
  url: "http://127.0.0.1:4801",
  authType: "none",
  createdAt: 1,
  autoConnect: true,
};

const profileBeta: ServerProfile = {
  id: "profile-beta",
  name: "Host Beta",
  url: "http://127.0.0.1:4802",
  authType: "none",
  createdAt: 2,
  autoConnect: true,
};

interface MeasurementSample {
  stage: string;
  evidenceClass: "browser, mocked transport" | "live";
  m1RegistryInstances: number;
  m1DomTokens: number;
  m2ActiveSubscriptionsTotal: number;
  m2ActiveSubscriptionsBySession: Record<string, number>;
  m3CumulativeAttachAttempts: number;
  m4JsHeapBytes: number | null;
}

interface CountingTransportContext {
  transport: WsTransport;
  activeSubscriptions: Set<() => void>;
  sessionSubscriptionCounts: Map<string, number>;
  cumulativeAttachCount: { value: number };
}

function createCountingTransport(
  profileId: string,
  sessions: SessionInfo[],
  projects: { name: string; path?: string }[] = [],
): CountingTransportContext {
  const activeSubscriptions = new Set<() => void>();
  const sessionSubscriptionCounts = new Map<string, number>();
  const cumulativeAttachCount = { value: 0 };

  function trackSubscription(sessionId: string | undefined, cleanup: () => void): () => void {
    const trackedCleanup = () => {
      if (activeSubscriptions.has(trackedCleanup)) {
        activeSubscriptions.delete(trackedCleanup);
        if (sessionId) {
          const count = sessionSubscriptionCounts.get(sessionId) ?? 0;
          if (count <= 1) {
            sessionSubscriptionCounts.delete(sessionId);
          } else {
            sessionSubscriptionCounts.set(sessionId, count - 1);
          }
        }
        cleanup();
      }
    };
    activeSubscriptions.add(trackedCleanup);
    if (sessionId) {
      sessionSubscriptionCounts.set(
        sessionId,
        (sessionSubscriptionCounts.get(sessionId) ?? 0) + 1,
      );
    }
    return trackedCleanup;
  }

  const transport = {
    invoke: vi.fn().mockImplementation((action: string) => {
      if (
        action === "terminal:listDetailedObservation" ||
        action === "terminal:listDetailed" ||
        action === "terminal:list"
      ) {
        return Promise.resolve({
          sessions: sessions.map((s) => ({
            ...s,
            incarnationExact: String(s.incarnation ?? 1),
            terminationState: s.alive ? "live" : "exited",
          })),
          termination: {
            version: 1,
            serverEpoch:
              profileId === profileAlpha.id
                ? "00000000-0000-0000-0000-000000000001"
                : "00000000-0000-0000-0000-000000000002",
          },
        });
      }
      if (action === "projects:list" || action === "project:list") {
        return Promise.resolve(projects);
      }
      return Promise.resolve([]);
    }),
    request: vi.fn().mockResolvedValue([]),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    terminalAttach: vi.fn().mockImplementation(() => {
      cumulativeAttachCount.value += 1;
      return true;
    }),
    onTerminalData: vi.fn().mockImplementation((sessionId: string, _cb: unknown) => {
      return trackSubscription(sessionId, () => {});
    }),
    onTerminalBuffer: vi.fn().mockImplementation((sessionId: string, _cb: unknown) => {
      return trackSubscription(sessionId, () => {});
    }),
    onTerminalExit: vi.fn().mockImplementation((sessionId: string, _cb: unknown) => {
      return trackSubscription(sessionId, () => {});
    }),
    onTerminalLifecycle: vi.fn().mockImplementation((sessionId: string, _cb: unknown) => {
      return trackSubscription(sessionId, () => {});
    }),
    onProcessRestarted: vi.fn().mockImplementation((_cb: unknown) => {
      return trackSubscription(undefined, () => {});
    }),
    onStatusChange: vi.fn().mockImplementation((_cb: unknown) => {
      return trackSubscription(undefined, () => {});
    }),
    onEvent: vi.fn().mockImplementation((_cb: unknown) => {
      return trackSubscription(undefined, () => {});
    }),
    onClose: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  } as unknown as WsTransport;

  return {
    transport,
    activeSubscriptions,
    sessionSubscriptionCounts,
    cumulativeAttachCount,
  };
}

describe("R5 Renderer cost measurement harness (V2, F10)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let transportAlphaCtx: CountingTransportContext;
  let transportBetaCtx: CountingTransportContext;

  // 12 sessions on profile-alpha, 10 sessions on profile-beta = 22 sessions total
  const alphaSessions: SessionInfo[] = Array.from({ length: 12 }, (_, i) => ({
    id: `term-alpha-${i + 1}`,
    project: "alpha-project",
    alive: true,
    incarnation: 1,
    command: "bash",
  }));

  const betaSessions: SessionInfo[] = Array.from({ length: 10 }, (_, i) => ({
    id: `term-beta-${i + 1}`,
    project: "beta-project",
    alive: true,
    incarnation: 1,
    command: "zsh",
  }));

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "renderer-measurement-root";
    container.style.width = "1440px";
    container.style.height = "900px";
    container.style.position = "relative";
    document.body.appendChild(container);
    root = createRoot(container);

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });

    globalResourceRegistry.clear();
    terminalRegistry.clear();
    useHubTerminalMountsStore.setState({ mountsByHub: {} });
    useCognitoModeStore.getState().reset();
    resetConnections();

    saveProfiles([profileAlpha, profileBeta], profileAlpha.id);

    transportAlphaCtx = createCountingTransport(
      profileAlpha.id,
      alphaSessions,
      [{ name: "alpha-project", path: "/workspace/alpha-project" }],
    );

    transportBetaCtx = createCountingTransport(
      profileBeta.id,
      betaSessions,
      [{ name: "beta-project", path: "/workspace/beta-project" }],
    );

    __setConnectionSnapshotForTests(
      profileAlpha.id,
      {
        owner: { profileId: profileAlpha.id, generation: 1 },
        status: "connected",
        serverUrl: profileAlpha.url,
      },
      transportAlphaCtx.transport,
    );

    __setConnectionSnapshotForTests(
      profileBeta.id,
      {
        owner: { profileId: profileBeta.id, generation: 1 },
        status: "connected",
        serverUrl: profileBeta.url,
      },
      transportBetaCtx.transport,
    );

    useWindowStore.getState().setSession(createDefaultOsSession("desk-1", "Main"));
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    resetConnections();
    terminalRegistry.clear();
  });

  function sampleMetrics(stage: string): MeasurementSample {
    const distinctRegistryEntries = new Set(terminalRegistry.values()).size;
    const domTokens = container.querySelectorAll("[data-xterm-instance-token]").length;

    const m2Total =
      transportAlphaCtx.activeSubscriptions.size +
      transportBetaCtx.activeSubscriptions.size;

    const bySession: Record<string, number> = {};
    for (const [sId, c] of transportAlphaCtx.sessionSubscriptionCounts.entries()) {
      bySession[sId] = (bySession[sId] ?? 0) + c;
    }
    for (const [sId, c] of transportBetaCtx.sessionSubscriptionCounts.entries()) {
      bySession[sId] = (bySession[sId] ?? 0) + c;
    }

    const m3Total =
      transportAlphaCtx.cumulativeAttachCount.value +
      transportBetaCtx.cumulativeAttachCount.value;

    const heapBytes = readJsHeapBytes();

    return {
      stage,
      evidenceClass: "browser, mocked transport",
      m1RegistryInstances: distinctRegistryEntries,
      m1DomTokens: domTokens,
      m2ActiveSubscriptionsTotal: m2Total,
      m2ActiveSubscriptionsBySession: bySession,
      m3CumulativeAttachAttempts: m3Total,
      m4JsHeapBytes: heapBytes,
    };
  }

  it("measures renderer instances, active subscriptions, attach attempts, and heap across 6 lifecycle stages with >=20 live sessions across 2 profiles", async () => {
    const samples: MeasurementSample[] = [];

    // Stage 1: baseline (empty desktop, no session windows)
    await act(async () => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <OsResourceHost />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    samples.push(sampleMetrics("baseline"));

    // Stage 2: Hub open
    const hubWinId = "hub-measurement-win";
    const hubWindow: OsWindow = {
      id: hubWinId,
      appId: "agent-hub",
      title: "Agent Hub",
      desktopId: "desk-1",
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      state: "normal",
      zIndex: 1,
      ctx: { profileId: profileAlpha.id },
      appState: {
        selectedWorkspace: "alpha-project",
      },
    };

    await act(async () => {
      useWindowStore.getState().openWindow(hubWindow);
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <OsResourceHost>
              <div style={{ width: "1440px", height: "900px", position: "relative" }}>
                <AgentHubApp window={hubWindow} />
              </div>
            </OsResourceHost>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    // Allow query effects and terminal mounts to settle
    await act(async () => {
      await delay(150);
    });
    samples.push(sampleMetrics("Hub open"));

    // Stage 3: project switch (switch from alpha-project to beta-project)
    const updatedHubWindow: OsWindow = {
      ...hubWindow,
      ctx: { profileId: profileBeta.id },
      appState: {
        selectedWorkspace: "beta-project",
      },
    };

    await act(async () => {
      useWindowStore.getState().updateWindowContext(hubWinId, updatedHubWindow.ctx);
      useWindowStore.getState().updateAppState(hubWinId, updatedHubWindow.appState);
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <OsResourceHost>
              <div style={{ width: "1440px", height: "900px", position: "relative" }}>
                <AgentHubApp window={updatedHubWindow} />
              </div>
            </OsResourceHost>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await delay(150);
    });
    samples.push(sampleMetrics("project switch"));
    // Stage 4: sidebar hide/show
    const toggleSidebarBtn = container.querySelector(
      'button[aria-label="Toggle projects sidebar"]',
    ) as HTMLButtonElement | null;
    if (toggleSidebarBtn) {
      await act(async () => {
        toggleSidebarBtn.click();
      });
      await act(async () => {
        await delay(50);
      });
      await act(async () => {
        toggleSidebarBtn.click();
      });
      await act(async () => {
        await delay(50);
      });
    }
    samples.push(sampleMetrics("sidebar hide/show"));

    // Stage 5: split
    // Trigger split / layout update on the terminal display
    await act(async () => {
      const splitBtn = container.querySelector(
        'button[aria-label^="Split"], button[title^="Split"]',
      ) as HTMLButtonElement | null;
      if (splitBtn) {
        splitBtn.click();
      }
      await delay(50);
    });
    samples.push(sampleMetrics("split"));

    // Stage 6: Hub close
    await act(async () => {
      useWindowStore.getState().closeWindow(hubWinId);
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <OsResourceHost />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await delay(100);
    });
    const hubCloseSample = sampleMetrics("Hub close");
    samples.push(hubCloseSample);

    // Print measurements table with evidence class
    console.log("=== R5 RENDERER COST MEASUREMENT REPORT ===");
    console.log("Evidence class: browser, mocked transport");
    console.log("Total seeded live sessions: 22 (12 on profile-alpha, 10 on profile-beta)");
    for (const s of samples) {
      console.log(
        `[STAGE: ${s.stage}] M1_reg=${s.m1RegistryInstances} M1_dom=${s.m1DomTokens} M2_sub=${s.m2ActiveSubscriptionsTotal} M3_attach=${s.m3CumulativeAttachAttempts} M4_heap=${s.m4JsHeapBytes ?? "N/A"}`
      );
    }
    console.log("JSON_SAMPLES: " + JSON.stringify(samples));

    // Verification: V2 measurement-only with leak assertion on teardown
    // A residual subscription after Hub close is recorded as a leak finding
    expect(hubCloseSample.m2ActiveSubscriptionsTotal).toBe(0);
  });
});
