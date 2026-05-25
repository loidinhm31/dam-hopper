import { afterEach, describe, expect, it } from "vitest";
import { useSearchUiStore } from "./search-ui.js";

function resetSearchUiStore() {
  useSearchUiStore.setState({
    open: false,
    mode: "content",
    queries: {
      content: "",
      filename: "",
    },
    selectOnOpen: false,
    scope: "project",
  });
}

describe("search-ui store", () => {
  afterEach(resetSearchUiStore);

  it("keeps app-session queries separately by search mode", () => {
    const store = useSearchUiStore.getState();
    store.setQuery("content", "token");
    store.setQuery("filename", "main");

    expect(useSearchUiStore.getState().queries).toEqual({
      content: "token",
      filename: "main",
    });
  });

  it("closing search keeps query and reopening requests input selection", () => {
    useSearchUiStore.getState().setQuery("filename", "config");
    useSearchUiStore.getState().openWith("filename");
    useSearchUiStore.getState().close();

    expect(useSearchUiStore.getState().queries.filename).toBe("config");

    useSearchUiStore.getState().openWith("filename");
    expect(useSearchUiStore.getState().consumeSelectOnOpen()).toBe(true);
    expect(useSearchUiStore.getState().consumeSelectOnOpen()).toBe(false);
  });

  it("selected Monaco text replaces the content query", () => {
    useSearchUiStore.getState().setQuery("content", "old");
    useSearchUiStore.getState().openWith("content", "selected");

    const state = useSearchUiStore.getState();
    expect(state.mode).toBe("content");
    expect(state.queries.content).toBe("selected");
    expect(state.selectOnOpen).toBe(true);
  });
});
