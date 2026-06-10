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
  replaceQuery: string;
} = {
  scope: "project",
  mode: "content",
  queries: {
    content: "EventValidator",
    filename: "EventValidator",
  },
  replaceQuery: "ValidatorEvent",
};

let mockData: SearchData;

vi.mock("@/hooks/use-file-search.js", () => ({
  useFileSearch: () => ({
    caseSensitive: false,
    setCaseSensitive: () => undefined,
    data: mockData,
    isLoading: false,
    isError: false,
    refetch: vi.fn(async () => ({ data: mockData })),
  }),
}));

vi.mock("@/stores/search-ui.js", () => ({
  useSearchUiStore: () => ({
    ...mockSearchState,
    setScope: () => undefined,
    setMode: () => undefined,
    setQuery: () => undefined,
    setReplaceQuery: () => undefined,
    selectOnOpen: false,
    consumeSelectOnOpen: () => false,
  }),
}));

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: (selector: (state: { tabs: [] }) => unknown) =>
    selector({ tabs: [] }),
}));

vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({
    fsRead: vi.fn(),
    fsWriteFile: vi.fn(),
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
    mockSearchState.queries.content = "EventValidator";
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

  it("renders replace controls only in content mode", () => {
    mockSearchState.mode = "content";
    mockSearchState.queries.content = "EventValidator";
    mockData = {
      query: "EventValidator",
      truncated: false,
      matches: [
        {
          path: "src/EventValidator.ts",
          line: 12,
          col: 5,
          text: "const EventValidator = createValidator();",
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <SearchPanel project="demo-project" onResultClick={() => undefined} />,
    );

    expect(markup).toContain("Replace with");
    expect(markup).toContain("Replace Next");
  });

  it("never renders replace controls in filename mode", () => {
    mockSearchState.mode = "filename";
    mockSearchState.queries.filename = "EventValidator";
    mockData = {
      query: "EventValidator",
      truncated: false,
      matches: [{ path: "src/EventValidator.ts" }],
    };

    const markup = renderToStaticMarkup(
      <SearchPanel project="demo-project" onResultClick={() => undefined} />,
    );

    expect(markup).not.toContain("Replace with");
    expect(markup).not.toContain("Replace Next");
  });

  it("disables Replace Next when the content query is too short", () => {
    mockSearchState.mode = "content";
    mockSearchState.queries.content = "a";
    mockData = undefined;

    const markup = renderToStaticMarkup(
      <SearchPanel project="demo-project" onResultClick={() => undefined} />,
    );

    expect(markup).toContain("Replace Next");
    expect(markup).toContain('disabled=""');
  });
});
