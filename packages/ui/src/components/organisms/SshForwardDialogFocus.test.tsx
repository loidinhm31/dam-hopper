// @vitest-environment jsdom
import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SshConnectionDialog } from "./SshConnectionDialog.js";
import { SshHostKeyApprovalDialog } from "./SshHostKeyApprovalDialog.js";
import { useDialogFocusTrap } from "@/hooks/use-dialog-focus-trap.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const connection = {
  id: "22222222-2222-4222-8222-222222222222",
  scopeId: "11111111-1111-4111-8111-111111111111",
  name: "metrics",
  sshHost: "bastion.example",
  sshPort: 22,
  sshUser: "operator",
  auth: { mode: "agent" as const },
  createdAt: "2026-08-10T12:34:56.789Z" as never,
  updatedAt: "2026-08-10T12:34:56.789Z" as never,
};
const challenge = {
  challengeId: "33333333-3333-4333-8333-333333333333",
  connectionProfileId: connection.id,
  profileId: connection.id,
  scopeId: connection.scopeId,
  generation: "1" as never,
  sshHost: connection.sshHost,
  sshPort: connection.sshPort,
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO",
  expiresAt: "2026-08-10T12:35:56.789Z" as never,
};
let root: Root | null = null;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

async function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

function FocusTrapProbe({ pending }: { pending: boolean }) {
  const initial = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocusTrap(true, pending, () => {}, initial);
  return (
    <div ref={dialogRef} role="dialog">
      <button ref={initial}>First</button>
      <button>Last</button>
    </div>
  );
}

describe("SSH forwarding dialog focus behavior", () => {
  it("keeps focus inside when pending or callbacks rerender the trap", async () => {
    const prior = document.createElement("button");
    document.body.append(prior);
    prior.focus();
    await render(<FocusTrapProbe pending={false} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const last = container.querySelectorAll("button")[1]!;
    last.focus();
    await act(async () => root?.render(<FocusTrapProbe pending />));
    expect(document.activeElement).toBe(last);
    act(() => root?.unmount());
    expect(document.activeElement).toBe(prior);
    prior.remove();
    root = null;
  });
  it("restores focus and traps Tab in the connection dialog", async () => {
    const prior = document.createElement("button");
    document.body.append(prior);
    prior.focus();
    await render(
      <SshConnectionDialog
        open
        existing={null}
        sourceProfile={null}
        pending={false}
        error={null}
        onClose={() => {}}
        onSubmit={() => {}}
        onListKeys={async () => ({
          context: {} as never,
          scopeId: connection.scopeId,
          scopeGeneration: "1" as never,
          keys: [],
        })}
      />,
    );
    const dialog = container.querySelector('[role="dialog"]')!;
    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled])",
      ),
    ];
    focusable.at(-1)!.focus();
    focusable
      .at(-1)!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    expect(document.activeElement).toBe(focusable[0]);
    act(() => root?.unmount());
    expect(document.activeElement).toBe(prior);
    prior.remove();
    root = null;
  });

  it("restores focus and traps Tab in the host trust dialog", async () => {
    const prior = document.createElement("button");
    document.body.append(prior);
    prior.focus();
    await render(
      <SshHostKeyApprovalDialog
        open
        connection={connection}
        challenge={challenge}
        pending={false}
        onApprove={() => {}}
        onClose={() => {}}
      />,
    );
    const dialog = container.querySelector('[role="dialog"]')!;
    const buttons = [
      ...dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
    ];
    buttons.at(-1)!.focus();
    buttons
      .at(-1)!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    expect(document.activeElement).toBe(buttons[0]);
    act(() => root?.unmount());
    expect(document.activeElement).toBe(prior);
    prior.remove();
    root = null;
  });

  it("focuses the close control when trust cannot be approved", async () => {
    vi.useFakeTimers();
    try {
      await render(
        <SshHostKeyApprovalDialog
          open
          connection={connection}
          errorCode="HOST_KEY_CHANGED"
          pending={false}
          onApprove={() => {}}
          onClose={() => {}}
        />,
      );
      act(() => vi.runAllTimers());
      expect(document.activeElement).toBe(
        container.querySelector<HTMLButtonElement>(
          '[aria-label="Close host trust dialog"]',
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
