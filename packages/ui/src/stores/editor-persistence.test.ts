// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { editorFileTabKey, useEditorStore, type Tab } from "./editor.js";

const target = { profileId: "privacy-profile", project: "privacy-project" };

afterEach(() => {
  useEditorStore.setState({ tabs: [], activeKeys: {} });
  localStorage.clear();
});

it("persists tab metadata without draft source or semantic authority", () => {
  const key = editorFileTabKey(target, "privacy.ts");
  const tab: Tab = {
    key, target, project: target.project, targetKey: "root", targetAvailable: true,
    path: "privacy.ts", name: "privacy.ts", mtime: 1, size: 30, tier: "normal",
    content: "private unsaved source text", savedContent: "private saved source text",
    dirty: true, loading: false, saving: false, conflicted: false,
    semanticProvenance: {
      serverUrl: "http://privacy-endpoint", configuredRoot: "/private-configured-root",
      actor: "private-authenticated-actor",
    },
  };
  useEditorStore.setState({ tabs: [tab], activeKeys: { privacy: key } });
  const serialized = localStorage.getItem("dam-hopper:editor-state");
  expect(serialized).not.toBeNull();
  const persisted = JSON.parse(serialized!);
  expect(persisted.state.tabs[0].path).toBe("privacy.ts");
  expect(persisted.state.tabs[0].target.profileId).toBe(target.profileId);
  expect(serialized).not.toContain(tab.content);
  expect(serialized).not.toContain(tab.savedContent);
  expect(serialized).not.toContain("private-authenticated-actor");
  expect(serialized).not.toContain("private-configured-root");
  expect(persisted.state.tabs[0]).not.toHaveProperty("semanticProvenance");
});
