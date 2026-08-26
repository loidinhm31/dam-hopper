# Codebase Analysis: File Extension Decorations

## Relevant Current State

- `packages/web/src/components/organisms/FileTree.tsx` has a local `FileIcon` helper with small `Set`s for code, text, and image extensions.
- `packages/web/src/components/molecules/EditorTab.tsx` always renders `FileCode`, so tabs do not reflect the actual file type.
- `packages/web/src/lib/mime-to-language.ts` maps MIME strings to display labels and Monaco language IDs, but it cannot use filename fallback.
- `packages/web/src/components/organisms/EditorTabs.tsx` uses MIME-only language helpers for status bar and Monaco host routing.
- `packages/web/src/components/organisms/SearchPanel.tsx` groups results by file path but has no file icon or language metadata.
- Git surfaces such as `ChangedFilesList.tsx`, `ChangedFileEntry.tsx`, and `GitLocalChanges.tsx` render status badges but no file-type decoration.

## Architecture Fit

- This feature belongs entirely in `packages/web/src/lib` and React components.
- No Rust API change is needed; all affected views already have a filename, path, MIME, or both.
- A shared registry avoids duplicating extension sets and keeps IDE surfaces visually consistent.
- The registry can stay lightweight: no dependency, no asset pipeline, no server configuration.

## Implementation Constraints

- Preserve current Tailwind/CSS variable styling and compact IDE layout.
- Keep helpers deterministic, side-effect free, and unit-testable.
- Use exact filename matching for dotfiles and extensionless build files before extension matching.
- Treat unknown files as safe `plaintext` fallback.

## Unresolved Questions

None.
