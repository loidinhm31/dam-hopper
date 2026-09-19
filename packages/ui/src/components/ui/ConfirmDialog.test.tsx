// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog, AlertDialog } from "./ConfirmDialog.js";

describe("ConfirmDialog", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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

  it("does not render content when open is false", () => {
    act(() => {
      root?.render(
        <ConfirmDialog
          open={false}
          onConfirm={() => {}}
          title="Test Title"
          description="Test Description"
        />,
      );
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders title, description, and triggers onConfirm when confirm clicked", async () => {
    const handleConfirm = vi.fn();
    const handleClose = vi.fn();

    await act(async () => {
      root?.render(
        <ConfirmDialog
          open={true}
          onConfirm={handleConfirm}
          onClose={handleClose}
          title="Delete Item"
          description="Are you sure you want to delete this?"
          confirmText="Delete"
          cancelText="Cancel"
          variant="danger"
        />,
      );
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Delete Item");
    expect(dialog?.textContent).toContain(
      "Are you sure you want to delete this?",
    );

    const confirmButton = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((btn) => btn.textContent?.includes("Delete"));
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.click();
    });

    expect(handleConfirm).toHaveBeenCalledOnce();
    expect(handleClose).not.toHaveBeenCalled();
  });

  it("triggers onClose when cancel button is clicked", async () => {
    const handleConfirm = vi.fn();
    const handleClose = vi.fn();

    await act(async () => {
      root?.render(
        <ConfirmDialog
          open={true}
          onConfirm={handleConfirm}
          onClose={handleClose}
          title="Confirm Action"
          cancelText="Dismiss"
        />,
      );
    });

    const cancelButton = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((btn) => btn.textContent?.includes("Dismiss"));
    expect(cancelButton).toBeTruthy();

    await act(async () => {
      cancelButton?.click();
    });

    expect(handleClose).toHaveBeenCalledOnce();
    expect(handleConfirm).not.toHaveBeenCalled();
  });

  it("disables buttons when loading is true", async () => {
    await act(async () => {
      root?.render(
        <ConfirmDialog
          open={true}
          onConfirm={() => {}}
          onClose={() => {}}
          title="Loading Test"
          loading={true}
          confirmText="Submitting"
          cancelText="Abort"
        />,
      );
    });

    const buttons = document.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"] button',
    );
    for (const btn of buttons) {
      // Exclude close button from primitive if present
      if (
        btn.textContent?.includes("Submitting") ||
        btn.textContent?.includes("Abort")
      ) {
        expect(btn.disabled).toBe(true);
      }
    }
  });
});

describe("AlertDialog", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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

  it("renders title, description and calls onClose on button click", async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root?.render(
        <AlertDialog
          open={true}
          onClose={handleClose}
          title="Alert Warning"
          description="Something went wrong."
          closeText="Acknowledge"
        />,
      );
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Alert Warning");
    expect(dialog?.textContent).toContain("Something went wrong.");

    const closeButton = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((btn) => btn.textContent?.includes("Acknowledge"));
    expect(closeButton).toBeTruthy();

    await act(async () => {
      closeButton?.click();
    });

    expect(handleClose).toHaveBeenCalledOnce();
  });
});
