---
title: "Cognito Mode privacy screen mask"
description: "Add an immediate keyboard-only privacy mask with persisted shortcut and appearance, without interrupting background work or notifications."
status: in-progress
priority: P2
effort: 28h
branch: main
tags: [feature, frontend, backend, api, privacy, settings]
created: 2026-10-01
---

# Cognito Mode — privacy / boss key screen mask

Implementation in progress (2/5 phases; 40%; 11/28h planned effort, 39%). Phase 01 is DONE (2026-10-01); Phase 02 is DONE (2026-10-02); Phases 03–05 and runtime qualification remain pending.

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
| 03 | [Global shortcuts and terminal integration](./phase-03-global-shortcuts-and-terminal-integration.md) | Pending / 0% | 6h | 01, 02 |
| 04 | [Settings UI integration](./phase-04-settings-ui-integration.md) | Pending / 0% | 4h | 01, 03 capture contract |
| 05 | [Qualification and smoke](./phase-05-qualification-and-smoke.md) | Pending / 0% | 7h | 01–04 |

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

## Validation summary

- Confirmed requirements incorporated: default/reset shortcut, two styles, immediate same-key toggle, input blocking, notifications/audio continuity, TOML preferences and reload-safe ephemeral state.
- Planning validation passed: all six files, required frontmatter/sections, local Markdown links, overview length and 28h effort sum. Phase 01 and Phase 02 implementation and scoped tests are complete; Phases 03–04 remain for integration and Settings UI work, while Phase 05 browser/native feature qualification remains pending.
- Qualification commands, scenario matrix, platform limits and evidence requirements are specified in [Phase 05](./phase-05-qualification-and-smoke.md).

## Unresolved questions

None. Technical boundaries and qualification gates are explicit; no additional product decision required.
