import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary, isStaleChunkError } from "./ErrorBoundary.js";

vi.mock("@dam-hopper/shared/logger", () => ({
  logger: { error: vi.fn() },
}));

vi.mock("@/lib/diagnostics-client.js", () => ({
  recordClientDiagnostic: vi.fn(),
}));

const errorInfo = { componentStack: "" };

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
}

function stubBrowser(
  storage: Storage,
  reload = vi.fn(),
): ReturnType<typeof vi.fn> {
  vi.stubGlobal("window", {
    location: { reload },
    sessionStorage: storage,
  });
  return reload;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isStaleChunkError", () => {
  it.each([
    Object.assign(new Error("chunk request failed"), {
      name: "ChunkLoadError",
    }),
    new Error("Loading chunk 123 failed."),
    new Error(
      "Failed to fetch dynamically imported module: https://example.test/assets/page.js",
    ),
    new Error("Importing a module script failed."),
  ])("recognizes known module-load failures", (error) => {
    expect(isStaleChunkError(error)).toBe(true);
  });

  it("rejects unrelated and approximate errors", () => {
    expect(isStaleChunkError(new Error("Failed to fetch API response"))).toBe(
      false,
    );
    expect(
      isStaleChunkError(new Error("Imported module threw while rendering")),
    ).toBe(false);
    expect(isStaleChunkError("Importing a module script failed.")).toBe(false);
  });
});

describe("ErrorBoundary stale-chunk recovery", () => {
  it("stores the session guard before reloading for the first stale failure", () => {
    const storage = createStorage();
    const reload = stubBrowser(storage);
    const boundary = new ErrorBoundary({});

    boundary.componentDidCatch(
      new Error("Failed to fetch dynamically imported module: /assets/page.js"),
      errorInfo,
    );

    expect(storage.setItem).toHaveBeenCalledWith(
      "dam-hopper:stale-chunk-reload-attempted",
      "1",
    );
    expect(storage.setItem).toHaveBeenCalledBefore(reload);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload a second time in the same session", () => {
    const storage = createStorage();
    storage.setItem("dam-hopper:stale-chunk-reload-attempted", "1");
    vi.mocked(storage.setItem).mockClear();
    const reload = stubBrowser(storage);
    const boundary = new ErrorBoundary({});

    boundary.componentDidCatch(
      new Error("Loading chunk 42 failed."),
      errorInfo,
    );

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps the existing fallback for unrelated render errors", () => {
    const storage = createStorage();
    const reload = stubBrowser(storage);
    const error = new Error("Render failed");
    const boundary = new ErrorBoundary({});

    boundary.state = ErrorBoundary.getDerivedStateFromError(error);
    boundary.componentDidCatch(error, errorInfo);

    expect(renderToStaticMarkup(boundary.render())).toContain("Render failed");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(["read", "write"] as const)(
    "shows the fallback when session storage %s fails",
    (operation) => {
      const storage = createStorage();
      vi.mocked(
        storage[operation === "read" ? "getItem" : "setItem"],
      ).mockImplementation(() => {
        throw new Error("Storage unavailable");
      });
      const reload = stubBrowser(storage);
      const error = new Error("Importing a module script failed.");
      const boundary = new ErrorBoundary({});

      boundary.state = ErrorBoundary.getDerivedStateFromError(error);
      expect(() => boundary.componentDidCatch(error, errorInfo)).not.toThrow();

      expect(renderToStaticMarkup(boundary.render())).toContain(
        "Importing a module script failed.",
      );
      expect(reload).not.toHaveBeenCalled();
    },
  );
});
