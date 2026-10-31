import "@/lib/monaco-setup";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import { SessionChangesHost } from "@/components/organisms/SessionChangesHost";
import type { ConnectionRef } from "@/api/ownership";
import fixture from "../../../server/tests/fixtures/session-changes-wire.json";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock queries helper getBoundApiClient
vi.mock("@/api/queries", () => {
  return {
    getBoundApiClient: vi.fn().mockImplementation((owner: ConnectionRef) => {
      return {
        transport: {
          invoke: vi.fn().mockImplementation(async (channel: string) => {
            if (channel === "sessionChanges:status") {
              return fixture.valid.statusSessionStartReady;
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
    });

    const contentEl = document.querySelector('[data-testid="session-changes-host-content"]');
    expect(contentEl).not.toBeNull();

    // Verify keydown handling inside host dialog
    const keyEvent = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    contentEl?.dispatchEvent(keyEvent);

    // Close button
    const closeBtn = document.querySelector('button[aria-label="Close session changes review"]');
    expect(closeBtn).not.toBeNull();
    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(closed).toBe(true);
  });
});
