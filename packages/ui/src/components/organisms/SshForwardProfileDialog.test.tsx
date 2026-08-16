// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SshForwardProfileDialog } from "./SshForwardProfileDialog.js";
import type { SshForwardProfile } from "@/lib/ssh-forward-host.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const profile: SshForwardProfile = {
  id: "22222222-2222-4222-8222-222222222222",
  scopeId: "11111111-1111-4111-8111-111111111111",
  name: "metrics",
  sshHost: "bastion.example",
  sshPort: 22,
  sshUser: "operator",
  auth: { mode: "agent" },
  localPort: 15432,
  targetHost: "127.0.0.1",
  targetPort: 5432,
  autoStart: false,
  reconnect: { enabled: true, maxAttempts: 5 },
  createdAt: "2026-08-10T12:34:56.789Z" as SshForwardProfile["createdAt"],
  updatedAt: "2026-08-10T12:34:56.789Z" as SshForwardProfile["updatedAt"],
};

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("SshForwardProfileDialog", () => {
  it("renders reviewed explicit fields without secret or path controls", () => {
    const markup = renderToStaticMarkup(
      <SshForwardProfileDialog
        open
        scopeId="11111111-1111-4111-8111-111111111111"
        existing={null}
        sourceProfile={{
          id: "11111111-1111-4111-8111-111111111111",
          name: "Bastion",
          url: "https://bastion.example:4800",
          authType: "none",
          createdAt: 1,
        }}
        pending={false}
        error={null}
        onClose={() => {}}
        onSubmit={vi.fn()}
        onListKeys={vi.fn()}
      />,
    );
    expect(markup).toContain("I reviewed the SSH endpoint");
    expect(markup).toContain("127.0.0.1 (fixed)");
    expect(markup).toContain("OS SSH agent (recommended)");
    expect(markup).not.toContain("keychain");
    expect(markup).not.toContain('type="password"');
  });

  it("submits a valid profile only once while the mutation is pending", async () => {
    const onSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <SshForwardProfileDialog
          open
          scopeId={profile.scopeId}
          existing={profile}
          sourceProfile={null}
          pending={false}
          error={null}
          onClose={() => {}}
          onSubmit={onSubmit}
          onListKeys={vi.fn()}
        />,
      ),
    );
    await act(async () => {
      document
        .querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.click();
    });
    await act(async () => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.includes("Save forward"),
      );
      button?.click();
      button?.click();
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
