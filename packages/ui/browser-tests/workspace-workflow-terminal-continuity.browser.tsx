import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { api } from "@/api/client.js";
import WorkspacePage from "@/components/pages/WorkspacePage.js";
import { AppZoomProvider } from "@/contexts/AppZoomContext.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { initTransport, resetTransport } from "@/api/transport.js";
import { resetTransportListeners } from "@/hooks/use-sse.js";
import { WsTransport } from "@/api/ws-transport.js";
import { removeTerminal, terminalRegistry } from "@/lib/terminal-registry.js";
import "@/index.css";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SERVER_URL = (
  (import.meta.env.VITE_DAM_HOPPER_SERVER_URL as string | undefined) ??
  "http://127.0.0.1:4802"
).replace(/\/$/, "");

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
let transport: WsTransport;
let terminalId: string | undefined;

let workflowSessionId: string | undefined;

async function waitForBuffer(id: string, text: string) {
  await expect.poll(() => {
    const terminal = terminalRegistry.get(id)?.terminal;
    if (!terminal) return "";
    const lines = [];
    for (let row = 0; row < terminal.buffer.active.length; row += 1) {
      lines.push(terminal.buffer.active.getLine(row)?.translateToString() ?? "");
    }
    return lines.join("\n");
  }, { timeout: 10_000, interval: 100 }).toContain(text);
}

describe("WorkspacePage workflow terminal continuity against the no-auth server", () => {
  beforeEach(async () => {
    await page.viewport(1440, 900);
    localStorage.setItem("dam-hopper:ide-left-bottom", "terminal");
    localStorage.setItem("dam-hopper:workspace-mode", "ide");
    localStorage.setItem("dam-hopper:terminal-usage-mode", "traditional");
    container = document.createElement("div");
    document.body.append(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    transport = new WsTransport(SERVER_URL);
    initTransport(transport);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    if (workflowSessionId) {
      await api.workflow.abandonSession(workflowSessionId, { requestId: crypto.randomUUID() }).catch(() => undefined);
      workflowSessionId = undefined;
    }
    if (terminalId) {
      await api.terminal.kill(terminalId).catch(() => undefined);
      await api.terminal.remove(terminalId).catch(() => undefined);
      removeTerminal(terminalId);
      terminalId = undefined;
    }
    queryClient?.clear();
    resetTransportListeners();
    transport?.destroy();
    resetTransport();
    container?.remove();
    localStorage.removeItem("dam-hopper:ide-left-bottom");
    localStorage.removeItem("dam-hopper:workspace-mode");
    localStorage.removeItem("dam-hopper:terminal-usage-mode");
    document.documentElement.style.removeProperty("--safe-area-bottom");
  });

  it("keeps one real xterm session and workflow identity across shells and compact mode", async () => {
    const projects = await api.projects.list();
    expect(projects.length, "--no-auth server must expose a configured project").toBeGreaterThan(0);
    const marker = `xterm-marker-${crypto.randomUUID().slice(0, 8)}`;
    const postMarker = `after-switch-${crypto.randomUUID().slice(0, 8)}`;
    const target = { project: projects[0].name };
    const sessionId = `terminal:${target.project}:_:browser-${crypto.randomUUID()}`;
    terminalId = sessionId;
    await api.terminal.create({
      id: sessionId,
      project: target.project,
      command: `printf '${marker}\\n'; exec bash`,
      cols: 120,
      rows: 30,
    });
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const endedAt = new Date(Date.now() - 1_000).toISOString();
    const plan = await api.workflow.createItem({
      requestId: crypto.randomUUID(), target, kind: "plan",
      title: `Terminal continuity ${crypto.randomUUID().slice(0, 8)}`, status: "in_progress",
    });
    const workflowSession = await api.workflow.createSession({
      requestId: crypto.randomUUID(), target, itemId: plan.resource.id, startedAt,
    });
    workflowSessionId = workflowSession.resource.id;
    expect(workflowSession.resource.startedAt).toBe(startedAt);

    root = createRoot(container);
    await act(async () => root.render(
      <MemoryRouter initialEntries={[`/workspace?session=${encodeURIComponent(sessionId)}`]}>
        <AppZoomProvider>
          <EncryptProvider>
            <QueryClientProvider client={queryClient}><WorkspacePage /></QueryClientProvider>
          </EncryptProvider>
        </AppZoomProvider>
      </MemoryRouter>,
    ));
    await expect.poll(async () =>
      (await api.terminal.listDetailed()).some(
        (session) => session.id === sessionId && session.alive,
      ),
      { timeout: 10_000, interval: 100 },
    ).toBe(true);
    await expect.element(page.getByTestId("terminal-pane-output-host")).toBeVisible();
    await waitForBuffer(sessionId, marker);
    const xtermEntry = terminalRegistry.get(sessionId);
    expect(xtermEntry).toBeDefined();
    expect(xtermEntry?.terminal).toBeDefined();

    xtermEntry!.terminal.focus();
    await userEvent.keyboard(marker);
    await userEvent.keyboard("{Enter}");
    await waitForBuffer(sessionId, marker);

    await expect.element(page.getByRole("button", { name: "Expand workflow deck" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Expand workflow deck" }));
    const deck = page.getByRole("region", { name: "Workflow Context Deck" });
    await expect.element(deck).toBeVisible();
    await userEvent.click(
      deck.getByRole("button", {
        name: `plan: ${plan.resource.title} (In Progress)`,
        exact: true,
      }),
    );
    expect(document.querySelector(`[data-session-id="${workflowSession.resource.id}"]`)).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Note", exact: true }));
    await userEvent.fill(page.getByPlaceholder("Next action or note..."), "Terminal note preserved");
    await userEvent.click(page.getByRole("button", { name: "Add", exact: true }));
    await expect.element(page.getByText("Note: Terminal note preserved", { exact: true })).toBeVisible();

    await userEvent.fill(page.getByPlaceholder("Terminal session ID"), sessionId);
    await userEvent.click(page.getByRole("button", { name: "Link", exact: true }));
    await userEvent.fill(page.getByPlaceholder("Label (e.g. planner)"), "Chromium harness");
    await userEvent.fill(page.getByPlaceholder("Run ID"), "browser-run");
    await userEvent.click(page.getByRole("button", { name: "Link Harness Run", exact: true }));
    await expect.poll(async () => (await api.workflow.events({ limit: 100 })).events.filter((event) => event.eventType === "resource_linked").length).toBeGreaterThanOrEqual(2);

    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("region", { name: "Workflow Context Deck" })).not.toBeInTheDocument();
    const ribbon = document.querySelector<HTMLElement>('[role="button"][aria-controls="workflow-context-deck"]');
    expect(document.activeElement).toBe(ribbon);
    const sameTerminal = terminalRegistry.get(sessionId)?.terminal;
    expect(sameTerminal).toBe(xtermEntry!.terminal);

    const modeSwitch = page.getByTestId("top-nav-workspace-mode-switch");
    await userEvent.click(modeSwitch.getByRole("button", { name: "Terminal", exact: true }));
    await expect.element(modeSwitch.getByRole("button", { name: "Terminal", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByTestId("terminal-pane-output-host")).toBeVisible();
    await userEvent.click(modeSwitch.getByRole("button", { name: "IDE", exact: true }));
    await expect.element(modeSwitch.getByRole("button", { name: "IDE", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByRole("button", { name: "Expand workflow deck" })).toBeVisible();

    await page.viewport(390, 844);
    document.documentElement.style.setProperty("--safe-area-bottom", "24px");
    const expandDeckButton = page.getByRole("button", { name: "Expand workflow deck" });
    await expect.element(expandDeckButton).toBeVisible();
    await userEvent.click(expandDeckButton);
    const mobileDialog = page.getByRole("dialog");
    await expect.element(mobileDialog).toBeVisible();
    expect(getComputedStyle(mobileDialog.element() as HTMLElement).paddingBottom).toBe("24px");
    expect((mobileDialog.element() as HTMLElement).getBoundingClientRect().height).toBeLessThan(844);
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    const mobileRibbon = document.querySelector<HTMLElement>(
      '[role="button"][aria-controls="workflow-context-deck"]',
    );
    expect(document.activeElement).toBe(mobileRibbon);
    await page.viewport(1440, 900);
    await expect.element(page.getByTestId("terminal-pane-output-host")).toBeVisible();
    const activeTerminalEntry = terminalRegistry.get(sessionId);
    expect(activeTerminalEntry).toBeDefined();
    expect(activeTerminalEntry?.terminal).toBeDefined();
    activeTerminalEntry!.terminal.focus();
    await userEvent.keyboard(postMarker);
    await userEvent.keyboard("{Enter}");
    await waitForBuffer(sessionId, postMarker);
    expect(terminalRegistry.has(sessionId)).toBe(true);
    const ended = await api.workflow.endSession(workflowSession.resource.id, { requestId: crypto.randomUUID(), endedAt });
    expect(ended.resource.startedAt).toBe(startedAt);
    expect(ended.resource.endedAt).toBe(endedAt);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });
});
