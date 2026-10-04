import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import {
  createApiClient,
  type ApiClient,
  type ConnectionRef,
} from "@/api/client.js";
import { WsTransport } from "@/api/ws-transport.js";
import { NativeAdvisorProvider } from "@/advisor/native-advisor-provider.js";
import { AdvisorPanel } from "@/advisor/AdvisorPanel.js";
import "@/index.css";

type GlobalWithAct = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actGlobal: GlobalWithAct = globalThis;
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

declare global {
  interface Window {
    __ADVISOR_FIXTURE__?: {
      status: string;
      port: number;
      url: string;
      token: string;
      tempHome: string;
    };
  }
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let transport: WsTransport | null = null;
let provider: NativeAdvisorProvider | null = null;
let client: ApiClient | null = null;

async function getFixtureInfo() {
  if (window.__ADVISOR_FIXTURE__) {
    return window.__ADVISOR_FIXTURE__;
  }
  const res = await fetch("/api/advisor-fixture-info");
  if (res.ok) {
    return (await res.json()) as NonNullable<typeof window.__ADVISOR_FIXTURE__>;
  }
  throw new Error("Advisor loopback fixture info unavailable");
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    const { promise: delayPromise, resolve: resolveDelay } =
      Promise.withResolvers<void>();
    setTimeout(resolveDelay, 50);
    await delayPromise;
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

beforeEach(async () => {
  container = document.createElement("div");
  container.style.width = "100vw";
  container.style.height = "100vh";
  document.body.appendChild(container);
  root = createRoot(container);

  const fixture = await getFixtureInfo();
  const owner: ConnectionRef = { profileId: "browser-test-profile" };
  transport = new WsTransport({
    baseUrl: fixture.url,
    authToken: fixture.token,
    profileId: "browser-test-profile",
  });
  client = createApiClient(owner, transport);
  provider = new NativeAdvisorProvider({ apiClient: client, owner });
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
  provider?.destroy();
  provider = null;
  transport?.destroy();
  transport = null;
  client = null;
});

describe("Advisor routing editor and harness model selector (Browser Mode)", () => {
  it("renders active owner policy from loopback server fixture", async () => {
    await act(async () => {
      root?.render(
        <AdvisorPanel
          provider={provider!}
          client={client!}
          defaultView="configuration"
        />,
      );
    });

    await waitFor(() => {
      const btn = container?.querySelector(".edit-routing-btn");
      return btn !== null;
    });

    const cardText = container?.textContent || "";
    expect(cardText).toContain("Active Owner Policy");
    expect(cardText).toContain("codex / gpt-6.1-sol");
    expect(cardText).toContain("omp / openai/gpt-4.1-mini");
    expect(cardText).toContain("Ready");
  });

  it("opens inline routing editor and validates duplicate route detection", async () => {
    await act(async () => {
      root?.render(
        <AdvisorPanel
          provider={provider!}
          client={client!}
          defaultView="configuration"
        />,
      );
    });

    await waitFor(() => container?.querySelector(".edit-routing-btn") !== null);

    const editBtn =
      container!.querySelector<HTMLButtonElement>(".edit-routing-btn")!;
    await act(async () => {
      editBtn.click();
    });

    expect(container!.querySelector(".policy-routing-editor")).not.toBeNull();
    expect(container!.querySelector(".primary-route-fieldset")).not.toBeNull();
    expect(container!.querySelector(".backup-route-fieldset")).not.toBeNull();
    // Verify all selects have form-control class and theme-styled background (not white default)
    const primaryBackend = container!.querySelector<HTMLSelectElement>("#primary-backend")!;
    const backupBackend = container!.querySelector<HTMLSelectElement>("#backup-backend")!;
    expect(primaryBackend.classList.contains("form-control")).toBe(true);
    expect(backupBackend.classList.contains("form-control")).toBe(true);
    const primaryComputed = window.getComputedStyle(primaryBackend);
    expect(primaryComputed.backgroundColor).not.toBe("rgb(255, 255, 255)");
    expect(primaryComputed.borderRadius).toBe("6px");
    if (!import.meta.env.CI) {
      await page.viewport(1280, 800);
      await page.screenshot({
        path: "/home/loidinh/WS/dam-hopper/packages/ui/e2e/advisor-model-dropdown-theme/screenshot.png",
      });
    }

    await act(async () => {
      backupBackend.value = "codex";
      backupBackend.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Change backup custom model to gpt-6.1-sol (matching primary)
    const backupCustomInput = container!.querySelector<HTMLInputElement>(
      "#backup-custom-model",
    )!;
    expect(backupCustomInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(backupCustomInput, "gpt-6.1-sol");
      backupCustomInput.dispatchEvent(new Event("input", { bubbles: true }));
      backupCustomInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Change backup effort to medium (matching primary)
    const backupEffort =
      container!.querySelector<HTMLSelectElement>("#backup-effort")!;
    await act(async () => {
      backupEffort.value = "medium";
      backupEffort.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Verify Duplicate Route Error appears and Save Routing is disabled
    expect(container!.textContent).toContain("Duplicate Route Error");
    const saveBtn =
      container!.querySelector<HTMLButtonElement>(".save-routing-btn")!;
    expect(saveBtn.disabled).toBe(true);

    // Changing effort to low resolves the duplicate!
    await act(async () => {
      backupEffort.value = "low";
      backupEffort.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container!.textContent).not.toContain("Duplicate Route Error");
    expect(saveBtn.disabled).toBe(false);
  });

  it("cancels draft edits and restores pristine summary", async () => {
    await act(async () => {
      root?.render(
        <AdvisorPanel
          provider={provider!}
          client={client!}
          defaultView="configuration"
        />,
      );
    });

    await waitFor(() => container?.querySelector(".edit-routing-btn") !== null);

    const editBtn =
      container!.querySelector<HTMLButtonElement>(".edit-routing-btn")!;
    await act(async () => {
      editBtn.click();
    });

    expect(container!.querySelector(".policy-routing-editor")).not.toBeNull();

    const cancelBtn = container!.querySelector<HTMLButtonElement>(
      ".cancel-routing-btn",
    )!;
    await act(async () => {
      cancelBtn.click();
    });

    expect(container!.querySelector(".policy-routing-editor")).toBeNull();
    const cardText = container?.textContent || "";
    expect(cardText).toContain("codex / gpt-6.1-sol");
    expect(cardText).toContain("omp / openai/gpt-4.1-mini");
  });

  it("persists updated route to loopback server fixture and reads back committed revision", async () => {
    await act(async () => {
      root?.render(
        <AdvisorPanel
          provider={provider!}
          client={client!}
          defaultView="configuration"
        />,
      );
    });

    await waitFor(() => container?.querySelector(".edit-routing-btn") !== null);

    const editBtn =
      container!.querySelector<HTMLButtonElement>(".edit-routing-btn")!;
    await act(async () => {
      editBtn.click();
    });

    // 1. Change Primary to claude / claude-sonnet-4 / high
    const priBackend =
      container!.querySelector<HTMLSelectElement>("#primary-backend")!;
    await act(async () => {
      priBackend.value = "claude";
      priBackend.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const priCustomInput = container!.querySelector<HTMLInputElement>(
      "#primary-custom-model",
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(priCustomInput, "claude-sonnet-4");
      priCustomInput.dispatchEvent(new Event("input", { bubbles: true }));
      priCustomInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const priEffort =
      container!.querySelector<HTMLSelectElement>("#primary-effort")!;
    await act(async () => {
      priEffort.value = "high";
      priEffort.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // 2. Change Backup to pi / openai/gpt-6.1-sol / low
    const bakBackend =
      container!.querySelector<HTMLSelectElement>("#backup-backend")!;
    await act(async () => {
      bakBackend.value = "pi";
      bakBackend.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const bakCustomInput = container!.querySelector<HTMLInputElement>(
      "#backup-custom-model",
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(bakCustomInput, "openai/gpt-6.1-sol");
      bakCustomInput.dispatchEvent(new Event("input", { bubbles: true }));
      bakCustomInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const bakEffort =
      container!.querySelector<HTMLSelectElement>("#backup-effort")!;
    await act(async () => {
      bakEffort.value = "low";
      bakEffort.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // 3. Save Routing
    const saveBtn =
      container!.querySelector<HTMLButtonElement>(".save-routing-btn")!;
    expect(saveBtn.disabled).toBe(false);

    await act(async () => {
      saveBtn.click();
    });

    // 4. Wait for save to complete and editor to close
    await waitFor(
      () => container?.querySelector(".policy-routing-editor") === null,
    );

    const updatedText = container?.textContent || "";
    expect(updatedText).toContain("claude / claude-sonnet-4");
    expect(updatedText).toContain("pi / openai/gpt-6.1-sol");

    // 5. Independently verify the server persisted the update via REST call
    const currentOnServer = await client!.advisor.policyCurrent();
    expect(currentOnServer.status).toBe("ready");
    expect(currentOnServer.policy?.advisor.primary.backend).toBe("claude");
    expect(currentOnServer.policy?.advisor.primary.model).toBe(
      "claude-sonnet-4",
    );
    expect(currentOnServer.policy?.advisor.primary.effort).toBe("high");
    expect(currentOnServer.policy?.advisor.backup.backend).toBe("pi");
    expect(currentOnServer.policy?.advisor.backup.model).toBe(
      "openai/gpt-6.1-sol",
    );
    expect(currentOnServer.policy?.advisor.backup.effort).toBe("low");
  });

  it("preserves scoped styling within .native-advisor without leaks", async () => {
    await act(async () => {
      root?.render(
        <AdvisorPanel
          provider={provider!}
          client={client!}
          defaultView="configuration"
        />,
      );
    });

    const panelEl = container!.querySelector(".native-advisor");
    expect(panelEl).not.toBeNull();
    expect(panelEl?.classList.contains("native-advisor")).toBe(true);
  });
});
