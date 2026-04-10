# Phase 01: Markdown Preview + Drag-and-Drop

> Parent: [plan.md](./plan.md)

## Overview

- **Priority:** P2
- **Status:** Done
- **Effort:** 3h (revised from 1.5h — markdown preview is larger scope)
- **Description:** Split-view markdown preview for .md files + drag-and-drop file/folder move in FileTree
- **Completed:** 2026-04-11

## Key Insights

- Monaco already detects markdown mime and sets language to "markdown" (MonacoHost.tsx:35)
- EditorTabs routes to MonacoHost/LargeFileViewer/BinaryPreview based on tier — add MarkdownHost as 4th route
- react-arborist v3.4.3 has built-in DnD; `onMove` maps to existing `ops.move()`
- Drop on file → move to parent dir (validated)

## Requirements

### Functional — Markdown Preview
- When opening .md/.mdx file, show split view: Monaco editor (left) + rendered preview (right)
- Toggle modes: Edit | Split | Preview (buttons in tab bar or above editor)
- Default to Split view
- Preview updates live as user types
- Rendered markdown supports: headings, bold/italic, lists, code blocks, links, images, tables

### Functional — Drag-and-Drop
- Drag files/folders to move within tree
- Drop on file → moves to that file's parent directory
- Drop on directory → moves into that directory
- Prevent self/descendant drops
- Visual feedback: dimmed source, highlighted target

### Non-functional
- New dependency: `react-markdown` + `remark-gfm` (GFM tables/strikethrough)
- Keep each new file under 200 lines

## Architecture

```
EditorTabs (existing)
  ├── MonacoHost (existing — non-markdown files)
  ├── MarkdownHost (NEW — .md/.mdx files)
  │   ├── mode: "edit" | "split" | "preview"
  │   ├── left: MonacoHost (reuse)
  │   └── right: MarkdownPreview (rendered)
  ├── LargeFileViewer (existing)
  └── BinaryPreview (existing)
```

## Related Code Files

| File | Action | Description |
|------|--------|-------------|
| `packages/web/src/components/organisms/markdown-host.tsx` | Create | Split-view wrapper: mode toggle + Monaco + preview pane |
| `packages/web/src/components/organisms/markdown-preview.tsx` | Create | Rendered markdown component using react-markdown |
| `packages/web/src/components/organisms/EditorTabs.tsx` | Modify | Route .md/.mdx files to MarkdownHost instead of MonacoHost |
| `packages/web/src/components/organisms/FileTree.tsx` | Modify | Enable DnD, add onMove handler, visual feedback |

## Implementation Steps

### Step 1: Install markdown dependencies

```bash
pnpm add react-markdown remark-gfm --filter @dev-hub/web
```

### Step 2: Create markdown-preview.tsx

Rendered markdown component. Accepts `content: string`, renders with react-markdown + remark-gfm. Style with Tailwind prose classes or manual heading/list/code styles matching IDE theme.

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <div className={cn("overflow-auto p-4 text-sm ...", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

Style headings, code blocks, lists, tables using Tailwind classes via `components` prop or a wrapper with prose-like styles matching `var(--color-*)` theme tokens.

### Step 3: Create markdown-host.tsx

Split-view host with mode toggle. Accepts same props as MonacoHost + mode state.

```tsx
type MarkdownMode = "edit" | "split" | "preview";

interface MarkdownHostProps {
  tabKey: string;
  content: string;
  tier: FileTier;
  mime?: string;
  viewState?: unknown;
  onChange: (value: string) => void;
  onSave: () => void;
  onViewStateChange: (vs: unknown) => void;
}
```

Layout:
- Top bar: mode toggle buttons [Edit] [Split] [Preview]
- Body: conditional rendering based on mode
  - "edit": full-width MonacoHost
  - "split": 50/50 flex with MonacoHost + MarkdownPreview
  - "preview": full-width MarkdownPreview

MonacoHost is lazy-loaded (already in EditorTabs pattern). MarkdownPreview can be directly imported since react-markdown is lightweight.

### Step 4: Route markdown files in EditorTabs

In EditorTabs.tsx, before the normal MonacoHost Suspense block, check if file is markdown:

```tsx
const isMarkdown = activeTab.name.match(/\.mdx?$/i);
```

If markdown and tier is "normal" or "degraded", render `<MarkdownHost .../>` instead of `<MonacoHost .../>`.

### Step 5: Enable DnD in FileTree

Remove `disableDrag` from Tree. Keep `disableDrop` as validation function:

```tsx
disableDrag={(node) => node.data.id === "__loading__"}
disableDrop={({ parentNode, dragNodes }) => {
  // Allow drop on root (parentNode === null)
  if (!parentNode) return false;
  // Allow drop on dirs
  if (parentNode.data.kind === "dir") {
    // Prevent drop onto self or descendant
    return dragNodes.some(d =>
      d.data.id === parentNode.data.id ||
      parentNode.data.id.startsWith(d.data.id + "/")
    );
  }
  // Drop on file → allowed (moves to parent dir) — handled in onMove
  return false;
}}
```

### Step 6: Add onMove handler

```tsx
async function handleMove({ dragIds, parentId, parentNode }: {
  dragIds: string[];
  parentId: string | null;
  parentNode: NodeApi<FsArborNode> | null;
}) {
  const srcPath = dragIds[0];
  const name = srcPath.split("/").pop()!;

  // If dropped on a file, use its parent dir as target
  let destDir = parentId ?? "";
  if (parentNode && parentNode.data.kind !== "dir") {
    destDir = parentDir(parentNode.data.id);
  }

  const newPath = destDir ? `${destDir}/${name}` : name;
  if (srcPath === newPath) return;
  const result = await ops.move(srcPath, newPath);
  if (!result.ok) setOpError(result.error ?? "Move failed");
}
```

### Step 7: DnD visual feedback in NodeRenderer

Add to `cn()` in NodeRenderer:

```tsx
node.isDragging && "opacity-40",
node.willReceiveDrop && "bg-[var(--color-primary)]/10 ring-1 ring-[var(--color-primary)]",
```

## Todo

- [ ] Install react-markdown + remark-gfm
- [ ] Create markdown-preview.tsx with themed styles
- [ ] Create markdown-host.tsx with edit/split/preview modes
- [ ] Modify EditorTabs to route .md/.mdx → MarkdownHost
- [ ] Enable DnD: remove disableDrag, add disableDrop validation fn
- [ ] Implement handleMove with drop-on-file → parent dir logic
- [ ] Add DnD visual feedback classes
- [ ] Test: open .md file → split view renders
- [ ] Test: toggle edit/split/preview modes
- [ ] Test: drag file to dir, drag file onto file, drag dir
- [ ] Test: loading placeholder nodes can't be dragged

## Success Criteria

- Opening .md file shows split view (editor + preview) by default
- Toggle between edit/split/preview works
- Preview updates live as user types in editor
- GFM features render (tables, strikethrough, task lists)
- DnD: file dropped on dir moves into it
- DnD: file dropped on file moves to file's parent dir
- DnD: self/descendant drops rejected
- Tree auto-updates after move (existing watcher)

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| react-markdown bundle size | ~30KB gzipped with remark-gfm; acceptable |
| react-arborist DnD vs UploadDropzone | react-dnd abstraction layer should coexist; test |
| Split view resize on narrow screens | Use flex with min-width; mode toggle lets user go full edit/preview |
| MonacoHost lazy load inside MarkdownHost | Reuse same lazy import pattern from EditorTabs |

## Security Considerations

- react-markdown sanitizes HTML by default (no XSS from markdown content)
- DnD moves go through server-side sandbox validation
- No raw `dangerouslySetInnerHTML` used

## Next Steps

- Phase 02: Backend search API (parallel, no dependency)
