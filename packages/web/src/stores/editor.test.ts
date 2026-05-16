import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditorStore, type Tab } from "./editor.js";

function makeTab(project: string, path: string): Tab {
  return {
    key: `${project}::${path}`,
    project,
    path,
    name: path.split("/").pop() ?? path,
    mtime: 1,
    size: 1,
    tier: "normal",
    content: "",
    savedContent: "",
    dirty: false,
    loading: false,
    saving: false,
    conflicted: false,
  };
}

function resetEditorStore() {
  useEditorStore.setState({ tabs: [], activeKeys: {} });
}

describe("editor store bulk closing", () => {
  beforeEach(resetEditorStore);
  afterEach(resetEditorStore);

  it("closeOthers keeps only the chosen tab within one project", () => {
    const alphaOne = makeTab("alpha", "src/one.ts");
    const alphaTwo = makeTab("alpha", "src/two.ts");
    const betaOne = makeTab("beta", "src/other.ts");

    useEditorStore.setState({
      tabs: [alphaOne, alphaTwo, betaOne],
      activeKeys: {
        alpha: alphaOne.key,
        beta: betaOne.key,
      },
    });

    useEditorStore.getState().closeOthers("alpha", alphaTwo.key);

    const state = useEditorStore.getState();
    expect(state.tabs.map((tab) => tab.key)).toEqual([
      alphaTwo.key,
      betaOne.key,
    ]);
    expect(state.activeKeys).toEqual({
      alpha: alphaTwo.key,
      beta: betaOne.key,
    });
  });

  it("closeAll removes only the current project's tabs and clears its active key", () => {
    const alphaOne = makeTab("alpha", "src/one.ts");
    const alphaTwo = makeTab("alpha", "src/two.ts");
    const betaOne = makeTab("beta", "src/other.ts");

    useEditorStore.setState({
      tabs: [alphaOne, alphaTwo, betaOne],
      activeKeys: {
        alpha: alphaTwo.key,
        beta: betaOne.key,
      },
    });

    useEditorStore.getState().closeAll("alpha");

    const state = useEditorStore.getState();
    expect(state.tabs.map((tab) => tab.key)).toEqual([betaOne.key]);
    expect(state.activeKeys).toEqual({
      alpha: null,
      beta: betaOne.key,
    });
  });
});
