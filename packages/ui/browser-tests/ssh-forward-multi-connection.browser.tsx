import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SshForwardHostProvider } from "@/contexts/SshForwardHostContext.js";
import { SshForwardingPage } from "@/components/pages/SshForwardingPage.js";
import {
  createSshForwardFixture,
  type SshForwardFixture,
} from "./ssh-forward-browser-fixture.js";
import "@/index.css";

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({
    children,
    title,
    actions,
  }: {
    children: React.ReactNode;
    title?: string;
    actions?: React.ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {actions}
      {children}
    </main>
  ),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

async function render(fixture: SshForwardFixture) {
  await act(async () =>
    root.render(
      <SshForwardHostProvider
        host={fixture.host}
        environment={{ kind: "nativeDesktop" }}
      >
        <SshForwardingPage />
      </SshForwardHostProvider>,
    ),
  );
  await vi.waitFor(
    () => expect(container.textContent).toContain("SSH Forwarding"),
    {
      timeout: 10_000,
    },
  );
}

function buttonNamed(
  name: string,
  scope: ParentNode = container,
): HTMLButtonElement {
  const button = [...scope.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === name,
  );
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

function switchNamed(ruleName: string): HTMLButtonElement {
  const control = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="switch"]'),
  ].find((candidate) =>
    candidate.getAttribute("aria-label")?.endsWith(ruleName),
  );
  expect(control).not.toBeNull();
  return control!;
}

function dialogNamed(title: string): HTMLElement | null {
  return (
    [...container.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
      (dialog) => dialog.querySelector("h2")?.textContent?.includes(title),
    ) ?? null
  );
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SSH forwarding explicit-connect flow in Chromium", () => {
  it("requires trust approval, a new Connect, and credentials before establishment", async () => {
    const fixture = createSshForwardFixture("auth");
    await render(fixture);
    expect(switchNamed("Alpha metrics")).toBeDisabled();

    await click(buttonNamed("Connect"));
    await vi.waitFor(() =>
      expect(dialogNamed("Verify SSH host fingerprint")).not.toBeNull(),
    );
    expect(fixture.calls.connect).toHaveLength(1);

    await click(buttonNamed("Approve exact fingerprint"));
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Approved; press Connect to establish this SSH connection.",
      ),
    );
    expect(fixture.calls.connect).toHaveLength(1);
    await click(buttonNamed("Close"));

    await click(buttonNamed("Connect"));
    await vi.waitFor(() =>
      expect(dialogNamed("Credentials for Alpha")).not.toBeNull(),
    );
    const credentialDialog = dialogNamed("Credentials for Alpha")!;
    const method = credentialDialog.querySelector(
      "select",
    ) as HTMLSelectElement;
    await act(async () => {
      method.value = "password";
      method.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const username = credentialDialog.querySelector(
      'input[autocomplete="username"]',
    ) as HTMLInputElement;
    const password = credentialDialog.querySelector(
      'input[autocomplete="current-password"]',
    ) as HTMLInputElement;
    await act(async () => {
      setInputValue(username, "deploy");
      setInputValue(password, "synthetic-password");
    });
    await click(buttonNamed("Unlock and connect", credentialDialog));

    await vi.waitFor(() =>
      expect(container.textContent).toContain("Established"),
    );
    expect(fixture.calls.connect).toHaveLength(3);
    expect(fixture.calls.approveHost).toBe(1);
    expect(fixture.calls.listKeys).toBe(1);
    expect(fixture.calls.loadPassword).toEqual([
      {
        connectionId: fixture.calls.connect[0]!.connectionId,
        username: "deploy",
        rememberForDays: 30,
      },
    ]);

    await click(switchNamed("Alpha metrics"));
    await vi.waitFor(() =>
      expect(switchNamed("Alpha metrics")).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(fixture.calls.connect).toHaveLength(3);
    expect(fixture.calls.listKeys).toBe(1);

    await click(switchNamed("Alpha metrics"));
    await vi.waitFor(() =>
      expect(switchNamed("Alpha metrics")).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
    await click(buttonNamed("Disconnect"));
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Disconnected"),
    );
    await click(buttonNamed("Connect"));
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Established"),
    );
    expect(fixture.calls.connect).toHaveLength(4);
    expect(fixture.calls.listKeys).toBe(1);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps two established connections independent while toggling multiple ports", async () => {
    const fixture = createSshForwardFixture("multi");
    await render(fixture);
    const cards = [...container.querySelectorAll("article")];
    expect(cards).toHaveLength(2);
    expect(
      cards.every((card) => card.textContent?.includes("Established")),
    ).toBe(true);

    await click(switchNamed("Alpha metrics"));
    await click(switchNamed("Alpha logs"));
    await click(switchNamed("Beta metrics"));
    await vi.waitFor(() =>
      expect(switchNamed("Beta metrics")).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );

    expect(fixture.calls.connect).toHaveLength(0);
    expect(fixture.calls.listKeys).toBe(0);
    expect(fixture.calls.setRuleEnabled).toHaveLength(3);
    expect(fixture.calls.setRuleEnabled[0]!.connectionId).toBe(
      fixture.calls.setRuleEnabled[1]!.connectionId,
    );
    expect(fixture.calls.setRuleEnabled[1]!.ruleId).not.toBe(
      fixture.calls.setRuleEnabled[0]!.ruleId,
    );
    expect(fixture.calls.setRuleEnabled[2]!.connectionId).not.toBe(
      fixture.calls.setRuleEnabled[0]!.connectionId,
    );
    expect(container.textContent).not.toContain("Credentials for");
  });

  it("keeps a disconnected rule disabled without opening credential UI", async () => {
    const fixture = createSshForwardFixture("gated");
    await render(fixture);
    const control = switchNamed("Blocked metrics");
    expect(control).toBeDisabled();
    expect(container.textContent).toContain(
      "Establish the SSH connection before enabling this rule.",
    );
    await click(control);
    expect(fixture.calls.connect).toHaveLength(0);
    expect(fixture.calls.listKeys).toBe(0);
    expect(fixture.calls.setRuleEnabled).toHaveLength(0);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
