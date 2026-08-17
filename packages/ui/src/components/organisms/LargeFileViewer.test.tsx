// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LargeFileViewer } from "./LargeFileViewer.js";

const fsRead = vi.hoisted(() => vi.fn());

vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({ fsRead }),
}));

class TestIntersectionObserver {
  observe() {}
  disconnect() {}
}

function response(content: string) {
  return {
    ok: true as const,
    content: btoa(content),
    binary: false,
    mtime: 1,
    size: content.length,
  };
}

describe("LargeFileViewer", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    fsRead.mockReset();
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("ignores a stale response when the selected file changes", async () => {
    let resolveOld: ((value: ReturnType<typeof response>) => void) | undefined;
    fsRead.mockImplementation((_target: unknown, path: string) => {
      if (path === "old.log") {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve(response("new file\n"));
    });

    await act(async () => {
      root.render(
        createElement(LargeFileViewer, {
          project: "demo",
          path: "old.log",
          fileName: "old.log",
          size: 9,
        }),
      );
    });

    await act(async () => {
      root.render(
        createElement(LargeFileViewer, {
          project: "demo",
          path: "new.log",
          fileName: "new.log",
          size: 9,
        }),
      );
    });

    await act(async () => {
      resolveOld?.(response("old file\n"));
    });

    expect(container.textContent).toContain("new file");
    expect(container.textContent).not.toContain("old file");
  });
});
