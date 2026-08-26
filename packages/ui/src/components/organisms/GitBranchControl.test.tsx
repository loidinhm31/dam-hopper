// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GitBranchControl, GitBranchFeedback } from "./GitBranchControl.js";
import { ApiRequestError } from "@/api/client.js";

const checkoutBranch = vi.fn();
const deleteBranch = vi.fn();
const queryState = vi.hoisted(() => ({
  branches: [] as Array<{
    name: string;
    isCurrent: boolean;
    isRemote: boolean;
  }>,
  projectStatus: undefined as { branch: string } | undefined,
  branchesError: null as Error | null,
}));

const loadedBranches = [
  { name: "main", isCurrent: true, isRemote: false },
  { name: "feature/demo", isCurrent: false, isRemote: false },
];

vi.mock("@/api/queries.js", () => ({
  useBranches: () => ({
    data: queryState.branches,
    error: queryState.branchesError,
  }),
  useProjectStatus: () => ({ data: queryState.projectStatus }),
  useGitCheckoutBranch: () => ({
    isPending: false,
    mutateAsync: checkoutBranch,
  }),
  useGitCreateBranch: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useGitDeleteBranch: () => ({ isPending: false, mutateAsync: deleteBranch }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  Element.prototype.scrollIntoView ??= () => undefined;
  queryState.branches = loadedBranches;
  queryState.projectStatus = { branch: "main" };
  queryState.branchesError = null;
});

async function mountBranchControl() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<GitBranchControl project="demo" />));
}

async function openSelect(branchName = "feature/demo") {
  const trigger = document.querySelector<HTMLButtonElement>("[role=combobox]");
  expect(trigger).not.toBeNull();
  await act(async () => trigger?.click());
  const option = await vi.waitFor(() => {
    const next = [
      ...document.querySelectorAll<HTMLElement>("[role=option]"),
    ].find((element) => element.textContent === branchName);
    expect(next).toBeDefined();
    return next!;
  });
  return { option, trigger: trigger! };
}

async function dispatchEvent(target: Element, event: Event) {
  await act(async () => target.dispatchEvent(event));
  await act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));
}

async function openBranchMenu(branchName = "feature/demo") {
  const selection = await openSelect(branchName);
  await dispatchEvent(
    selection.option,
    new MouseEvent("contextmenu", {
      bubbles: true,
      button: 2,
      cancelable: true,
      clientX: 80,
      clientY: 60,
    }),
  );
  const menu = await vi.waitFor(() => {
    const next = document.querySelector<HTMLElement>("[role=menu]");
    expect(next).not.toBeNull();
    return next!;
  });
  return { ...selection, menu };
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  checkoutBranch.mockReset();
  deleteBranch.mockReset();
});

describe("GitBranchFeedback", () => {
  it("renders feedback by default", () => {
    const markup = renderToStaticMarkup(
      <GitBranchFeedback message="Checked out feature/demo" error={null} />,
    );

    expect(markup).toContain("Checked out feature/demo");
  });

  it("suppresses feedback when disabled", () => {
    const markup = renderToStaticMarkup(
      <GitBranchFeedback
        message="Checked out feature/demo"
        error={null}
        showFeedback={false}
      />,
    );

    expect(markup).toBe("");
  });

  it("remains controlled while branch data loads", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {
      // The assertion below inspects React's warning output.
    });
    queryState.branches = [];
    queryState.projectStatus = undefined;

    try {
      await mountBranchControl();
      expect(document.querySelector("[role=combobox]")?.textContent).toContain(
        "Select branch",
      );

      queryState.branches = loadedBranches;
      queryState.projectStatus = { branch: "main" };
      await act(async () => root?.render(<GitBranchControl project="demo" />));

      expect(document.querySelector("[role=combobox]")?.textContent).toContain(
        "main",
      );
      expect(
        consoleWarn.mock.calls.some(([message]) =>
          typeof message === "string"
            ? message.includes(
                "Select is changing from uncontrolled to controlled",
              )
            : false,
        ),
      ).toBe(false);
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("opens one lifted menu from the right-pointer lifecycle without checkout", async () => {
    await mountBranchControl();
    const { option } = await openSelect();
    const pointerDown = new MouseEvent("pointerdown", {
      bubbles: true,
      button: 2,
      cancelable: true,
      clientX: 80,
      clientY: 60,
    });
    await dispatchEvent(option, pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);

    const pointerUp = new MouseEvent("pointerup", {
      bubbles: true,
      button: 2,
      cancelable: true,
      clientX: 80,
      clientY: 60,
    });
    await dispatchEvent(option, pointerUp);
    await dispatchEvent(
      option,
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        cancelable: true,
        clientX: 80,
        clientY: 60,
      }),
    );

    await vi.waitFor(() =>
      expect(document.querySelectorAll("[role=menu]")).toHaveLength(1),
    );
    expect(document.querySelector("[role=menu]")?.textContent).toContain(
      "feature/demo",
    );
    expect(checkoutBranch).not.toHaveBeenCalled();
  });

  it("uses the local-branch contextmenu fallback without checkout", async () => {
    await mountBranchControl();
    const { menu } = await openBranchMenu();
    expect(menu.textContent).toContain("feature/demo");
    expect(checkoutBranch).not.toHaveBeenCalled();
  });

  it.each([
    ["ContextMenu", false],
    ["F10", true],
  ])("opens a local-branch menu from %s", async (key, shiftKey) => {
    await mountBranchControl();
    const { option } = await openSelect();
    await dispatchEvent(
      option,
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        shiftKey,
      }),
    );

    await vi.waitFor(() =>
      expect(document.querySelectorAll("[role=menu]")).toHaveLength(1),
    );
    expect(checkoutBranch).not.toHaveBeenCalled();
  });

  it("keeps the checked-out branch undeletable and dismisses a branch menu with Escape", async () => {
    await mountBranchControl();
    const { menu, trigger } = await openBranchMenu();
    await dispatchEvent(
      menu,
      new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("[role=menu]")).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);

    await openBranchMenu("main");
    const deleteAction = document.querySelector<HTMLElement>("[role=menuitem]");
    expect(deleteAction?.hasAttribute("data-disabled")).toBe(true);
    expect(deleteAction?.getAttribute("title")).toBe(
      "Cannot delete the checked-out branch",
    );
  });

  it("dismisses on outside press and hands Delete to the existing dialog", async () => {
    await mountBranchControl();
    const { trigger } = await openBranchMenu();
    await dispatchEvent(
      document.body,
      new MouseEvent("pointerdown", { bubbles: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("[role=menu]")).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);

    await openBranchMenu();
    const deleteAction = document.querySelector<HTMLElement>("[role=menuitem]");
    expect(deleteAction).not.toBeNull();
    await dispatchEvent(
      deleteAction,
      new MouseEvent("click", { bubbles: true }),
    );
    expect(document.body.textContent).toContain(
      "Delete the local branch feature/demo?",
    );
    expect(
      document.querySelector("[role=dialog]")?.contains(document.activeElement),
    ).toBe(true);
    expect(deleteBranch).not.toHaveBeenCalled();
  });
});

describe("GitBranchControl unavailable state", () => {
  it("suppresses branch mutations when Git is unavailable", async () => {
    queryState.branches = [];
    queryState.projectStatus = undefined;
    queryState.branchesError = new ApiRequestError(
      "Git is not initialized for this project",
      409,
      "GIT_NOT_INITIALIZED",
    );

    await mountBranchControl();

    expect(document.body.textContent).toContain(
      "Git is not initialized for this project",
    );
    expect(document.body.textContent).not.toContain("New Branch");
    expect(document.querySelector("[role=combobox]")).toBeNull();
  });
});
