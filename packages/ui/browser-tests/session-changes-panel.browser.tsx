import "@/lib/monaco-setup";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import { SessionChangesPanel } from "@/components/organisms/SessionChangesPanel";
import type { ConnectionRef } from "@/api/ownership";
import fixture from "../../../server/tests/fixtures/session-changes-wire.json";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock queries helper getBoundApiClient
let mockStatusToReturn: unknown = fixture.valid.statusSessionStartReady;

vi.mock("@/api/queries", () => {
  return {
    getBoundApiClient: vi.fn().mockImplementation((owner: ConnectionRef) => {
      return {
        transport: {
          invoke: vi.fn().mockImplementation(async (channel: string) => {
            if (channel === "sessionChanges:status") {
              return mockStatusToReturn;
            }
            if (channel === "sessionChanges:files") {
              return fixture.valid.filePage;
            }
            if (channel === "sessionChanges:file") {
              return fixture.valid.fileDetail;
            }
            if (channel === "sessionChanges:refresh") {
              return fixture.valid.statusSessionStartReady.comparison;
            }
            if (channel === "sessionChanges:fromNow") {
              mockStatusToReturn = fixture.valid.statusFromNowReady;
              return fixture.valid.statusFromNowReady;
            }
            throw new Error(`Unhandled mock channel: ${channel}`);
          }),
        },
      };
    }),
  };
});

describe("SessionChangesPanel Browser Tests", () => {
  let container: HTMLDivElement;
  let root: Root;
  let qc: QueryClient;

  const owner: ConnectionRef = { profileId: "prof-panel-test", generation: 1 };

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    container = document.createElement("div");
    container.style.width = "900px";
    container.style.height = "600px";
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

  it("renders ready state with files list and Monaco diff viewer", async () => {
    mockStatusToReturn = fixture.valid.statusSessionStartReady;
    let closed = false;

    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <SessionChangesPanel
            owner={owner}
            terminalId="t1"
            terminalIncarnation="1"
            ompSessionId="sess-1"
            onClose={() => {
              closed = true;
            }}
          />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Session Changes");
      expect(container.textContent).toContain("Changed Files");
      expect(container.textContent).toContain("src/main.rs");
    });

    // Verify resizable separator exists between files and diff panels
    const separator = container.querySelector('[aria-label="Resize files and diff panels"]');
    expect(separator).not.toBeNull();
    expect(separator?.className).toContain("cursor-col-resize");

    const closeBtn = container.querySelector('button[aria-label="Close session changes review"]');
    expect(closeBtn).not.toBeNull();
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(closed).toBe(true);
  });

  it("renders unavailable view when OMP session baseline is not yet recorded", async () => {
    mockStatusToReturn = fixture.valid.statusSessionStartUnavailablePending;

    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <SessionChangesPanel
            owner={owner}
            terminalId="t1"
            terminalIncarnation="1"
            ompSessionId="sess-1"
            onClose={() => {}}
          />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("No OMP Session Baseline");
      expect(container.textContent).toContain("When an OMP agent executes commands in this terminal");
    });
  });
});
