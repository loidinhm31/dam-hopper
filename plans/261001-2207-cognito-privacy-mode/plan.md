---
title: "Cognito Mode privacy screen mask"
description: "Add an immediate keyboard-only privacy mask with persisted shortcut and appearance, without interrupting background work or notifications."
status: completed
priority: P2
effort: 28h
branch: main
tags: [feature, frontend, backend, api, privacy, settings]
created: 2026-10-01
completed: 2026-10-02
---

# Cognito Mode — privacy / boss key screen mask

DONE (2026-10-02; 100%; 5/5 phases; 28/28h). Phase 05 qualification is complete based on the focused test/build gates, live Linux Chromium app smoke, and recorded platform boundaries. See the phase plans and qualification/review reports for evidence; macOS/Windows native runtime behavior is not claimed as physically tested.

## Deliverables

1. Settings > Keyboard Shortcuts: configurable Cognito Mode chord and reset to default.
2. Settings > Appearance: Heavy Blur / Black Screen selector; server TOML persistence through Rust/TS `UiConfig` and the existing settings store.
3. Immediate same-shortcut toggle across DamHopper-owned pages, terminals, editors and dialogs; ephemeral activation resets on reload.
4. Full-viewport mask and input isolation; background PTY/output, editor state, audio chimes and notification toasts continue.
5. Consumer-visible regressions, real browser/native qualification evidence and maintained docs/changelog.

## Key Decisions

- Default `Mod+Alt+KeyB`: Ctrl+Alt+B on Windows/Linux; Cmd+Option+B on macOS. Default style `heavy-blur`; alternative `black-screen`.
- Persist only `cognitoModeShortcut` / `cognitoModeStyle` (TOML snake_case). No persisted activation, new endpoint, dependency, server session state or OS-wide hotkey.
- Single capture-phase keyboard owner in `DamHopperApp`; xterm consumes matching chords defensively but never toggles a second time. Block repeats, composition and dismissal-key release leakage.
- Dedicated non-persisted Zustand state; freeze the activation chord until dismissal so preference hydration cannot lock the user out.
- Body portal, no fade/animation, focus sink, root `inert` plus capture guards for body portals. No click, Escape, close button, timeout, navigation or notification dismissal path.
- Heavy Blur is a frosted-glass visual deterrent, not a security lock; Black Screen uses an opaque #000 base. Notification toasts remain visible above either mask but noninteractive while masked; audio and toast expiry unchanged.
- App-document scope only: embedded third-party iframe/native-child keystrokes do not bubble into DamHopper. Mask an active native Browser Debug child through its existing viewport visibility contract; do not invent a keyboard bridge.

## Phases

| # | Phase | Status / progress | Effort | Depends on |
|---|---|---|---|---|
| 01 | [Config and schema](./phase-01-config-and-schema.md) | DONE / 100% (2026-10-01) | 4h | Preflight |
| 02 | [State and overlay](./phase-02-cognito-state-and-overlay.md) | DONE / 100% (2026-10-02) | 7h | 01 contract |
| 03 | [Global shortcuts and terminal integration](./phase-03-global-shortcuts-and-terminal-integration.md) | DONE / 100% (2026-10-02) | 6h | 01, 02 |
| 04 | [Settings UI integration](./phase-04-settings-ui-integration.md) | DONE / 100% (2026-10-02) | 4h | 01, 03 capture contract |
| 05 | [Qualification and smoke](./phase-05-qualification-and-smoke.md) | DONE / 100% (2026-10-02) | 7h | 01–04 |

## Execution contract

- Read all phase contracts first. Re-read current files before edits; preserve unrelated changes. Phase 01 freezes names/defaults; Phase 02 freezes state/focus/input API; Phase 03 owns root and terminal cutover; Phase 04 owns capture markers.
- Preflight: confirm current shortcut, portal, xterm and native host owners; reuse repo patterns and explicit preference-source/generation fencing. Each phase includes a preflight contract and side-effect checklist.
- Suggested order: 01 → 02 → 03 → 04 → 05. Shared-file edits have one owner. Independent UI work may start only after contracts freeze; no concurrent edits to `shortcuts.ts`, the root app or input guard.
- Coordinator runs project-wide checks once after all implementation slices land. No mid-flight builds/lint/formatters/full suites; retain focused behavioral regressions and record actual app/browser proof.
- No completion by overlay alone, z-index alone, synthetic event tests alone, blur-only screenshots, interrupted transports or leaked keyboard bytes. All acceptance gates in Phase 05 must close.

## Evidence

- [Reference plan](../261001-2003-git-history-search-persistence/plan.md); [naming standards](../../docs/code-standards.md#naming-conventions); [preference ownership](../../docs/system-architecture.md#phase-06-preferences-settings-usage-and-host-resources-2026-09-17).
- Source inspection: `server/src/config/{schema,global,tests}.rs`, `server/src/api/config.rs`, `packages/ui/src/{lib/shortcuts.ts,lib/ui-config.ts,stores/settings.ts,embed/dam-hopper-app.tsx}`, terminal and Settings consumers. Detailed links in phases.
- Critical discoveries: TOML has an explicit camelCase-to-snake_case mapping; terminal suggestion/copy handling precedes shared keys; browser guards use window capture; toasts currently use z-index 45; native Browser Debug is not a DOM layer.
- Global planning/frontend skills read directly; local `.omp/skills` and `docs/development-rules.md` absent. Current repo conventions override generic skill framework suggestions. Architecture changes intentionally deferred to Phase 05 implementation docs.
- Global activation helper executed successfully, but `EVCRATE_SESSION_ID` is unset; active-plan session persistence is unavailable. Requested plan files exist independently of that helper.
- Phase 01 implementation is complete, with scoped Rust/UI validation recorded in the [phase plan](./phase-01-config-and-schema.md) and [test report](../reports/tester-261001-2316-phase-01-config-schema-tests.md).
- Follow-up one-field patch preservation regressions passed: UI settings file 28/28; `update_global_ui_preserves_other_cognito_field_and_unrelated_settings_on_partial_patch` passed 1/1 (1,766 filtered).
- Documentation updates and 42-file link validation are recorded in the Phase 01 completion evidence.

- Phase 02 implementation is DONE (2026-10-02); scoped tests passed 28/28 across four UI files and targeted UI typecheck passed. Its five implementation todos and seven side-effect checklist items are complete. Code review scored 9/10 with no critical issues; it flagged a high-priority focus-restoration timing race against Phase 03's upcoming inert content boundary for integration follow-up. See [Phase 02 plan](./phase-02-cognito-state-and-overlay.md), [tester report](../reports/tester-261002-0010-phase-02-cognito-state-overlay.md), and [code review](../reports/code-review-261002-0013-phase-02-cognito-state-overlay.md).

- Phase 03 is DONE (2026-10-02; 100%) after Phase 05 integrated qualification closed: all five implementation todos and seven side-effect checks are complete. Scoped UI validation passed 55/55 tests across four files; the earlier full UI report recorded 2,169/2,169 tests across 291 files, and targeted UI typecheck passed. Code review approved 9.5/10 with no critical issues or warnings; its medium defensive-default recommendation was non-blocking. See [Phase 03 plan](./phase-03-global-shortcuts-and-terminal-integration.md), [tester report](../reports/tester-261002-0103-phase-03-global-shortcuts-terminal-integration.md), and [code review](../reports/code-review-261002-0105-phase-03-global-shortcuts-terminal-integration.md).

- Phase 04 is DONE (2026-10-02; 100%): all five implementation todos and seven side-effect checks are complete. Scoped Settings tests passed 16/16; the integrated Cognito suite passed 79/79 across seven files (includes the scoped Settings tests; not additive), and the UI package TypeScript build passed. Code review approved 10/10, with no critical, high, or medium findings. See [Phase 04 plan](./phase-04-settings-ui-integration.md), [tester report](../reports/tester-261002-0136-phase-04-settings-ui-integration.md), and [code review](../reports/code-reviewer-261002-0136-phase-04-settings-ui-integration.md).


- Phase 05 is DONE (2026-10-02; 100%; 7h). All three build gates passed (Cargo check, UI build, web build: 0 errors); focused qualification passed 191/191 (39 Rust, 143 Vitest, 9 Chromium browser tests). Live interactive Linux Chromium smoke verified Mod+Alt+KeyB activation, focus trap, complete click/key suppression, dismissal, and platform boundary. Review approved 10/10 with 0 issues; the advisor reported 0 must-fix items and the user approved documentation-only closeout. Native Windows/macOS runtime behavior is not claimed as physically tested. See [Phase 05 plan](./phase-05-qualification-and-smoke.md), [qualification report](./reports/qualification.md), [tester report](../reports/tester-261002-0220-phase-05-qualification-smoke.md), and [code review](../reports/code-reviewer-261002-0230-phase-05-qualification-smoke.md).

## Validation summary

- Confirmed requirements incorporated: default/reset shortcut, two styles, immediate same-key toggle, input blocking, notifications/audio continuity, TOML preferences and reload-safe ephemeral state.
- Planning status: DONE / 100%; all 5/5 phases are durably complete (28/28h) as of 2026-10-02. Phase 05 records 3/3 build gates, 191 focused tests, live Linux Chromium app smoke, the 10/10 review, and explicit native-platform boundaries.
- Qualification commands, scenario matrix, platform limits and evidence requirements are specified in [Phase 05](./phase-05-qualification-and-smoke.md).

## Unresolved questions

None. Technical boundaries and qualification gates are explicit; no additional product decision required.
