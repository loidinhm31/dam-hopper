// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SshForwardRuleDialog } from "./SshForwardRuleDialog.js";
import { SshForwardTargetFields } from "./SshForwardTargetFields.js";
import type {
  SshConnectionProfile,
  SshForwardRule,
} from "@/lib/ssh-forward-host.js";
import { newSshForwardRuleDraft } from "@/lib/ssh-forward-form.js";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const connection: SshConnectionProfile = {
  id: "22222222-2222-4222-8222-222222222222",
  scopeId: "11111111-1111-4111-8111-111111111111",
  name: "Bastion",
  sshHost: "bastion.example",
  sshPort: 22,
  sshUser: "operator",
  auth: { mode: "agent" },
  createdAt: "2026-08-10T12:34:56.789Z" as never,
  updatedAt: "2026-08-10T12:34:56.789Z" as never,
};

const invalidRule: SshForwardRule = {
  id: "44444444-4444-4444-8444-444444444444",
  scopeId: connection.scopeId,
  connectionProfileId: connection.id,
  name: "",
  localPort: 15432,
  targetHost: "127.0.0.1",
  targetPort: 5432,
  desiredEnabled: false,
  reconnect: { enabled: true, maxAttempts: 6 },
  createdAt: "2026-08-10T12:34:56.789Z" as never,
  updatedAt: "2026-08-10T12:34:56.789Z" as never,
};

describe("SshForwardRuleDialog", () => {
  it("keeps the remote target loopback-only and explains deferred listener start", () => {
    const markup = renderToStaticMarkup(
      <SshForwardRuleDialog
        open
        connection={connection}
        existing={null}
        pending={false}
        error={null}
        onClose={() => {}}
        onSubmit={vi.fn()}
      />,
    );
    expect(markup).toContain("127.0.0.1");
    expect(markup).toContain("Connect establishes SSH before");
    expect(markup).toContain("No credential prompt opens from a rule toggle");
    expect(markup).toContain('id="ssh-rule-name"');
    expect(markup).toContain('id="ssh-rule-local-port"');
    expect(markup).toContain('id="ssh-rule-target-port"');
    expect(markup).toContain('id="ssh-rule-reconnect-attempts"');
    expect(markup).toContain('id="ssh-rule-reviewed"');
  });

  it("associates both target-port validation messages with their inputs", () => {
    const markup = renderToStaticMarkup(
      <SshForwardTargetFields
        draft={newSshForwardRuleDraft()}
        errors={{
          localPort: "Local port is invalid.",
          targetPort: "Target port is invalid.",
        }}
        onUpdate={vi.fn()}
      />,
    );

    for (const [fieldId, errorId] of [
      ["ssh-rule-local-port", "ssh-rule-local-port-error"],
      ["ssh-rule-target-port", "ssh-rule-target-port-error"],
    ]) {
      expect(markup).toContain(`id="${fieldId}"`);
      expect(markup).toContain('aria-invalid="true"');
      expect(markup).toContain(`aria-describedby="${errorId}"`);
      expect(markup).toContain(`id="${errorId}"`);
    }
  });

  it("associates rule-name, reconnect, and review errors with their controls", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <SshForwardRuleDialog
          open
          connection={connection}
          existing={invalidRule}
          pending={false}
          error={null}
          onClose={() => {}}
          onSubmit={vi.fn()}
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

    for (const [fieldId, errorId] of [
      ["ssh-rule-name", "ssh-rule-name-error"],
      ["ssh-rule-reconnect-attempts", "ssh-rule-reconnect-attempts-error"],
      ["ssh-rule-reviewed", "ssh-rule-reviewed-error"],
    ]) {
      const field = document.querySelector<HTMLInputElement>(`#${fieldId}`);
      expect(field?.getAttribute("aria-invalid")).toBe("true");
      expect(field?.getAttribute("aria-describedby")).toBe(errorId);
      expect(document.querySelector(`#${errorId}`)).not.toBeNull();
    }
  });
});
