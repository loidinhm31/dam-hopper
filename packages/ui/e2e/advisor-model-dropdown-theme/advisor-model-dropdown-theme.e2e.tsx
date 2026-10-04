import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteFieldset } from "@/advisor/components/RouteFieldset.js";
import type { RouteDraft } from "@/advisor/policy-routing-validation.js";
import type { AdvisorModelsResultDto } from "@/advisor/advisor-types.js";
import "@/index.css";
import "@/advisor/advisor.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("E2E: Advisor Configuration Edit Model Dropdown Theme Styling", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "100vw";
    container.style.height = "100vh";
    container.style.backgroundColor = "#0D1117";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  it("renders backend, model, and effort select dropdowns with dark theme styling", async () => {
    const route: RouteDraft = {
      backend: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
    };

    const catalog: AdvisorModelsResultDto = {
      backend: "codex",
      source: "harness",
      observedAt: 1728000000000,
      models: [
        { id: "gpt-5.6-sol", label: "GPT 5.6 Sol" },
        { id: "gpt-5.6-luna", label: "GPT 5.6 Luna" },
      ],
    };

    await act(async () => {
      root?.render(
        <div className="native-advisor p-6">
          <RouteFieldset
            routeKey="primary"
            label="Primary Route"
            route={route}
            catalog={catalog}
            isCatalogLoading={false}
            isCustomMode={false}
            errors={{}}
            warnings={{}}
            onBackendChange={vi.fn()}
            onModelChange={vi.fn()}
            onEffortChange={vi.fn()}
          />
        </div>,
      );
    });

    const backendSelect = container?.querySelector<HTMLSelectElement>("#primary-backend");
    const modelSelect = container?.querySelector<HTMLSelectElement>("#primary-model-select");
    const effortSelect = container?.querySelector<HTMLSelectElement>("#primary-effort");

    expect(backendSelect).not.toBeNull();
    expect(modelSelect).not.toBeNull();
    expect(effortSelect).not.toBeNull();

    expect(backendSelect?.classList.contains("form-control")).toBe(true);
    expect(modelSelect?.classList.contains("form-control")).toBe(true);
    expect(effortSelect?.classList.contains("form-control")).toBe(true);

    const backendStyle = window.getComputedStyle(backendSelect!);
    expect(backendStyle.backgroundColor).not.toBe("rgb(255, 255, 255)");
    expect(backendStyle.borderRadius).toBe("6px");
  });
});
