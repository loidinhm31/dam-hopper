# Phase 04 — Settings UI integration

## Context links

- [Overview](./plan.md), [Phase 01 preferences/helpers](./phase-01-config-and-schema.md), [Phase 03 capture precedence](./phase-03-global-shortcuts-and-terminal-integration.md), [qualification](./phase-05-qualification-and-smoke.md).
- [Keyboard section](../../packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx), [keyboard tests](../../packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx).
- [Appearance section](../../packages/ui/src/components/organisms/SettingsAppearanceSection.tsx), [appearance tests](../../packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx), [SettingRow](../../packages/ui/src/components/molecules/SettingRow.tsx), [Select](../../packages/ui/src/components/ui/Select.tsx).
- [Settings page / source selectors](../../packages/ui/src/components/pages/SettingsPage.tsx), [settings store](../../packages/ui/src/stores/settings.ts).

## Overview

- Date: 2026-10-01. Priority: P2. Status: pending. Effort: 4h.
- Add discoverable, accessible preference controls using existing capture/reset and appearance patterns; no separate activation toggle button.

## Key Insights

- Local `ShortcutCapture` already provides platform display, recording, Escape cancellation, inline validation and reset icon. Reuse it; do not build a second keyboard recorder.
- Existing capture calls React `preventDefault`/`stopPropagation`, but a window-capture privacy listener runs earlier. An explicit active-capture marker is mandatory to record the current Cognito shortcut safely.
- Shared capture also supports DoubleShift; Cognito's contract is physical-key chords only. Add a per-control validator, leaving other shortcut controls unchanged.
- Existing keyboard tests largely assert static wording/markup. New tests must exercise capture/reset/error behavior through DOM actions; do not add or re-pin incidental text assertions.
- Appearance save flow uses `saveDebounced`; Settings preference source owns UI preferences independently of the server selected for administrative configuration.

## Requirements

- Settings > Keyboard Shortcuts row titled `Cognito Mode`, description explains same shortcut masks/unmasks and only keyboard dismissal.
- Control shows platform-specific binding through `displayShortcut`; default is Ctrl+Alt+B / Cmd+Option+B. Reset calls the same save flow with canonical `Mod+Alt+KeyB`.
- Keyboard capture handles a physical key plus configured modifiers; modifier-only input waits, Escape cancels, repeats/composition do not commit. Invalid Cognito gestures show an accessible error and do not save.
- Settings > Appearance row `Cognito Mode style`, exactly `Heavy Blur` and `Black Screen`, default Heavy Blur. Explain visual-only masking and unchanged notifications/audio nearby.
- Both controls save only through `useSettingsStore.saveDebounced`; no local-only persistence, direct fetch or selected Settings-target override.
- No click-to-activate, preview-mask button, click-to-dismiss, password/PIN or persisted active switch.

## Architecture

Extend the existing internal capture contract minimally:

```ts
interface ShortcutCaptureProps {
  value: string;
  defaultValue: string;
  label?: string;
  onChange: (value: string) => void;
  validate?: (value: string) => string | null;
}
```

`ShortcutCapture` defaults `validate` to existing `validateShortcut`; Cognito passes `validateCognitoModeShortcut`. Set `data-shortcut-capture={capturing ? "true" : undefined}` on the focused capture button for **all** rows so Phase 03 skips inactive global masking while any binding is recorded. Marker disappears on success, cancellation, blur or unmount. Reset remains a separate button and uses `commit(defaultValue)`; normalized default is persisted, not platform-rendered text.

If capture loses focus, cancel recording/reset its DoubleShift detector; otherwise stale marker state can exempt privacy forever. Ignore repeated/composing keydown before detection/commit; existing shortcut controls keep their syntax/features. Per-Cognito validation rejects DoubleShift/wheel, not a global parser change.

`SettingsKeyboardShortcutsSection()` selects `cognitoModeShortcut` and `saveDebounced` using the existing convention, adds one row:
- `value={cognitoModeShortcut}`
- `defaultValue={DEFAULT_COGNITO_MODE_SHORTCUT}`
- `label="Cognito Mode"`
- `validate={validateCognitoModeShortcut}`
- `onChange={(value) => saveDebounced({ cognitoModeShortcut: value })}`

`SettingsAppearanceSection()` selects `cognitoModeStyle`; use the repository Select primitive (or existing native-select pattern if current section evolves), with accessible label `Cognito Mode style`. Values exactly `heavy-blur` / `black-screen`; narrow/check the emitted string before `saveDebounced({ cognitoModeStyle: value })`. No unchecked arbitrary-string cast.

Disabled/unavailable preference-source behavior follows the current settings architecture. Local safe snapshot is still retained by existing store semantics; do not promise remote TOML save while disconnected or introduce retry/connection handling here.

## Related code files

**Modify**
- `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.tsx` — Cognito row, validator option and capture marker/lifecycle.
- `packages/ui/src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx` — DOM behavioral capture/cancel/reset/custom chord cases; remove incidental wording-only test if touched rather than re-pinning it.
- `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx` — labeled two-option style control and concise privacy boundary description.
- `packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx` — user-selects-style behavior plus unrelated-preference preservation; do not expand existing wording snapshots.
- Related typed settings mocks/fixtures revealed by references — add resolved fields and reset between cases.

**Intentionally unchanged**
- `packages/ui/src/components/pages/SettingsPage.tsx` — current Keyboard/Appearance sections already mounted; modify only if current structure requires explicit wiring.
- `packages/ui/src/components/ui/Select.tsx`, `components/molecules/SettingRow.tsx` — reuse rather than changing generic primitives.
- `stores/settings.ts` and `lib/shortcuts.ts` — Phase 01 owns persistence/normalization; no duplicate logic here.

**Create/delete**: no extra settings page/component or feature preferences store.

## Preflight contract

1. Read current capture/render and appearance patterns; inspect accessible Select API and current test DOM setup before editing.
2. Freeze `data-shortcut-capture="true"` and validator signature with Phase 03; no stale-marker or target-only exemption.
3. Confirm both fields are available through normalized Phase 01 settings; use existing preference-source save path.
4. Own only listed Settings files; coordinate any requested shared-helper/root change, no concurrent edits. Skip project-wide checks until integration.

## Implementation Steps

1. Add optional `validate` callback to `ShortcutCapture`, defaulting to existing validation. Use it inside `commit(next: string): void`; preserve accessible error and reset semantics.
2. Mark recording button while capturing; add cancellation on blur alongside existing Escape/success/unmount cleanup. Reset detector whenever a capture ends. Ignore key repeats, `isComposing` and code 229 before trying to commit.
3. Add Cognito Mode row using the Phase 01 default/validator; show current binding through existing platform display. Save canonical chord, not displayed `Ctrl`/`Cmd` alias text from rendering.
4. Add Appearance style selector using the existing UI primitive and typed union; save Heavy Blur or Black Screen through `saveDebounced`. Do not change unrelated appearance/terminal/Android-policy settings.
5. Add concise helper copy: screen-only privacy, background work/notifications/audio continue, same shortcut required to exit, reload resets activation. Do not label it a security lock or claim notification suppression.
6. Convert the touched wording-only keyboard test into jsdom `createRoot`/`act` interaction coverage: start capture, press a custom chord, verify displayed binding and meaningful saved settings state; cancel restores prior binding; reset restores default; modifier-only/IME/repeat/DoubleShift invalid inputs cannot replace the usable binding.
7. Exercise the real capture plus global guard harness: record the already-configured Cognito chord and reset it without activating a mask; once active, stale capture markers do not permit input/dismissal. This is precedence behavior, not a test of marker text.
8. Exercise style control via user change and real local settings state, verify the overlay uses selected style and retains chord/unrelated preferences. Settings-store/disk round trips belong to Phase 01/05; do not assert only `saveDebounced` mock forwarding.
9. Replace touched incidental wording/class/source tests with behavioral coverage, preserving unrelated tests unchanged. All new tests isolated with cleanup/store resets, no real server/profile storage mutation.

## Todo list

- [ ] Add Cognito row using existing recorder/reset and per-control validator.
- [ ] Add capture marker, repeat/IME protection and complete cancellation lifecycle.
- [ ] Add accessible Heavy Blur / Black Screen selector with typed saves.
- [ ] Add behavioral settings/guard/overlay tests and update fixtures.
- [ ] Verify preference source semantics and privacy copy are accurate.

## Success Criteria

- User can record a valid custom chord, cancel recording, and reset to default without toggling privacy accidentally.
- Platform display is Ctrl+Alt+B on Windows/Linux and Cmd+Option+B on macOS; persisted reset value remains `Mod+Alt+KeyB`.
- Style control offers exactly two supported choices and persists selection through the existing settings flow.
- Invalid capture input leaves the previous dismissable chord intact; no stale capture exemption after blur/cancel.
- Changing these controls does not modify unrelated keyboard, terminal, appearance or Android policy state.
- Both settings remain accessible by keyboard and labeled assistive-tech controls while mask is inactive.

## Side-effect review checklist

- [ ] Existing shortcut rows retain DoubleShift/reset/validation behavior; Cognito-only restrictions remain local.
- [ ] Global guard does not consume recording input; active mask never honors the capture exemption.
- [ ] Error/cancel/blur/success/unmount clear recording marker and detector.
- [ ] Repeat and composition do not commit unusable chords or trigger mask while recording.
- [ ] Appearance Select portal layering returns to normal when inactive; style save does not activate mask.
- [ ] Save path uses bound preference source, safe snapshot and existing debounce/rollback—not administrative Settings target.
- [ ] No extra activation button, preview flow, direct API request or persisted active state.

## Risk Assessment

- Reusing capture without marker causes current shortcut to activate before React capture code. Mandatory guard/capture integration test.
- Stale capture marker blocks privacy from an apparently normal Settings button. Clear on blur and all exit paths; check `composedPath`, not arbitrary ancestor global state.
- Unchecked Select value escapes enum contract. Narrow accepted values at the handler and retain server enum validation.
- Static markup tests miss every failure above. Use real DOM actions and Phase 05 app smoke; do not call text snapshots Settings qualification.

## Security Considerations

- Display no server tokens, typed terminal content or clipboard values.
- Copy clearly states notification disclosure, visual-only scope and reload recovery; no security-lock terminology.
- Do not weaken authentication or iframe restrictions for shortcut recording.

## Next steps

Deliver integrated controls to [Phase 05](./phase-05-qualification-and-smoke.md) for disk/reload, real browser/xterm, visual and platform qualification. Implementation docs/changelog are updated only after that smoke evidence.
