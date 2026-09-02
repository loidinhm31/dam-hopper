import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { api } from "@/api/client.js";
import { initTransport, resetTransport } from "@/api/transport.js";
import { WsTransport } from "@/api/ws-transport.js";
import { AppZoomProvider } from "@/contexts/AppZoomContext.js";
import { WorkflowContextSurface } from "@/components/organisms/WorkflowContextSurface.js";
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
let workflowSessionId: string | undefined;

async function mount(target: { project: string }) {
  await act(async () => {
    root.render(
      <AppZoomProvider>
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface target={target} />
        </QueryClientProvider>
      </AppZoomProvider>,
    );
  });
  await expect
    .element(page.getByRole("region", { name: "Workflow Context Bar" }))
    .toBeVisible();
}

async function serverTarget() {
  const projects = await api.projects.list();
  expect(projects.length, "--no-auth server must expose a configured project").toBeGreaterThan(0);
  return { project: projects[0].name };
}

describe("workflow context surface against the no-auth server", () => {
  beforeEach(async () => {
    await page.viewport(1440, 900);
    for (const edge of ["--safe-area-top", "--safe-area-right", "--safe-area-bottom", "--safe-area-left"]) {
      document.documentElement.style.removeProperty(edge);
    }
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
    queryClient?.clear();
    transport?.destroy();
    resetTransport();
    container?.remove();
    for (const edge of ["--safe-area-top", "--safe-area-right", "--safe-area-bottom", "--safe-area-left"]) {
      document.documentElement.style.removeProperty(edge);
    }
  });

  it("creates a Plan, records note/session history, and reports factual progress", async () => {
    root = createRoot(container);
    const target = await serverTarget();
    await mount(target);

    await userEvent.click(page.getByRole("button", { name: "Expand workflow deck" }));
    await expect.element(page.getByRole("region", { name: "Workflow Context Deck" })).toBeVisible();
    const deck = page.getByRole("region", { name: "Workflow Context Deck" }).element() as HTMLElement;
    expect(deck.getBoundingClientRect().height).toBeGreaterThanOrEqual(320);
    expect(deck.getBoundingClientRect().height).toBeLessThanOrEqual(440);

    const planTitle = `Browser Plan ${crypto.randomUUID().slice(0, 8)}`;
    await userEvent.click(page.getByRole("button", { name: "New Plan" }));
    await userEvent.fill(page.getByLabelText("Title *"), planTitle);
    await userEvent.click(page.getByRole("button", { name: "Create", exact: true }));
    await expect.element(page.getByText(planTitle, { exact: true }).first()).toBeVisible();

    const plan = (await api.workflow.overview()).plans.find((node) => node.item.title === planTitle)?.item;
    expect(plan).toBeDefined();
    const phase = await api.workflow.createItem({
      requestId: crypto.randomUUID(), target, parentId: plan!.id, kind: "phase",
      title: `${planTitle} Phase`, status: "in_progress",
    });
    const task = await api.workflow.createItem({
      requestId: crypto.randomUUID(), target, parentId: phase.resource.id, kind: "task",
      title: `${planTitle} Task`, status: "done",
    });
    await api.workflow.createItem({
      requestId: crypto.randomUUID(), target, kind: "task",
      title: `${planTitle} Standalone`, status: "next",
    });
    await queryClient.invalidateQueries({ queryKey: ["workflow"] });
    await expect.element(page.getByText(`${planTitle} Task`, { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\b0%\b|\bwarning\b/i);
    expect(document.body.textContent).toContain("1/1 tracked tasks done");

    await userEvent.click(page.getByText(planTitle, { exact: true }).last());
    await userEvent.click(page.getByRole("button", { name: "Note", exact: true }));
    await userEvent.fill(page.getByPlaceholder("Next action or note..."), "Review preserved history");
    await userEvent.click(page.getByRole("button", { name: "Add", exact: true }));
    await expect.element(page.getByText("Note: Review preserved history", { exact: true })).toBeVisible();

    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const endedAt = new Date(Date.now() - 1_000).toISOString();
    const session = await api.workflow.createSession({ requestId: crypto.randomUUID(), target, itemId: plan!.id, startedAt });
    workflowSessionId = session.resource.id;
    expect(session.resource.startedAt).toBe(startedAt);
    const ended = await api.workflow.endSession(session.resource.id, { requestId: crypto.randomUUID(), endedAt });
    expect(ended.resource.startedAt).toBe(startedAt);
    expect(ended.resource.endedAt).toBe(endedAt);
    await queryClient.invalidateQueries({ queryKey: ["workflow"] });
    const events = await api.workflow.events({ limit: 100 });
    expect(events.events.some((event) => event.eventType === "session_ended" && event.sessionId === session.resource.id)).toBe(true);
    expect(events.events.some((event) => event.eventType === "note_added" && event.itemId === plan!.id)).toBe(true);
    await expect.poll(async () =>
      (await api.workflow.overview()).runningSessions.some((entry) => entry.id === session.resource.id),
    ).toBe(false);
    expect(task.resource.status).toBe("done");
  });

  it("keeps desktop, narrow, and mobile surfaces bounded and keyboard reachable", async () => {
    root = createRoot(container);
    const target = await serverTarget();
    await mount(target);
    const ribbon = document.querySelector<HTMLElement>('[role="button"][aria-controls="workflow-context-deck"]');
    expect(ribbon).not.toBeNull();
    ribbon!.focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("region", { name: "Workflow Context Deck" })).toBeVisible();

    await page.viewport(1440, 900);
    const deck = page.getByRole("region", { name: "Workflow Context Deck" }).element() as HTMLElement;
    expect(deck.getBoundingClientRect().height).toBeGreaterThanOrEqual(320);
    expect(deck.getBoundingClientRect().height).toBeLessThanOrEqual(440);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    await page.viewport(900, 700);
    const narrowSheet = page.getByRole("dialog");
    await expect.element(narrowSheet).toBeVisible();
    const narrowSheetElement = narrowSheet.element() as HTMLElement;
    expect(narrowSheetElement.getBoundingClientRect().height).toBeGreaterThan(700 * 0.3);
    expect(narrowSheetElement.getBoundingClientRect().height).toBeLessThan(700 * 0.4);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    for (const label of ["Projects", "Plans", "Execution"]) {
      const button = narrowSheet.getByRole("button", { name: label, exact: true }).element() as HTMLElement;
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }

    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(ribbon);

    await page.viewport(390, 844);
    document.documentElement.style.setProperty("--safe-area-bottom", "24px");
    document.documentElement.style.setProperty("--safe-area-left", "12px");
    document.documentElement.style.setProperty("--safe-area-right", "12px");
    await userEvent.click(page.getByRole("button", { name: "Expand workflow deck" }));
    const sheet = page.getByRole("dialog");
    await expect.element(sheet).toBeVisible();
    expect(getComputedStyle(sheet.element() as HTMLElement).paddingBottom).toBe("24px");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      expect(getComputedStyle(sheet.element() as HTMLElement).transitionDuration).toBe("0s");
    }
    const collapsed = (sheet.element() as HTMLElement).getBoundingClientRect().height;
    expect(collapsed).toBeGreaterThan(844 * 0.3);
    expect(collapsed).toBeLessThan(844 * 0.4);
    for (const label of ["Projects", "Plans", "Execution"]) {
      const button = sheet.getByRole("button", { name: label, exact: true }).element() as HTMLElement;
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await userEvent.click(sheet.getByRole("button", { name: "Expand sheet to 90%" }));
    await expect.poll(
      () => (sheet.element() as HTMLElement).getBoundingClientRect().height,
      { timeout: 1_000, interval: 50 },
    ).toBeGreaterThan(844 * 0.8);
    const expanded = (sheet.element() as HTMLElement).getBoundingClientRect().height;
    expect(expanded).toBeLessThanOrEqual(844 * 0.92);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("shows a workflow-only unavailable state for a missing feature", async () => {
    transport.destroy();
    transport = new WsTransport(`${SERVER_URL}/api`);
    initTransport(transport);
    root = createRoot(container);
    await act(async () => root.render(
      <AppZoomProvider>
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface target={{ project: "unavailable-profile" }} />
        </QueryClientProvider>
      </AppZoomProvider>,
    ));
    const unavailable = page.getByRole("status", {
      name: "Workflow unavailable for this profile",
      exact: true,
    });
    await expect.element(unavailable).toBeVisible();
    await expect.element(page.getByText(
      "Workflow tracking is unavailable for this profile.",
      { exact: true },
    )).toBeVisible();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await expect.element(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).not.toBeInTheDocument();
  });
});
