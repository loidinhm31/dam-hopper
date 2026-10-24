# Plan Validation — Workspace Presentation

Validated: 2026-10-15. Four questions asked through native `/evc-cmd-plan-x-validate` workflow. Planning only; implementation remains pending.

## User restriction before interview

- Workspace: TERMINAL mode only (`terminal`), not IDE.
- Terminal presentation: Traditional only (`traditional`), not Runtime.
- Every included panel accessible from one button row.
- No floating buttons/FABs, draggable launchers or second panel-navigation surface.
- This restriction changes shell/presentation scope, not the previously approved non-browser feature inventory. Editor/files/Git and management views remain panels within the terminal shell.

## Confirmed answers

| Question | User choice | Binding implementation consequence |
| --- | --- | --- |
| Row placement | Top, below server/project header | One in-layout top row outside panel-content scrolling; no bottom/side/floating navigation alternative |
| Panel body | One content area on every screen size | Selected panel replaces terminal visuals; keep qualified terminal/editor controllers and remote sessions alive. No tablet/foldable terminal/panel side dock |
| Keyboard visibility | Always visible | Navigation row remains visible with software keyboard open; honor IME/system insets without wrapping or obscuring destinations |
| Labels | Icon and short text | All panel buttons have icon + concise label and selected state; horizontally scroll to reach every destination, no More/overflow-only menu |

## Interaction invariants

1. Terminal is the primary/default panel. Returning through its row button restores the same selected Traditional session without creating another PTY/controller or replaying input.
2. Only the selected panel accepts keyboard/IME/accessibility input. Hidden terminal/editor state may stay alive but cannot consume input or steal focus.
3. Selection reveals the active row button; row scrolling does not change panel selection or send terminal gestures/keystrokes.
4. One content area is a shell rule. An active diff/merge/editor panel may still contain its necessary internal panes/tabs; those do not create a second workspace mode or panel-navigation bar.
5. Every included destination has a direct button in the row. Narrow screens scroll horizontally rather than wrap, shrink touch targets beyond accepted limits, add a drawer, or hide panels behind a floating launcher.
6. Host fleet/resource dashboards remain included; they are unrelated to the excluded Runtime terminal presentation.
7. Normal inline panel actions/session controls are allowed. No floating quick-access replacement for the removed controls.

## Documentation action items

- [x] Amend overview, architecture, scope/acceptance, decision context, contracts and execution guide.
- [x] Amend Phase01/06/07/17/18 scope; final interview choices are also explicit in Phase06 requirements/steps/acceptance, Phase17 settings/lifecycle constraints, and Phase18 qualification scenarios—not only referenced from this answer record.
- [x] Preserve19 pending implementation phases, existing worktree/branch and empty reserved native-app directory.

## Recommendation

Proceed later in dependency order starting Phase01, subject to native dependency/language-service/crypto/device hard gates. This interview does not certify an APK/native surface or authorize implementation now. No outstanding workspace-presentation decision or required presentation-plan revision remains.

## Unresolved implementation prerequisites

Exact dependency/license pins, non-browser JSON/TS behavior, OPAQUE/native ABI interoperability, signing custody and named-device performance budgets remain in their owning phases. Previous HTML/Mermaid first-release rendering exceptions and desktop/browser/local-execution exclusions remain unchanged.
