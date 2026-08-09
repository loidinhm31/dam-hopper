// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client.js";
import { useExplorerLanguageScan } from "./queries.js";
import { handleWorkspaceChanged } from "@/hooks/use-sse.js";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("useExplorerLanguageScan", () => {
  it("does not request a scan when the disabled observer mounts", async () => {
    const languageFiles = vi
      .spyOn(api.fs, "languageFiles")
      .mockResolvedValue({ files: [], truncated: false, limit: 20_000 });
    const queryClient = new QueryClient();

    function Harness() {
      const observed = useExplorerLanguageScan("alpha");
      return (
        <output
          data-testid="scan-state"
          data-fetch-status={observed.fetchStatus}
          data-cache-empty={String(observed.cache === null)}
        />
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });

    expect(languageFiles).not.toHaveBeenCalled();
    const state = container.querySelector("[data-testid=scan-state]");
    expect(state?.getAttribute("data-fetch-status")).toBe("idle");
    expect(state?.getAttribute("data-cache-empty")).toBe("true");
  });

  it("resets an active observer when workspace scan caches are removed", async () => {
    const languageFiles = vi
      .spyOn(api.fs, "languageFiles")
      .mockResolvedValue({ files: [], truncated: false, limit: 20_000 });
    const queryClient = new QueryClient();
    queryClient.setQueryData(["explorer-language-scan", "alpha"], {
      result: { files: [], truncated: false, limit: 20_000 },
      generation: 0,
      resultVersion: 1,
      stale: false,
      scannedAt: 100,
    });

    function Harness() {
      const observed = useExplorerLanguageScan("alpha");
      return (
        <output
          data-testid="scan-state"
          data-cache-empty={String(observed.cache === null)}
          data-observer-empty={String(observed.data === undefined)}
        />
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    expect(
      container
        .querySelector("[data-testid=scan-state]")
        ?.getAttribute("data-cache-empty"),
    ).toBe("false");
    expect(
      container
        .querySelector("[data-testid=scan-state]")
        ?.getAttribute("data-observer-empty"),
    ).toBe("false");

    await act(async () => {
      await handleWorkspaceChanged(queryClient);
    });

    expect(languageFiles).not.toHaveBeenCalled();
    expect(
      container
        .querySelector("[data-testid=scan-state]")
        ?.getAttribute("data-cache-empty"),
    ).toBe("true");
    expect(
      container
        .querySelector("[data-testid=scan-state]")
        ?.getAttribute("data-observer-empty"),
    ).toBe("true");
  });
});
