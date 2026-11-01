import "@/lib/monaco-setup";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import { SessionChangesHost } from "@/components/organisms/SessionChangesHost";
import type { ConnectionRef } from "@/api/ownership";
import type { DamHopperConfig } from "@/api/client";
import { profileQueryKey } from "@/api/query-client";
import fixture from "../../../server/tests/fixtures/session-changes-wire.json";

let mockConfigReturn: {
  data: DamHopperConfig | undefined;
  isLoading: boolean;
  error: Error | null;
} = {
  data: {
    workspace: { name: "demo", root: "." },
    projects: [],
    server: { sessionChangesEnabled: true },
  },
  isLoading: false,
  error: null,
};

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock queries helper getBoundApiClient
vi.mock("@/api/connections", () => {
  return {
    getConnectionSnapshot: vi.fn((profileId: string) => ({
      status: "connected",
      owner: { profileId, generation: 1 },
    })),
    useConnectionSnapshot: vi.fn((profileId: string) => ({
      status: "connected",
      owner: { profileId, generation: 1 },
    })),
  };
});

vi.mock("@/api/queries", () => {
  return {
    resolveTargetOwner: vi.fn((owner?: unknown) =>
      typeof owner === "string" ? { profileId: owner, generation: 1 } : owner ?? undefined,
    ),
    useConfig: vi.fn(() => mockConfigReturn),
    getBoundApiClient: vi.fn().mockImplementation((owner: ConnectionRef) => {
      return {
        transport: {
          invoke: vi.fn().mockImplementation(async (channel: string) => {
            if (channel === "sessionChanges:status") {
              return fixture.valid.statusToolObservedReady;
            }
            if (channel === "sessionChanges:files") {
              return fixture.valid.filePage;
            }
            if (channel === "sessionChanges:file") {
              return fixture.valid.fileDetail;
            }
            throw new Error(`Unhandled mock channel: ${channel}`);
          }),
        },
      };
    }),
  };
});

describe("SessionChangesHost Browser Qualification", () => {
  let container: HTMLDivElement;
  let root: Root;
  let qc: QueryClient;

  const owner: ConnectionRef = { profileId: "prof-host-test", generation: 1 };

  beforeEach(() => {
    mockConfigReturn = {
      data: {
        workspace: { name: "demo", root: "." },
        projects: [],
        server: { sessionChangesEnabled: true },
      },
      isLoading: false,
      error: null,
    };
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    container = document.createElement("div");
    container.style.width = "1000px";
    container.style.height = "700px";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    qc.clear();
  });

  it("mounts modal dialog and isolates keyboard events", async () => {
    let closed = false;

    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <SessionChangesHost
            isOpen={true}
            owner={owner}
            terminalId="term-1"
            terminalIncarnation="1"
            ompSessionId="omp-sess-1"
            rootId="."
            onClose={() => {
              closed = true;
            }}
          />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="session-changes-host-content"]')).not.toBeNull();
    }, { timeout: 1000 });

    const contentEl = document.querySelector('[data-testid="session-changes-host-content"]');
    expect(contentEl).not.toBeNull();

    // Verify keydown handling inside host dialog does not bubble to document
    const documentKeyDownSpy = vi.fn();
    document.addEventListener("keydown", documentKeyDownSpy);

    const keyEvent = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    contentEl?.dispatchEvent(keyEvent);

    expect(documentKeyDownSpy).not.toHaveBeenCalled();
    document.removeEventListener("keydown", documentKeyDownSpy);
    // Close button
    const closeBtn = document.querySelector('button[aria-label="Close session changes review"]');
    expect(closeBtn).not.toBeNull();
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(closed).toBe(true);
  });

  it("rejects mount when session changes is disabled on server", async () => {
    mockConfigReturn = {
      data: {
        workspace: { name: "demo", root: "." },
        projects: [],
        server: { sessionChangesEnabled: false },
      },
      isLoading: false,
      error: null,
    };

    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <SessionChangesHost
            isOpen={true}
            owner={owner}
            terminalId="term-1"
            terminalIncarnation="1"
            ompSessionId="omp-sess-1"
            rootId="."
            onClose={() => {}}
          />
        </QueryClientProvider>,
      );
    });

    expect(
      document.querySelector('[data-testid="session-changes-host-content"]'),
    ).toBeNull();
  });

  it("closes open dialog and clears owner queries when authoritative OFF arrives", async () => {
    mockConfigReturn = {
      data: {
        workspace: { name: "demo", root: "." },
        projects: [],
        server: { sessionChangesEnabled: true },
      },
      isLoading: false,
      error: null,
    };

    let closed = false;
    qc.setQueryData(profileQueryKey(owner, "session-changes"), {
      cached: true,
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <SessionChangesHost
            isOpen={true}
            owner={owner}
            terminalId="term-1"
            terminalIncarnation="1"
            ompSessionId="omp-sess-1"
            rootId="."
            onClose={() => {
              closed = true;
            }}
          />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="session-changes-host-content"]'),
      ).not.toBeNull();
    }, { timeout: 1000 });

    // Authoritative OFF arrives
    mockConfigReturn = {
      data: {
        workspace: { name: "demo", root: "." },
        projects: [],
        server: { sessionChangesEnabled: false },
      },
      isLoading: false,
      error: null,
    };
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <SessionChangesHost
            isOpen={true}
            owner={owner}
            terminalId="term-1"
            terminalIncarnation="1"
            ompSessionId="omp-sess-1"
            rootId="."
            onClose={() => {
              closed = true;
            }}
          />
        </QueryClientProvider>,
      );
    });

    expect(closed).toBe(true);
    expect(
      qc.getQueryData(profileQueryKey(owner, "session-changes")),
    ).toBeUndefined();
  });
});
