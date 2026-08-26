# Local scout: validation and documentation surface

## Existing coverage

- `packages/ui/src/components/pages/WorkspacePage.test.tsx:456-535` asserts
  Terminal shell props, Files overlay rendering, and stacking controls using
  an SSR harness.
- `packages/ui/src/components/templates/TerminalWorkspaceShell.test.tsx`
  covers floating z-index and pure panel activation transitions for Git, Ports,
  and Fleet.
- `packages/ui/browser-tests/terminal-floating-panels.browser.tsx` runs real
  Chromium interaction checks for overlay visibility, close/Escape behavior,
  focus activation, hit testing, and z-index.
- `packages/ui/browser-tests/project-worktree-target.browser.tsx:612-690`
  renders the real `WorkspacePage` and proves Project-panel worktree selection
  propagates to files, Git, media, and terminal launch targets.
- `packages/ui/src/components/organisms/ProjectWorktreesSection.test.tsx`
  covers discovery failures, unavailable-target recovery, add/remove errors,
  dirty-editor blockers, and live-terminal blockers.
- `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx`
  asserts shortcut setting rows; `packages/ui/src/lib/ui-config.test.ts` and
  `packages/ui/src/stores/settings.test.ts` cover defaults/hydration/persistence.
- Rust config defaults/serde tests live in
  `server/src/config/tests.rs:1266-1488`.

## Smallest release gate

1. Unit test the new default/config field and IDE/Terminal panel activation
   transition (including repeated shortcut closes the active panel).
2. Extend the Terminal browser harness with a Project request and assert the
   Project content is visible, Escape closes it, and selecting a worktree still
   changes the target store through the real Project panel.
3. Add a WorkspacePage browser or integration assertion that the configured
   Project shortcut is wired to the Terminal request and no-ops in compact mode.
4. Run the narrow UI unit suite and browser suite, then lint/build; run Rust
   config tests because the persisted `UiConfig` shape changes.

## Docs/architecture

- `docs/system-architecture.md` already documents the target contract and the
  Project-panel selector flow. This change is presentation/config wiring only;
  no backend target-resolution or architecture change is expected.
- `docs/frontend-components.md` documents the IDE tool window and terminal
  workspace systems. Update only if implementation introduces a new shared
  shell contract that is not self-evident; avoid unrelated documentation churn.

## Unresolved questions

- Full browser release gate may retain unrelated pre-existing image-preview
  flakiness noted in `plans/reports/tester-gate-260818-1220-project-worktree-switching.md`.
