import { describe, expect, it, vi } from "vitest";
import type {
  ISearchOptions,
  ISearchResultChangeEvent,
  SearchAddon,
} from "@xterm/addon-search";
import {
  TERMINAL_FIND_STATUS,
  TerminalFindController,
} from "./terminal-find-controller.js";

class SearchAddonDouble {
  readonly findNext = vi.fn(
    (query: string, options?: ISearchOptions): boolean => {
      void query;
      void options;
      return true;
    },
  );
  readonly findPrevious = vi.fn(
    (query: string, options?: ISearchOptions): boolean => {
      void query;
      void options;
      return true;
    },
  );
  readonly clearDecorations = vi.fn();
  private listener: ((event: ISearchResultChangeEvent) => void) | null = null;
  private disposedListeners = 0;

  readonly onDidChangeResults = (
    listener: (event: ISearchResultChangeEvent) => void,
  ) => {
    this.listener = listener;
    return {
      dispose: () => {
        this.disposedListeners += 1;
        this.listener = null;
      },
    };
  };

  emit(event: ISearchResultChangeEvent): void {
    this.listener?.(event);
  }

  get disposedListenerCount(): number {
    return this.disposedListeners;
  }
}

function createController(): {
  addon: SearchAddonDouble;
  controller: TerminalFindController;
} {
  const addon = new SearchAddonDouble();
  const controller = new TerminalFindController(
    addon as unknown as SearchAddon,
  );
  return { addon, controller };
}

describe("TerminalFindController", () => {
  it("tracks open, empty, query, and result transitions", () => {
    const { addon, controller } = createController();
    const listener = vi.fn();
    controller.subscribe(listener);

    expect(controller.getSnapshot()).toEqual({
      isOpen: false,
      query: "",
      resultIndex: 0,
      resultCount: 0,
      status: TERMINAL_FIND_STATUS.EMPTY,
    });

    controller.open();
    controller.setQuery("build");
    expect(addon.findNext).toHaveBeenCalledWith(
      "build",
      expect.objectContaining({
        regex: false,
        caseSensitive: false,
        wholeWord: false,
        decorations: expect.objectContaining({
          matchBackground: expect.any(String),
          activeMatchBackground: expect.any(String),
        }),
      }),
    );

    addon.emit({ resultIndex: 1, resultCount: 3 });
    expect(controller.getSnapshot()).toMatchObject({
      query: "build",
      resultIndex: 2,
      resultCount: 3,
      status: TERMINAL_FIND_STATUS.MATCHES,
    });

    controller.setQuery("");
    expect(addon.clearDecorations).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe(TERMINAL_FIND_STATUS.EMPTY);
    expect(listener).toHaveBeenCalled();
  });

  it("reports no matches from the result event", () => {
    const { addon, controller } = createController();
    controller.open();
    controller.setQuery("missing");
    addon.emit({ resultIndex: -1, resultCount: 0 });

    expect(controller.getSnapshot()).toMatchObject({
      resultIndex: 0,
      resultCount: 0,
      status: TERMINAL_FIND_STATUS.NO_MATCH,
    });
  });

  it("navigates only while open with a non-empty query", () => {
    const { addon, controller } = createController();
    controller.findNext();
    controller.findPrevious();
    expect(addon.findNext).not.toHaveBeenCalled();
    expect(addon.findPrevious).not.toHaveBeenCalled();

    controller.open();
    controller.setQuery("error");
    addon.findNext.mockClear();
    controller.findNext();
    controller.findPrevious();

    expect(addon.findNext).toHaveBeenCalledOnce();
    expect(addon.findPrevious).toHaveBeenCalledOnce();
  });

  it("clears decorations and subscriptions idempotently on close and dispose", () => {
    const { addon, controller } = createController();
    controller.open();
    controller.setQuery("error");
    controller.close();
    controller.close();
    expect(addon.clearDecorations).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().isOpen).toBe(false);

    controller.dispose();
    controller.dispose();
    expect(addon.clearDecorations).toHaveBeenCalledTimes(2);
    expect(addon.disposedListenerCount).toBe(1);
    controller.open();
    expect(controller.getSnapshot().isOpen).toBe(false);
  });

  it("publishes an empty snapshot on dispose and ignores later result events", () => {
    const { addon, controller } = createController();
    const snapshots = [] as ReturnType<typeof controller.getSnapshot>[];
    controller.subscribe(() => snapshots.push(controller.getSnapshot()));
    controller.open();
    controller.setQuery("secret");
    snapshots.length = 0;

    controller.dispose();
    addon.emit({ resultIndex: 0, resultCount: 1 });

    expect(snapshots).toEqual([
      {
        isOpen: false,
        query: "",
        resultIndex: 0,
        resultCount: 0,
        status: TERMINAL_FIND_STATUS.EMPTY,
      },
    ]);
    expect(controller.getSnapshot().status).toBe(TERMINAL_FIND_STATUS.EMPTY);
  });

  it("keeps independent controller instances isolated", () => {
    const first = createController();
    const second = createController();
    first.controller.open();
    first.controller.setQuery("first");
    first.addon.emit({ resultIndex: 0, resultCount: 1 });

    expect(second.controller.getSnapshot()).toEqual({
      isOpen: false,
      query: "",
      resultIndex: 0,
      resultCount: 0,
      status: TERMINAL_FIND_STATUS.EMPTY,
    });
    expect(second.addon.findNext).not.toHaveBeenCalled();
  });
});
