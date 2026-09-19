// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffResult } from "@/api/client.js";

const queryState: { data?: GitDiffResult; isLoading: boolean } = {
  isLoading: false,
};
const mockPolicy = vi.hoisted(() => ({ enabled: false }));

const mutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
};

vi.mock("@/api/queries.js", () => ({
  useGitDiff: () => ({ ...queryState, refetch: vi.fn() }),
  useGitStage: () => mutation,
  useGitUnstage: () => mutation,
  useGitDiscard: () => mutation,
  useGitCommit: () => mutation,
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

import { GitLocalChanges } from "./GitLocalChanges.js";

beforeEach(() => {
  queryState.data = undefined;
  queryState.isLoading = false;
  mockPolicy.enabled = false;
});

describe("GitLocalChanges", () => {
  it("renders unavailable Git without mutation controls", () => {
    queryState.data = {
      gitAvailable: false,
      code: "GIT_NOT_INITIALIZED",
      entries: [],
      untrackedTruncated: false,
      untrackedTotal: 0,
    };

    const markup = renderToStaticMarkup(<GitLocalChanges project="demo" />);

    expect(markup).toContain("Git is not initialized for this project");
    expect(markup).not.toContain("No local changes");
    expect(markup).not.toContain("Commit message");
  });

  it("preserves the empty initialized repository state", () => {
    queryState.data = {
      gitAvailable: true,
      entries: [],
      untrackedTruncated: false,
      untrackedTotal: 0,
    };

    const markup = renderToStaticMarkup(<GitLocalChanges project="demo" />);

    expect(markup).toContain("No local changes");
    expect(markup).toContain("Commit message");
  });

  it("blocks commit text entry on Android Chrome", () => {
    mockPolicy.enabled = true;
    queryState.data = {
      gitAvailable: true,
      entries: [
        {
          path: "README.md",
          status: "modified",
          staged: true,
          additions: 1,
          deletions: 0,
        },
      ],
      untrackedTruncated: false,
      untrackedTotal: 0,
    };

    const markup = renderToStaticMarkup(<GitLocalChanges project="demo" />);

    expect(markup).toContain('placeholder="Commit message..." disabled=""');
    expect(markup).toContain(
      'title="Unavailable on Android Chrome: text entry is disabled"',
    );
    expect(markup).toContain("Unstage All");
  });
  it("opens ConfirmDialog when discarding a file and triggers discard on confirm", async () => {
    queryState.data = {
      gitAvailable: true,
      entries: [
        {
          path: "src/foo.ts",
          status: "modified",
          staged: false,
          additions: 1,
          deletions: 0,
        },
      ],
      untrackedTruncated: false,
      untrackedTotal: 0,
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<GitLocalChanges project="demo" />);
    });

    const discardBtn = container.querySelector<HTMLButtonElement>(
      'button[title="Discard"]',
    );
    expect(discardBtn).toBeTruthy();

    await act(async () => {
      discardBtn?.click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Discard changes in src/foo.ts?");

    const confirmBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((btn) => btn.textContent?.includes("Discard"));
    expect(confirmBtn).toBeTruthy();

    await act(async () => {
      confirmBtn?.click();
    });

    expect(mutation.mutate).toHaveBeenCalledWith("src/foo.ts");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
