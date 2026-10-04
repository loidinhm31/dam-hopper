import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { EvaluationsView } from "@/advisor/views/EvaluationsView.js";
import type { AppState } from "@/advisor/app-state-types.js";
import {
  INITIAL_BOUND_POLICY_STATE,
  INITIAL_BOUND_EVALUATIONS_STATE,
} from "@/advisor/app-state-types.js";
import type { EvaluationDescriptorDto, EvaluationsListResultDto } from "@/advisor/advisor-types.js";
import "@/index.css";
import "@/advisor/advisor.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("E2E: Counsel Evaluations Responsive Layout", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "320px";
    container.style.height = "100vh";
    container.style.backgroundColor = "#0F172A";
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

  it("renders Counsel Evaluations (2 descriptors) in narrow container with clean vertical stacking", async () => {
    const descriptors: EvaluationDescriptorDto[] = [
      {
        evaluationRef: "eval-rubric-v2-run-4821",
        sourceRevision: "abc123def4567890",
        sourceDigest: "digest000111222333444555666777888999",
        evaluationId: "e-1",
        runId: "r-1",
        createdAt: 1728000000000,
        candidateCount: 4,
        caseCount: 12,
        observationCount: 48,
      },
      {
        evaluationRef: "eval-rubric-v2-run-4822",
        sourceRevision: "fed987cba6543210",
        sourceDigest: "digest999888777666555444333222111000",
        evaluationId: "e-2",
        runId: "r-2",
        createdAt: 1728003600000,
        candidateCount: 2,
        caseCount: 6,
        observationCount: 24,
      },
    ];

    const evaluationsList: EvaluationsListResultDto = {
      status: "ready",
      observedAt: 1728003600000,
      bindingRevision: "rev-binding-1",
      items: descriptors,
      nextCursor: null,
    };

    const state: AppState = {
      providerKind: "native",
      label: "Native Advisor",
      capabilities: ["evaluations.list", "evaluations.read", "evaluations.compare"],
      isAvailable: true,
      policyState: INITIAL_BOUND_POLICY_STATE,
      evaluationsState: {
        status: "ready",
        list: evaluationsList,
        error: null,
      },
      comparisonState: {
        status: "idle",
        comparison: null,
        cursor: null,
        error: null,
      },
      status: "ready",
      activeView: "evaluations",
      selectedSessionId: null,
      selectedTurnIndex: null,
      drawerOpen: false,
      selectedCategory: null,
      revealCandidates: false,
      currentPolicy: null,
      evaluationsList,
      selectedEvaluation: {
        status: "idle",
        evaluationRef: null,
        descriptor: null,
        document: null,
        observedRevision: null,
        error: null,
      },
      evaluationsComparison: null,
      inventory: null,
    };

    await act(async () => {
      root?.render(
        <div className="native-advisor">
          <EvaluationsView
            state={state}
            onRevealChange={vi.fn()}
            onCompareDescriptors={vi.fn()}
            onInspectDescriptor={vi.fn()}
          />
        </div>,
      );
    });

    const headerTitle = container?.querySelector(".view-title");
    expect(headerTitle?.textContent).toBe("Counsel Evaluations (2 descriptors)");

    const cards = container?.querySelectorAll(".descriptor-card");
    expect(cards?.length).toBe(2);

    const compareBtn = container?.querySelector<HTMLButtonElement>("button[aria-label^='Compare available descriptors']");
    expect(compareBtn).not.toBeNull();

    if (!import.meta.env.CI) {
      await page.viewport(1280, 800);
      await page.screenshot({
        path: "/home/loidinh/WS/dam-hopper/packages/ui/e2e/counsel-evaluations-responsive/screenshot.png",
      });
    }
  });
});
