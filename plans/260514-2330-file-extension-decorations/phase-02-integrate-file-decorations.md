# Phase 02: Integrate File Decorations

## Context links

- Parent plan: [plan.md](./plan.md)
- Phase dependency: [phase-01-shared-file-decoration-registry.md](./phase-01-shared-file-decoration-registry.md)
- Frontend components docs: ../../docs/frontend-components.md

## Overview

- Date: 2026-05-14
- Priority: P2
- Implementation status: Completed
- Review status: Reviewed
- Description: Replace local/generic file presentation with shared decorations across IDE file surfaces.

## Key Insights

- Explorer, tabs, search, and git changes all have enough path/name context to use the same decorator.
- The git status badge should remain distinct from file type decoration; one communicates VCS state, the other file identity.
- `EditorTabs` is the bridge for Monaco/status language because it has active tab name, path, and MIME.

## Requirements

- Replace `FileTree.tsx` local `FileIcon` extension sets with the shared decorator.
- Update editor tabs to render file-specific decoration instead of generic `FileCode`.
- Add file decoration to search result group headers.
- Add file decoration to git change rows without removing existing status badges.
- Use registry language helpers for status bar and Monaco fallback.

## Architecture

- UI components should call `getFileDecoration(pathOrName, { mime })` or render a shared icon component.
- `EditorTab` should accept either `path` or a prepared decoration prop; prefer `path` for simple call sites.
- `MonacoHost` can continue accepting `mime`, but should receive `path` or `fileName` if language fallback is moved there.
- `EditorStatusBar` remains presentation-only and receives the final display language string.

## Related code files

- Modify: `packages/web/src/components/organisms/FileTree.tsx`
- Modify: `packages/web/src/components/molecules/EditorTab.tsx`
- Modify: `packages/web/src/components/organisms/EditorTabs.tsx`
- Modify: `packages/web/src/components/organisms/SearchPanel.tsx`
- Modify: `packages/web/src/components/organisms/ChangedFilesList.tsx`
- Modify: `packages/web/src/components/molecules/ChangedFileEntry.tsx`
- Optional modify: `packages/web/src/components/organisms/GitLocalChanges.tsx`

## Implementation Steps

1. Replace `FileTree.tsx` local mapping with the registry while preserving folder and large-file UI.
2. Extend `EditorTab` props with `path?: string` and render the shared file icon/decorator.
3. Pass `tab.path` from `EditorTabs` into `EditorTab`, Monaco language helper, and status bar display helper.
4. Add decoration to `SearchPanel` file headers before the truncated path.
5. Add decoration to git rows beside filename, keeping status badge/check controls visible.
6. Run TypeScript build and tests; fix import/type regressions.
7. Manually verify common files: `.java`, `.rs`, `.tsx`, `.jsx`, `.md`, `.json`, `.env`, image, unknown extension.

## Todo list

- [x] Integrate registry into Explorer.
- [x] Integrate registry into editor tabs.
- [x] Integrate registry into status bar and Monaco language fallback.
- [x] Integrate registry into search result headers.
- [x] Integrate registry into git change rows.
- [x] Run web tests and build.
- [ ] Perform manual UI smoke check.

## Success Criteria

- File decorations are visually consistent across all targeted surfaces.
- `.java`, `.rs`, `.tsx`, and `.jsx` display distinct identities.
- Existing file open, save, search, and git selection interactions remain unchanged.
- Web tests and build pass.

## Risk Assessment

- Risk: Compact rows become visually crowded.
- Mitigation: Use existing `h-3.5/w-3.5` or `h-4/w-4` sizing and muted colors where needed.
- Risk: Git rows mix VCS and file-type signals.
- Mitigation: Keep status badges closest to selection/check controls and file decorations closest to filename.

## Security Considerations

- No auth, transport, filesystem, or encryption behavior changes.
- UI-only path display must continue using normal React text rendering, not HTML injection.

## Next steps

- After implementation, update docs only if this becomes a documented IDE behavior in `docs/frontend-components.md` or changelog.
