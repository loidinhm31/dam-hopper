// @vitest-environment jsdom
import { act } from "react";
import type { RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SshConnectionDialog } from "./SshConnectionDialog.js";
import { SshForwardEndpointFields } from "./SshForwardEndpointFields.js";
import { newSshConnectionDraft } from "@/lib/ssh-forward-form.js";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("SshConnectionDialog", () => {
  it("saves only a reviewed credential-free endpoint", () => {
    const markup = renderToStaticMarkup(
      <SshConnectionDialog
        open
        existing={null}
        sourceProfile={null}
        pending={false}
        error={null}
        onClose={() => {}}
        onSubmit={vi.fn()}
        onListKeys={vi.fn(async () => ({
          context: {} as never,
          scopeId: "11111111-1111-4111-8111-111111111111",
          scopeGeneration: "1" as never,
          keys: [],
        }))}
      />,
    );
    expect(markup).toContain("Save the credential-free endpoint first");
    expect(markup).toContain("I reviewed the SSH endpoint");
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain("Remember for 30 days");
    expect(markup).toContain('id="ssh-connection-name"');
    expect(markup).toContain('id="ssh-connection-host"');
    expect(markup).toContain('id="ssh-connection-port"');
    expect(markup).toContain('id="ssh-connection-user"');
    expect(markup).toContain('id="ssh-connection-reviewed"');
  });

  it("associates every endpoint validation message with its input", () => {
    const markup = renderToStaticMarkup(
      <SshForwardEndpointFields
        draft={newSshConnectionDraft(null)}
        errors={{
          name: "Name is required.",
          sshHost: "Host is invalid.",
          sshPort: "Port is invalid.",
          sshUser: "User is required.",
        }}
        firstInput={{ current: null } as RefObject<HTMLInputElement | null>}
        onUpdate={vi.fn()}
      />,
    );

    for (const [fieldId, errorId] of [
      ["ssh-connection-name", "ssh-connection-name-error"],
      ["ssh-connection-host", "ssh-connection-host-error"],
      ["ssh-connection-port", "ssh-connection-port-error"],
      ["ssh-connection-user", "ssh-connection-user-error"],
    ]) {
      expect(markup).toContain(`id="${fieldId}"`);
      expect(markup).toContain('aria-invalid="true"');
      expect(markup).toContain(`aria-describedby="${errorId}"`);
      expect(markup).toContain(`id="${errorId}"`);
    }
  });

  it("associates the required endpoint review error with its checkbox", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SshConnectionDialog
          open
          existing={null}
          sourceProfile={null}
          pending={false}
          error={null}
          onClose={() => {}}
          onSubmit={vi.fn()}
          onListKeys={vi.fn(async () => ({
            context: {} as never,
            scopeId: "11111111-1111-4111-8111-111111111111",
            scopeGeneration: "1" as never,
            keys: [],
          }))}
        />,
      );
    });
    await act(async () => {
      document
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    const checkbox = document.querySelector<HTMLInputElement>(
      "#ssh-connection-reviewed",
    );
    expect(checkbox?.getAttribute("aria-invalid")).toBe("true");
    expect(checkbox?.getAttribute("aria-describedby")).toBe(
      "ssh-connection-reviewed-error",
    );
    expect(
      document.querySelector("#ssh-connection-reviewed-error")?.textContent,
    ).toContain("Review the SSH endpoint");
  });
});
