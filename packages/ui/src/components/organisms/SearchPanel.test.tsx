import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SearchMode, SearchScope } from "@/stores/search-ui.js";
import type {
  PathSearchResponse,
  SearchResponse,
} from "@/api/fs-types.js";

type SearchData = SearchResponse | PathSearchResponse | undefined;

const mockSearchState: {
  scope: SearchScope;
  mode: SearchMode;
  queries: Record<SearchMode, string>;
} = {
  scope: "project",
  mode: "content",
  queries: {
    content: "EventValidator",
    filename: "EventValidator",
  },
};

let mockData: SearchData;

vi.mock("@/hooks/use-file-search.js", () => ({
  useFileSearch: () => ({
    caseSensitive: false,
    setCaseSensitive: () => undefined,
    data: mockData,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/stores/search-ui.js", () => ({
  useSearchUiStore: () => ({
    ...mockSearchState,
    setScope: () => undefined,
    setMode: () => undefined,
    setQuery: () => undefined,
    selectOnOpen: false,
    consumeSelectOnOpen: () => false,
  }),
}));

vi.mock("@/lib/file-decoration-icon.js", () => ({
  FileDecorationIcon: ({ className = "" }: { className?: string }) => (
    <span className={className}>icon</span>
  ),
}));

import { SearchPanel } from "./SearchPanel.js";

describe("SearchPanel", () => {
  it("ignores stale filename matches when rendering content results", () => {
    mockSearchState.mode = "content";
    mockData = {
      query: "EventValidator",
      truncated: false,
      matches: [{ path: "src/EventValidator.ts" }],
    };

    const renderPanel = () =>
      renderToStaticMarkup(
        <SearchPanel project="demo-project" onResultClick={() => undefined} />,
      );

    expect(renderPanel).not.toThrow();
    expect(renderPanel()).toContain("No results for");
    expect(renderPanel()).not.toContain("src/EventValidator.ts");
  });
});
