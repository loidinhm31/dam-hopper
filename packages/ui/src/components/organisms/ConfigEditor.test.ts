// @vitest-environment jsdom
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DamHopperConfig } from "@/api/client.js";
import {
  ConfigEditor,
  CommandsForm,
  createCommandRowIdState,
  ensureCommandRowId,
  removeCommandRowId,
  renameCommandRowId,
  createListRowIdState,
  addListRowId,
  removeListRowId,
  reconcileProjectRowIds,
} from "./ConfigEditor.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

const config: DamHopperConfig = {
  workspace: { name: "demo", root: "/tmp/demo" },
  projects: [{ name: "", path: ".", type: "custom" }],
};

function triggerInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("command row ids", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
  });

  it("pre-populates row ids when initial commands are passed", () => {
    const initialState = createCommandRowIdState({
      build: "tsc",
      test: "vitest",
    });
    expect(initialState.ids).toEqual({
      build: "command-row-0",
      test: "command-row-1",
    });
    expect(initialState.nextId).toBe(2);
  });

  it("preserves a row id when a command key is renamed", () => {
    const initialState = createCommandRowIdState();
    const firstRow = ensureCommandRowId(initialState, "cmd1");
    const renamedState = renameCommandRowId(firstRow.state, "cmd1", "test");
    const renamedRow = ensureCommandRowId(renamedState, "test");

    expect(renamedRow.id).toBe(firstRow.id);
    expect(renamedRow.state.ids).toEqual({ test: firstRow.id });
  });

  it("removes row ids when commands are deleted", () => {
    const firstRow = ensureCommandRowId(createCommandRowIdState(), "cmd1");
    const secondRow = ensureCommandRowId(firstRow.state, "cmd2");
    const nextState = removeCommandRowId(secondRow.state, "cmd1");

    expect(nextState.ids).toEqual({ cmd2: secondRow.id });
    expect(nextState.nextId).toBe(2);
  });
});

describe("list row id helpers", () => {
  it("initializes sequential row IDs and handles add and remove", () => {
    const state = createListRowIdState(2, "service-row");
    expect(state.ids).toEqual(["service-row-0", "service-row-1"]);
    expect(state.nextId).toBe(2);

    const added = addListRowId(state, "service-row");
    expect(added.id).toBe("service-row-2");
    expect(added.state.ids).toEqual([
      "service-row-0",
      "service-row-1",
      "service-row-2",
    ]);

    const removed = removeListRowId(added.state, 0);
    expect(removed.ids).toEqual(["service-row-1", "service-row-2"]);
  });

  it("supports startId offset for fresh replacement generations", () => {
    const freshState = createListRowIdState(2, "project-row", 5);
    expect(freshState.ids).toEqual(["project-row-5", "project-row-6"]);
    expect(freshState.nextId).toBe(7);
  });

  it("reconciles project row IDs preserving unchanged identities and allocating fresh IDs for replacements", () => {
    const initialIds = createListRowIdState(2, "project-row");
    const projectsV1 = [
      { name: "api", path: "./api", type: "custom" as const },
      { name: "web", path: "./web", type: "custom" as const },
    ];

    // 1. Unchanged projects preserve exact same row IDs
    const reconciledSame = reconcileProjectRowIds(
      initialIds,
      projectsV1,
      projectsV1,
    );
    expect(reconciledSame.ids).toEqual(["project-row-0", "project-row-1"]);
    expect(reconciledSame.nextId).toBe(2);

    // 2. Replaced project gets fresh monotonic ID
    const projectsV2 = [
      { name: "api", path: "./api", type: "custom" as const },
      { name: "mobile", path: "./mobile", type: "custom" as const },
    ];
    const reconciledReplaced = reconcileProjectRowIds(
      initialIds,
      projectsV1,
      projectsV2,
    );
    expect(reconciledReplaced.ids).toEqual(["project-row-0", "project-row-2"]);
    expect(reconciledReplaced.nextId).toBe(3);
  });
});

describe("CommandsForm focus retention across edits", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
  });

  it("retains focus and DOM element across multiple keystrokes in command key input", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function StatefulCommandsFormHarness() {
      const [commands, setCommands] = useState<Record<string, string>>({
        build: "tsc",
        test: "vitest",
      });
      return createElement(CommandsForm, {
        commands,
        onChange: setCommands,
      });
    }

    await act(async () => {
      root.render(createElement(StatefulCommandsFormHarness));
    });

    const keyInput = container.querySelectorAll("input")[0];
    expect(keyInput.value).toBe("build");
    keyInput.focus();
    expect(document.activeElement).toBe(keyInput);

    // Keystroke 1: "build" -> "buildx"
    await act(async () => {
      triggerInputValue(keyInput, "buildx");
    });

    // Node must be identical and still focused
    const keyInputAfter1 = container.querySelectorAll("input")[0];
    expect(keyInputAfter1).toBe(keyInput);
    expect(document.activeElement).toBe(keyInput);
    expect(keyInput.value).toBe("buildx");

    // Keystroke 2: "buildx" -> "buildxy"
    await act(async () => {
      triggerInputValue(keyInput, "buildxy");
    });

    // Node must still be identical and still focused
    const keyInputAfter2 = container.querySelectorAll("input")[0];
    expect(keyInputAfter2).toBe(keyInput);
    expect(document.activeElement).toBe(keyInput);
    expect(keyInput.value).toBe("buildxy");

    // Keystroke 3: "buildxy" -> "buildxyz"
    await act(async () => {
      triggerInputValue(keyInput, "buildxyz");
    });

    const keyInputAfter3 = container.querySelectorAll("input")[0];
    expect(keyInputAfter3).toBe(keyInput);
    expect(document.activeElement).toBe(keyInput);
    expect(keyInput.value).toBe("buildxyz");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("ConfigEditor service name editing focus retention", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
  });

  it("retains service name input focus and node identity across successive keystrokes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const initialConfig: DamHopperConfig = {
      workspace: { name: "demo", root: "/tmp/demo" },
      projects: [
        {
          name: "web-app",
          path: "./web",
          type: "custom",
          services: [
            { name: "frontend", buildCommand: "pnpm build" },
            { name: "backend", buildCommand: "cargo build" },
          ],
        },
      ],
    };

    await act(async () => {
      root.render(
        createElement(ConfigEditor, {
          config: initialConfig,
          onSave: vi.fn(async () => undefined),
        }),
      );
    });
    // Find project header button and click it to expand
    const projectButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("web-app"));
    expect(projectButton).toBeDefined();
    await act(async () => {
      projectButton!.click();
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    const frontendInput = inputs.find((inp) => inp.value === "frontend");
    expect(frontendInput).toBeDefined();

    frontendInput!.focus();
    expect(document.activeElement).toBe(frontendInput);

    // Keystroke 1: "frontend" -> "frontend-v2"
    await act(async () => {
      triggerInputValue(frontendInput!, "frontend-v2");
    });

    // The exact same DOM node must remain focused
    expect(document.activeElement).toBe(frontendInput);
    expect(frontendInput!.value).toBe("frontend-v2");

    // Keystroke 2: "frontend-v2" -> "frontend-v2-prod"
    await act(async () => {
      triggerInputValue(frontendInput!, "frontend-v2-prod");
    });

    expect(document.activeElement).toBe(frontendInput);
    expect(frontendInput!.value).toBe("frontend-v2-prod");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
  it("preserves subsequent service identity when a preceding service is removed", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const initialConfig: DamHopperConfig = {
      workspace: { name: "demo", root: "/tmp/demo" },
      projects: [
        {
          name: "web-app",
          path: "./web",
          type: "custom",
          services: [
            { name: "svc-alpha", buildCommand: "pnpm build:alpha" },
            { name: "svc-beta", buildCommand: "pnpm build:beta" },
          ],
        },
      ],
    };

    await act(async () => {
      root.render(
        createElement(ConfigEditor, {
          config: initialConfig,
          onSave: vi.fn(async () => undefined),
        }),
      );
    });

    const projectButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("web-app"));
    await act(async () => {
      projectButton!.click();
    });

    const betaInputBefore = Array.from(
      container.querySelectorAll("input"),
    ).find((inp) => inp.value === "svc-beta");
    expect(betaInputBefore).toBeDefined();

    betaInputBefore!.focus();
    expect(document.activeElement).toBe(betaInputBefore);

    const removeButtons = Array.from(
      container.querySelectorAll("button"),
    ).filter((b) => b.textContent === "Remove");
    const removeAlphaBtn = removeButtons[1];
    expect(removeAlphaBtn).toBeDefined();

    await act(async () => {
      removeAlphaBtn.click();
    });

    const betaInputAfter = Array.from(
      container.querySelectorAll("input"),
    ).find((inp) => inp.value === "svc-beta");
    expect(betaInputAfter).toBe(betaInputBefore);
    expect(document.activeElement).toBe(betaInputBefore);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("ConfigEditor terminal profiles and reset behavior", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
  });

  it("renders terminal profile rows with proper styling classes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const initialConfig: DamHopperConfig = {
      workspace: { name: "demo", root: "/tmp/demo" },
      projects: [
        {
          name: "term-app",
          path: "./term",
          type: "custom",
          terminals: [{ name: "dev-server", command: "pnpm dev", cwd: "." }],
        },
      ],
    };

    await act(async () => {
      root.render(
        createElement(ConfigEditor, {
          config: initialConfig,
          onSave: vi.fn(async () => undefined),
        }),
      );
    });

    const projectButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("term-app"));
    await act(async () => {
      projectButton!.click();
    });

    const profileInput = Array.from(container.querySelectorAll("input")).find(
      (inp) => inp.value === "dev-server",
    );
    expect(profileInput).toBeDefined();
    const profileRow = profileInput!.closest(".rounded.border");
    expect(profileRow).not.toBeNull();
    expect(profileRow?.className).toContain("rounded border border-[var(--color-border)]");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("allocates fresh project identity on reset after external change", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const initialConfig: DamHopperConfig = {
      workspace: { name: "demo", root: "/tmp/demo" },
      projects: [{ name: "proj-1", path: "./p1", type: "custom" }],
    };
    const replacementConfig: DamHopperConfig = {
      workspace: { name: "demo-fresh", root: "/tmp/demo" },
      projects: [{ name: "proj-fresh", path: "./p1-fresh", type: "custom" }],
    };

    await act(async () => {
      root.render(
        createElement(ConfigEditor, {
          config: initialConfig,
          onSave: vi.fn(async () => undefined),
        }),
      );
    });

    const projectButtonBefore = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("proj-1"));
    expect(projectButtonBefore).toBeDefined();

    // Expand the project
    await act(async () => {
      projectButtonBefore!.click();
    });

    const projectContainerBefore = projectButtonBefore!.closest("div.rounded-lg");
    expect(projectContainerBefore).not.toBeNull();

    // Modify workspace name to dirty the form
    const workspaceInput = container.querySelector(
      'input[placeholder="my-workspace"]',
    ) as HTMLInputElement;
    await act(async () => {
      triggerInputValue(workspaceInput, "demo-dirty");
    });
    expect(workspaceInput.value).toBe("demo-dirty");

    // External config arrives while form is dirty
    await act(async () => {
      root.render(
        createElement(ConfigEditor, {
          config: replacementConfig,
          onSave: vi.fn(async () => undefined),
        }),
      );
      // Flush microtasks for C1 externalChange detection
      await Promise.resolve();
    });

    // Find "Reset to latest" button and click it
    const resetButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Reset to latest"));
    expect(resetButton).toBeDefined();

    await act(async () => {
      resetButton!.click();
    });

    // Workspace name is restored to replacement config
    expect(workspaceInput.value).toBe("demo-fresh");

    // The project row is fresh and rendered from replacement config
    const projectButtonAfter = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("proj-fresh"));
    expect(projectButtonAfter).toBeDefined();
    const projectContainerAfter = projectButtonAfter!.closest("div.rounded-lg");
    expect(projectContainerAfter).not.toBe(projectContainerBefore);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("allocates fresh project identity when clean config is replaced externally with same project count", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const configA: DamHopperConfig = {
      workspace: { name: "demo-a", root: "/tmp/demo" },
      projects: [{ name: "proj-a", path: "./pa", type: "custom" }],
    };
    const configB: DamHopperConfig = {
      workspace: { name: "demo-b", root: "/tmp/demo" },
      projects: [{ name: "proj-b", path: "./pb", type: "custom" }],
    };

    await act(async () => {
      root.render(
        createElement(ConfigEditor, {
          config: configA,
          onSave: vi.fn(async () => undefined),
        }),
      );
    });

    const projectButtonA = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("proj-a"));
    expect(projectButtonA).toBeDefined();
    const projectContainerA = projectButtonA!.closest("div.rounded-lg");
    expect(projectContainerA).not.toBeNull();

    // Replace with clean configB having the same project count (1 project)
    await act(async () => {
      root.render(
        createElement(ConfigEditor, {
          config: configB,
          onSave: vi.fn(async () => undefined),
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const projectButtonB = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("proj-b"));
    expect(projectButtonB).toBeDefined();
    const projectContainerB = projectButtonB!.closest("div.rounded-lg");

    // Fresh identity allocated, not reusing DOM node of project A
    expect(projectContainerB).not.toBe(projectContainerA);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("preserves project input focus, DOM identity, and expanded state on external workspace-only update", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const configV1: DamHopperConfig = {
      workspace: { name: "workspace-v1", root: "/tmp/v1" },
      projects: [
        {
          name: "my-service",
          path: "./services/my-service",
          type: "custom",
        },
      ],
    };
    const configV2: DamHopperConfig = {
      workspace: { name: "workspace-v2", root: "/tmp/v1" },
      projects: [
        {
          name: "my-service",
          path: "./services/my-service",
          type: "custom",
        },
      ],
    };

    await act(async () => {
      root.render(
        createElement(ConfigEditor, {
          config: configV1,
          onSave: vi.fn(async () => undefined),
        }),
      );
    });

    // Expand project accordion
    const projectButton = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("my-service"));
    expect(projectButton).toBeDefined();
    await act(async () => {
      projectButton!.click();
    });

    // Locate project's Path input and focus it
    const inputsBefore = Array.from(container.querySelectorAll("input"));
    const pathInputBefore = inputsBefore.find(
      (inp) => inp.value === "./services/my-service",
    );
    expect(pathInputBefore).toBeDefined();

    pathInputBefore!.focus();
    expect(document.activeElement).toBe(pathInputBefore);

    // External config arrives where only workspace.name changed
    await act(async () => {
      root.render(
        createElement(ConfigEditor, {
          config: configV2,
          onSave: vi.fn(async () => undefined),
        }),
      );
      await Promise.resolve();
    });

    // Workspace name is updated to workspace-v2
    const workspaceInput = container.querySelector(
      'input[placeholder="my-workspace"]',
    ) as HTMLInputElement;
    expect(workspaceInput.value).toBe("workspace-v2");

    // The project's Path input DOM node is still the exact same node and still focused
    const inputsAfter = Array.from(container.querySelectorAll("input"));
    const pathInputAfter = inputsAfter.find(
      (inp) => inp.value === "./services/my-service",
    );
    expect(pathInputAfter).toBe(pathInputBefore);
    expect(document.activeElement).toBe(pathInputBefore);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe("ConfigEditor Android Chrome policy", () => {
  it("blocks configuration editing and saving", () => {
    mockPolicy.enabled = true;
    const markup = renderToStaticMarkup(
      createElement(ConfigEditor, {
        config,
        onSave: vi.fn(async () => undefined),
      }),
    );

    expect(markup).toContain('placeholder="my-workspace" disabled=""');
    expect(markup).toContain(">Save changes</button>");
    expect(markup).toContain(
      "Unavailable on Android Chrome: configuration editing is disabled",
    );
    const typeSelect = markup.match(/<select[^>]*>/)?.[0];
    expect(typeSelect).toBeDefined();
    expect(typeSelect).not.toContain('disabled=""');
    const removeButton = markup.match(/<button[^>]*>Remove<\/button>/)?.[0];
    expect(removeButton).toBeDefined();
    expect(removeButton).not.toContain('disabled=""');
  });
});
