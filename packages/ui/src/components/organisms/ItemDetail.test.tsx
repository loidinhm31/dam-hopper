// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemDetail } from "./ItemDetail.js";
import type { AgentStoreItem } from "@/api/client.js";

const mockRemoveMutate = vi.fn();
vi.mock("@/api/queries.js", () => ({
  useAgentStoreContent: vi.fn(() => ({
    data: "test content",
    isLoading: false,
  })),
  useRemoveFromStore: vi.fn(() => ({
    mutate: mockRemoveMutate,
    isPending: false,
  })),
}));

describe("ItemDetail", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  const mockItem: AgentStoreItem = {
    name: "test-item",
    category: "skills",
    description: "A test item",
    compatibleAgents: ["claude"],
    sizeBytes: 1024,
  };

  beforeEach(() => {
    mockRemoveMutate.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it("opens ConfirmDialog on Remove button click and triggers remove mutation on confirm", async () => {
    await act(async () => {
      root?.render(<ItemDetail item={mockItem} onShip={() => {}} />);
    });

    const removeBtn = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((btn) => btn.textContent?.includes("Remove"));
    expect(removeBtn).toBeTruthy();

    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      removeBtn?.click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Remove "test-item" from store?');

    const confirmBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((btn) => btn.textContent?.includes("Remove"));
    expect(confirmBtn).toBeTruthy();

    await act(async () => {
      confirmBtn?.click();
    });

    expect(mockRemoveMutate).toHaveBeenCalledWith(
      { name: "test-item", category: "skills" },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it("cancels removal when cancel button in ConfirmDialog is clicked", async () => {
    await act(async () => {
      root?.render(<ItemDetail item={mockItem} onShip={() => {}} />);
    });

    const removeBtn = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((btn) => btn.textContent?.includes("Remove"));
    await act(async () => {
      removeBtn?.click();
    });

    const cancelBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((btn) => btn.textContent?.includes("Cancel"));
    expect(cancelBtn).toBeTruthy();

    await act(async () => {
      cancelBtn?.click();
    });

    expect(mockRemoveMutate).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
