# Phase 03: Frontend Search Panel

> Parent: [plan.md](./plan.md) | Depends on: [Phase 02](./phase-02-backend-search-api.md) (backend endpoint)

## Overview

- **Priority:** P2
- **Status:** Done
- **Effort:** 2.5h
- **Description:** Add global file content search panel to IDE workspace, accessible via sidebar tab + Ctrl+Shift+F
- **Completed:** 2026-04-11

## Key Insights

- `SidebarTabSwitcher` currently supports "files" | "terminals"; add "search" tab
- Search panel lives in WorkspacePage left panel alongside FileTree and TerminalTreeView
- REST invoke via `transport.invoke("fs:search", { project, query })` — add case to `channelToEndpoint`
- Debounce input (300ms) to avoid hammering server during typing
- Click result → open file via `useEditorStore.open()`

## Requirements

### Functional
- New "Search" tab in left sidebar tab switcher (magnifying glass icon)
- Text input for search query with debounce
- Results list: grouped by file, showing line number + matching text with highlight
- Click result opens file in editor (and ideally scrolls to line — stretch goal)
- Case-sensitivity toggle
- "X results found" / "Results truncated" indicators
- Ctrl+Shift+F keyboard shortcut to focus search input

### Non-functional
- Debounce 300ms on input
- Max 200 results default
- Loading state during search
- Empty state when no query / no results

## Architecture

```
User types query → debounce 300ms → useFileSearch hook
  → transport.invoke("fs:search", {project, q, case})
  → GET /api/fs/search?project=X&q=PATTERN
  → display SearchResults grouped by file
  → click result → editorStore.open(project, {id, name, kind, ...})
```

## Related Code Files

| File | Action | Description |
|------|--------|-------------|
| `packages/web/src/components/molecules/SidebarTabSwitcher.tsx` | Modify | Add "search" tab option |
| `packages/web/src/components/pages/WorkspacePage.tsx` | Modify | Add search tab panel, wire Ctrl+Shift+F |
| `packages/web/src/hooks/use-file-search.ts` | Create | Debounced search hook using TanStack Query |
| `packages/web/src/components/organisms/search-panel.tsx` | Create | Search input + results list |
| `packages/web/src/api/ws-transport.ts` | Modify | Add `fs:search` case to channelToEndpoint |
| `packages/web/src/api/fs-types.ts` | Modify | Add SearchMatch + SearchResponse types |

## Implementation Steps

### Step 1: Add types to fs-types.ts

```ts
export interface SearchMatch {
  path: string;
  line: number;
  col: number;
  text: string;
}

export interface SearchResponse {
  query: string;
  matches: SearchMatch[];
  truncated: boolean;
}
```

### Step 2: Add fs:search to ws-transport.ts

In `channelToEndpoint()` switch:

```ts
case "fs:search": {
  const d = data as { project: string; q: string; path?: string; case?: boolean; max?: number };
  const params = new URLSearchParams({ project: d.project, q: d.q });
  if (d.path) params.set("path", d.path);
  if (d.case) params.set("case", "true");
  if (d.max) params.set("max", String(d.max));
  return { method: "GET", url: `/api/fs/search?${params}` };
}
```

### Step 3: Create useFileSearch hook

File: `packages/web/src/hooks/use-file-search.ts`

```tsx
import { useQuery } from "@tanstack/react-query";
import { useState, useDeferredValue } from "react";
import { getTransport } from "@/api/transport.js";
import type { SearchResponse } from "@/api/fs-types.js";

export function useFileSearch(project: string | null) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const { data, isLoading, isError } = useQuery<SearchResponse>({
    queryKey: ["fs-search", project, deferredQuery, caseSensitive],
    queryFn: () =>
      getTransport().invoke("fs:search", {
        project,
        q: deferredQuery,
        case: caseSensitive || undefined,
      }),
    enabled: !!project && deferredQuery.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return { query, setQuery, caseSensitive, setCaseSensitive, data, isLoading, isError };
}
```

Uses `useDeferredValue` for natural debounce without timer. Query only fires when >= 2 chars.

### Step 4: Create SearchPanel component

File: `packages/web/src/components/organisms/search-panel.tsx`

Structure:
- Search input with case toggle button
- Status line: "X matches in Y files" or "Truncated"
- Results grouped by file path
  - File header (clickable, shows path)
  - Under each file: list of `line:col text` entries (clickable)
- Click entry → `onResultClick(match)` → opens file in editor

Key behaviors:
- `autoFocus` on mount
- Ctrl+Shift+F from anywhere focuses the input via ref forwarding
- Highlight matching text in results using `<mark>` or span with bg color
- Truncation warning when `truncated: true`

### Step 5: Update SidebarTabSwitcher

Add "search" to `SidebarTab` type:
```ts
export type SidebarTab = "files" | "terminals" | "search";
```

Add Search icon (use `Search` from lucide-react) as third tab button.
Only show when `ideEnabled` (same gate as files tab).

### Step 6: Wire into WorkspacePage

Add `leftTab === "search"` case in `leftPanel`:

```tsx
{leftTab === "search" && ideEnabled && projectName && (
  <SearchPanel
    project={projectName}
    onResultClick={(match) => {
      openFile(projectName, {
        id: match.path,
        name: match.path.split("/").pop()!,
        kind: "file",
        size: 0,
        mtime: 0,
        isSymlink: false,
        children: null,
      });
    }}
  />
)}
```

Add Ctrl+Shift+F effect:
```tsx
useEffect(() => {
  function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey && e.shiftKey && e.key === "F") {
      e.preventDefault();
      setLeftTab("search");
    }
  }
  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}, []);
```

## Todo

- [ ] Add SearchMatch + SearchResponse types to fs-types.ts
- [ ] Add fs:search case to ws-transport.ts channelToEndpoint
- [ ] Create use-file-search.ts hook
- [ ] Create search-panel.tsx component
- [ ] Update SidebarTabSwitcher: add "search" tab
- [ ] Wire search panel into WorkspacePage leftPanel
- [ ] Add Ctrl+Shift+F keyboard shortcut
- [ ] Style: match existing IDE theme (var colors, text sizes)
- [ ] Test: search, click result, file opens
- [ ] Test: empty state, loading state, truncation warning

## Success Criteria

- "Search" tab visible in sidebar switcher when IDE enabled
- Typing query shows results grouped by file
- Clicking a result opens the file in editor
- Ctrl+Shift+F switches to search tab and focuses input
- Case-sensitivity toggle works
- Truncation warning shown when results exceed limit
- Loading spinner during fetch

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Rapid typing floods API | useDeferredValue + min 2 chars + staleTime 30s |
| Large result sets slow rendering | Virtualize list if > 500 results (stretch) |
| Search result file open creates minimal FsArborNode | Acceptable — editor store just needs id/name/kind |

## Security Considerations

- Search query sent as URL param — no injection risk (URL-encoded by URLSearchParams)
- Results only from authenticated project (server-side auth middleware)
- No PII concern — searching user's own project files

## Next Steps

- Stretch: scroll-to-line in Monaco when opening from search result
- Stretch: regex toggle in search input
- Stretch: file name search (not just content)
