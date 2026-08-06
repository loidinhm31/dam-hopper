import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DamHopperConfig } from "@/api/client.js";
import {
  ConfigEditor,
  createCommandRowIdState,
  ensureCommandRowId,
  removeCommandRowId,
  renameCommandRowId,
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

describe("command row ids", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
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
