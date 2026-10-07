# Implementation Report: PR48 Blame Gutter & Metadata Hardening

- **Date**: 2026-10-06
- **Status**: Complete (ready for parent verification barrier)
- **Agent**: BlameUiHardening
- **Target Files Owned**:
  - `packages/ui/src/lib/editor-git-blame-gutter-layout.ts`
  - `packages/ui/src/hooks/use-blame-gutter-wheel-sync.ts`
  - `packages/ui/src/components/molecules/EditorGitBlameRow.tsx`
  - `packages/ui/src/components/organisms/EditorGitBlameContextMenu.tsx`
  - `packages/ui/src/components/organisms/EditorGitBlameGutter.tsx`
  - `packages/ui/src/components/organisms/MonacoHost.tsx`
  - `packages/ui/src/components/organisms/CommitDetailsPanel.tsx`
  - Owned test suites and browser tests:
    - `packages/ui/src/components/organisms/CommitDetailsPanel.test.tsx`
    - `packages/ui/src/components/organisms/EditorGitBlameGutter.test.tsx`
    - `packages/ui/src/components/organisms/MonacoHost.test.tsx`
    - `packages/ui/browser-tests/editor-git-blame.browser.tsx`

---

## Changes Implemented

### 1. Monaco LineHeight & Variable Subpixel Row Alignment
- Removed fragile `editor.constructor?.EditorOption?.lineHeight ?? 66` (which returned boolean from `glyphMargin` ID 66 and dropped CSS).
- Avoided eager heavy import and nonexistent `LayoutInfo.lineHeight`.
- `MonacoHost` captures loaded `monaco` namespace during `onMount` (`monacoRef` and `monacoInstance`), passes typed `monaco` to `EditorGitBlameGutter`.
- `computeVisibleBlameRows` queries typed `monaco.editor.EditorOption.lineHeight` with narrowing, correctly handling fractional heights (e.g. 16.5px, 20px, 24px).
- Row elements apply `height: row.height` and `lineHeight: ${row.height}px` matching Monaco line geometry.

### 2. Committed Row Click & Enter Reveal Guarding
- `EditorGitBlameRow` implements unified `revealCommittedRow` invoked on both mouse `click` (primary button, no modifiers) and `Enter` key.
- Strict guard: `!row.isUncommitted && row.commit && rootId`.
- Uncommitted rows (e.g., line 6) ignore mouse click and Enter key; no reveal callback or outside view notice dispatched.

### 3. Centralized Reveal Dispatch in MonacoHost
- `MonacoHost` wraps `onRevealCommit` with `handleRevealCommit` passed to both gutter and context menu.
- Validates:
  1. `effectiveBlameEnabled` is true.
  2. Blame status is `"ready"` (`effectiveBlameStatusRef.current === "ready"` and `currentBlame.status === "ready"`).
  3. VCS root matches `currentBlame.rootId === rootId`.
  4. Dirty buffer / modelVersion drift check: `currentModel.getVersionId() === currentBlame.modelVersion`. Rejects stale reveal if buffer was edited before React repaint.

### 4. Context Menu Stale & Not-Ready Guards
- `EditorGitBlameContextMenu` evaluates `isReady = blameStatus === 'ready' && blameData?.status === 'ready'`.
- If `blameStatus` is `waiting`, `loading`, `unavailable`, or `error`, reveal item is disabled (`aria-disabled="true"`) with tooltip `"Annotations not ready"`.
- Validates snapshot currency: `blameData.snapshotId === targetSnapshotId` and `blameData.modelVersion === targetModelVersion`. If stale, disabled with `"Buffer changed; refresh annotations"`.
- If targeted line is uncommitted, disabled with `"Uncommitted changes"`.

### 5. Wheel Sync DeltaMode Normalization
- `useBlameGutterWheelSync` normalizes `deltaMode === 1` (`DOM_DELTA_LINE`) using typical line height multiplier (`19px`) and `deltaMode === 2` (`DOM_DELTA_PAGE`) using viewport height.
- Retains vertical sync without page scroll trapping.

### 6. Author Email & Committer Metadata Rendering
- `computeVisibleBlameRows` formats `hoverMetadata` and row `aria-label`/`title` as `Author: ${commit.authorName} <${commit.authorEmail}>\nDate: ...`.
- `CommitDetailsPanel`:
  - Renders author email `<${authorEmail}>` alongside author name and formatted timestamp in history and inspect modes.
  - Renders dedicated committer attribution block with semantic selector `data-testid="commit-details-committer"`.
  - Exposes `committerName`, `<${committerEmail}>`, and localized timestamp with timezone offset (`formatGitCommitAuthorTimestamp`).
  - Preserves inspect mode read-only behavior (no drop/revert/cherry-pick mutations).

---

## Test Coverage & Regressions Added

1. **`EditorGitBlameGutter.test.tsx`**:
   - Updated `mockBlameData` with required `authorEmail`.
   - Verified `hoverMetadata` and row `aria-label` contain `alice@example.com` and `bob@example.com`.
   - Verified fractional and variable line heights (`16.5px`, `24px`) from Monaco `EditorOption.lineHeight`.
   - Verified mouse click on committed row triggers `onRevealCommit` with exact OID and rootId.
   - Verified mouse click and Enter on uncommitted row do not trigger `onRevealCommit`.
   - Verified context menu disables reveal with `"Annotations not ready"` when `blameStatus === "waiting"`.

2. **`MonacoHost.test.tsx`**:
   - Added `handleRevealCommit` regression testing successful reveal on matching model version.
   - Verified rejection of reveal when editor buffer is dirty (`modelVersion` drift) before React repaint.

3. **`CommitDetailsPanel.test.tsx`**:
   - Updated log entries and query data fixtures with `authorEmail` and committer fields.
   - Verified rendering of `<alice@example.com>` and `<bob@example.com>`.
   - Verified `data-testid="commit-details-committer"` exposes `Bob Reviewer` and `<reviewer@example.com>`.
   - Added dedicated test for committer metadata with timezone offset.

4. **`editor-git-blame.browser.tsx`**:
   - Updated browser test fixtures with `authorEmail`.
   - Verified row height strictly equals configured Monaco line height (`20px`).
   - Verified committed row Enter and click trigger reveal with exact OID.
   - Verified uncommitted row Enter and click do not trigger reveal.
   - Passed `monaco` instance through harness to gutter.

---

## Unresolved Questions
1. None for UI components. Parent owns integration test run and final E2E test execution.
