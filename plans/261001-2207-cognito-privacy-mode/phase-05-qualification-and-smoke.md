# Phase 05 — Qualification and smoke

## Context links

- [Overview / release contract](./plan.md), [Phase 01](./phase-01-config-and-schema.md), [Phase 02](./phase-02-cognito-state-and-overlay.md), [Phase 03](./phase-03-global-shortcuts-and-terminal-integration.md), [Phase 04](./phase-04-settings-ui-integration.md).
- [UI package scripts](../../packages/ui/package.json), [root scripts](../../package.json), [Rust manifest](../../server/Cargo.toml), [browser harness](../../packages/ui/vitest.browser.config.ts).
- [Existing real xterm browser coverage](../../packages/ui/browser-tests/terminal-fit-ownership.browser.ts), [terminal/notification browser coverage](../../packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx), [portal consumer coverage](../../packages/ui/browser-tests/consumer-context-menu.browser.tsx).
- [Architecture](../../docs/system-architecture.md), [configuration guide](../../docs/configuration-guide.md), [frontend guide](../../docs/frontend-components/terminal-and-ide.md), [changelog](../../docs/CHANGELOG.md).

## Overview

- Date: 2026-10-02. Priority: P2. Status: DONE / 100%. Effort: 7h.
- Qualification closed: 3/3 build gates passed with 0 errors; focused Rust/Vitest/Chromium tests passed 191/191. Live interactive Linux Chromium app smoke verified Mod+Alt+KeyB activation, focus trap, complete click/key suppression, dismissal, and platform boundary. Code review approved 10/10 with 0 issues; advisor reported 0 must-fix items and user approved documentation-only finalization. macOS/Windows native runtime behavior is not claimed as physically tested.

## Key Insights

- jsdom cannot prove CSS blur, stacking, browser-native event ordering, xterm's actual input bytes, GPU rendering or native child compositing.
- A DOM-only screenshot cannot prove a separate native child is hidden. Native Browser Debug uses existing native visibility acknowledgements and needs a real supported-shell check.
- App zoom uses `--app-viewport-width: calc(100vw / var(--app-zoom))` and height `100dvh / zoom`; qualification must include nondefault zoom and viewport resize.
- Current notifications are native-agent-status based; Codex is status-only. Do not invent OSC 9/Codex chimes as a smoke source. Use an existing qualified OMP/Claude attention path or the existing notification test fixture, distinguishing live evidence from deterministic tests.
- Root build/native package commands are expensive and platform-dependent; one coordinator verification pass after integration, no mid-flight checks.

## Requirements

- Rust defaults/legacy config, JSON↔TOML round trip, partial patch and invalid style tests pass; TS normalization/store/keyboard/overlay/Settings regressions pass.
- Actual app smoke proves both styles, same-key activation/dismissal, no input leakage, runtime-reset-on-reload and persisted preferences.
- Actual xterm/editor/portal behavior, not mocks alone, demonstrates no unintended bytes/edits/actions while active.
- Audio and visible toast continuity, timer expiry, unchanged notification permissions/policies and noninteractive toast input while active.
- No masking-induced network/PTY lifecycle or resize side effects; background output progresses visibly after dismissal.
- Platform display/matching covered on Windows/Linux/macOS; real native-shell/OS behavior reported separately from simulated platform matching.
- Maintained docs and changelog describe actual behavior and privacy limitations; evidence contains no credentials, terminal secrets or private editor text.

## Architecture

Use existing test layers only:
1. Rust existing schema/API test modules and temporary-path config writer.
2. Vitest unit/jsdom existing fixtures and new feature files from Phases 01–04.
3. One focused real-browser regression file `packages/ui/browser-tests/cognito-mode.browser.tsx` for uncertain input/focus/portal/release-order boundaries; reuse existing Playwright/Vitest harness, real xterm and actual React guard/overlay. No new framework or test-only production API.
4. Interactive browser smoke against actual DamHopper server/UI with disposable project/terminal/editor fixtures. This is mandatory even if browser tests pass.
5. Supported native shell smoke for child visibility and platform accelerator conflicts. Do not report unsupported/deferred native platforms as passing.

Proposed browser regression fixture signatures:
- `function CognitoModeHarness(): React.JSX.Element` mounts real input guard, actual overlay, current store, actual xterm surface and editable consumer with the same inert boundary.
- Real xterm `onData` records output input bytes; actual keyboard actions originate from browser automation, not only `dispatchEvent`. Assert terminal input byte array stays empty during activation/masked/dismissal sequences and fresh normal input appears after full release.
- Notification fixture uses existing version-2 notification store/service path and deterministic attention event; assert visible toast arrival/expiry while active and no navigation from its buttons. Audio routing can be tested deterministically; audibility must be separately observed in smoke.

No permanent tests for wiring, copied defaults, class names, component forwarding, source text or incidental prose. Remove touched incidental tests rather than re-pin. Keep meaningful config compatibility and consumer state/transition invariants.

## Related code files

**Modify/review**
- All test files listed in Phases 01–04; fix consumer-visible integration defects at their owning module, not test expectations.
- `server/src/config/tests.rs`, `server/src/api/tests.rs` — temporary-path serialization/merge/invalid input regressions.
- Existing browser test config only if current harness needs standard discovery; `.browser.tsx` convention should already discover the new fixture.
- `docs/system-architecture.md` — ephemeral state, input/focus owner, root/portal/native visibility flow and preference-source contract.
- `docs/configuration-guide.md` and `docs/api-reference.md` — both canonical JSON names, snake_case TOML example, defaults/style enum and partial-patch behavior.
- `docs/frontend-components/terminal-and-ide.md` — same-key toggle, Settings paths, focus/input isolation, notification exception and native/iframe boundaries.
- `docs/CHANGELOG.md` — user-facing feature/defaults/persistence and visual-only limitations.

**Create**
- `packages/ui/browser-tests/cognito-mode.browser.tsx` — only uncertain consumer-visible browser boundaries described above.
- `plans/261001-2207-cognito-privacy-mode/reports/qualification.md` — implementation-time command/results, actual browser/native scenario evidence, screenshots references, platform limitations and side-effect review.

**Delete**: throwaway scripts/fixtures created solely for interactive proof, after proof; no unrelated tests/code. No implementation-time docs outside existing docs/plan tree.

## Preflight contract

1. All implementation slices landed; required fields/callers, guard ordering, capture markers and native visibility contracts are consistent. Coordinator owns final validation.
2. Read current scripts/config to confirm commands below remain valid. Use pnpm 10+, installed Rust toolchain and existing browser configuration; no version upgrades.
3. Use a disposable config directory/project and harmless terminal/editor content. Resolve server CLI config-root flags from actual `--help` before launching; never rewrite user's real server TOML or weaken auth on a shared listener.
4. Record available browsers/native OSes and real audio output capability. A missing native runtime is a qualification prerequisite, not a synthetic pass. Complete reachable gates and report exact unavailable platform evidence without claiming feature qualification complete.
5. Do not rerun user-reported failures just to confirm them. Fix the reported behavior and run the affected post-fix scenario. Preserve unrelated concurrent repository changes.

## Implementation Steps

### 1. Integrated regression pass

Run after Phases 01–04, from repository root; these are planned commands, not planning-time results:

```bash
cargo test --manifest-path server/Cargo.toml cognito
cargo test --manifest-path server/Cargo.toml ui_config
cargo test --manifest-path server/Cargo.toml merge_global_ui_config
cargo test --manifest-path server/Cargo.toml update_global_ui_at_path
pnpm --filter @dam-hopper/ui exec vitest run src/lib/shortcuts.test.ts src/lib/ui-config.test.ts src/lib/terminal-keyboard-shortcuts.test.ts src/stores/settings.test.ts src/stores/cognito-mode.test.ts src/hooks/use-cognito-mode-input-guard.test.tsx src/components/organisms/CognitoModeOverlay.test.tsx src/components/organisms/SettingsKeyboardShortcutsSection.test.tsx src/components/organisms/SettingsAppearanceSection.test.tsx src/components/organisms/TerminalPanel.test.tsx src/components/organisms/PaneContainer.test.tsx src/components/organisms/BrowserDebugKeepAliveHost.test.tsx
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/cognito-mode.browser.tsx
```

Use `cognito` in new Rust behavioral test names so the focused filter is meaningful. Record test counts to reject an accidental zero-tests pass. After focused regressions, coordinator runs one full affected-project pass: `cargo test --manifest-path server/Cargo.toml`, `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build`, `pnpm build`, `pnpm lint`; native frontend/package build only in a supported runtime according to current scripts. Formatting only once, targeted changed files, if repository policy requires it; never root `pnpm format` over unrelated files.

### 2. Real app smoke and scenario matrix

Launch actual server/web UI on loopback with disposable configuration; use the current `dam-hopper-server --help` plus `pnpm --filter @dam-hopper/web dev --host 127.0.0.1`. Use real Chromium browser interaction, inspect visual screenshots and actual consumer state, close tabs/services afterward. Test custom chord `Mod+Alt+KeyK` as well as reset default to avoid app/OS conflicts.

| ID | Scenario | Required observation |
|---|---|---|
| C01 | Fresh/legacy config; open Settings | Heavy Blur/default platform chord; no initial mask |
| C02 | Focus real terminal, press default | Mask appears on the first keydown without fade; no activation bytes or command |
| C03 | Active mask; ordinary text, Enter, Backspace, Tab, Escape, Ctrl/Cmd+C/V, composition, wheel/touch, clicks/context menu | No terminal input, editor mutation, selection/navigation, menu or dialog action; mask remains |
| C04 | Hold activation/dismissal chord; repeats/key release in varying modifier order | One transition only; keypress/keyup/repeats cannot leak after dismissal; next fresh normal terminal input works |
| C05 | Focus Monaco/Settings/search, then open modal and body-portaled context menu | Activation/dismissal works; portal never beats mask; refocus attempts stay at sink; editable contents unchanged |
| C06 | Record current/custom chord, cancel, blur, reset | Capture never activates mask; usable binding changes only on valid commit; reset restores canonical default |
| C07 | Select Black Screen, then Heavy Blur | Black base is opaque #000 with no branding/text; Heavy Blur strongly obscures real content; normal toast exception remains visible |
| C08 | Save custom shortcut/style; read GET `/api/global-config`, actual temporary `config.toml`; reload UI and restart test server | Canonical API plus snake_case TOML values survive; runtime active state always resets; toggle causes no config request |
| C09 | Active mask during eligible OMP/Claude attention event | Chime audibly plays, toast arrives/auto-expires above mask; click/keyboard cannot navigate/dismiss it; notification policy/history unchanged |
| C10 | Continuous harmless terminal counter/job while masked | PTY/output progress continues; same session/connection/dimensions after dismissal, no detach/reconnect/resize from masking |
| C11 | Hydration changes preference source/chord while active; disconnect/reconnect | Mask stays active; original frozen activation chord dismisses; new source's chord applies next activation; no rerouted write/rollback |
| C12 | Min/default/max app zoom, resize, scroll, representative mobile/safe-area viewport | No uncovered edge/header/portal; no layout shift or focus scroll; hardware-keyboard chord only, no touch dismissal |
| C13 | Unmount/remount/StrictMode lifecycle; reload while masked | No stale listeners, inert content or active state; normal controls immediately usable |
| C14 | Supported native shell with native Browser Debug child visible; activate from DamHopper-owned focus | Child disappears without target/navigation reset, cannot overlay mask; same target restores on dismissal; record native visual evidence |
| C15 | Iframe/native child originally has keyboard focus | Document boundary explicit: refocus DamHopper before activation; no claim of foreign-frame/OS-wide hotkey support |
| C16 | Backdrop-filter unsupported simulation; reduced-motion setting | Safe opaque fallback, no clear-content flash; all modes remain instant with no animation |

Persistence smoke also exercises one-field patch preserving unrelated values and invalid style rejection without a file change. Verify no `active`/focus/consumed-key data in network payloads or temporary TOML. Do not compare production secrets or record terminal content.

### 3. Platform and side-effect evidence

- Actual Linux Chromium smoke covers Ctrl+Alt+B and custom chord. Windows Ctrl+Alt+B and macOS Cmd+Option+B: actual OS/browser smoke when available; unit platform override only proves matching/display, not keyboard delivery or native behavior.
- Record browser version/OS, viewport/zoom, screenshots for both styles/toast exception, terminal bytes/editor before-after state, GET/TOML readback and session/dimension continuity.
- Observe first-frame activation at normal interaction speed; use frame recording when uncertain. No microbenchmark/telemetry subsystem or absolute latency promise; implementation adds no deliberate delay.
- Verify existing normal actions after dismissal: shell typing/copy/find/font, Monaco editing, pane split/navigation, menus, Settings capture and notification navigation.

### 4. Documentation and closeout

After smoke passes, update existing architecture/config/API/frontend docs and changelog. Show:

```toml
[ui]
cognito_mode_shortcut = "Mod+Alt+KeyB"
cognito_mode_style = "heavy-blur" # or "black-screen"
```

Explain Settings paths/reset, same-key-only dismissal, reload-reset, background continuity, notifications remaining visible/audible/noninteractive while masked, blur vs blackout distinction, app-document/iframe/native-child limitations and lack of authentication/screenshot protection. Document captured preference-source writes, not administrative target writes.

Remove disposable proof scripts, stop smoke services and close browser tabs. Record only exercised gates in qualification report; fix implementation defects before status updates. Mark phases/overview completed only when all applicable supported-runtime criteria close; report precise unavailable native platform prerequisites rather than implying completion by tests alone.

## Todo list

- [x] Run integrated focused Rust/Vitest/Chromium regressions with nonzero counts.
- [x] Run full UI/backend test suites and lint; record actual counts and warnings.
- [x] Run the planned Rust/UI/web build gates; cargo check, UI tsc, and web vite build all passed with 0 errors.
- [x] Reconcile C01–C16 evidence across live Chromium smoke, automated regressions and explicit host/platform boundaries; record unavailable native runtime evidence without claiming physical testing.
- [x] Reconcile visual/persistence evidence and classify audio, PTY-continuity and native-child evidence by live, automated or host-contract source; clean up smoke services and disposable fixtures.
- [x] Complete code-side side-effect review; all 11 checklist items are recorded in the review.
- [x] Reconcile maintained docs, qualification evidence and statuses against observed behavior.

## Success Criteria

- Both persisted preferences function end-to-end and legacy config works; reload never starts masked.
- Full mask plus input/focus isolation proven on real terminal/editor/portal surfaces; no bytes/edits/actions or release leakage.
- Same configured shortcut is sole in-app exit; capture/reset remain usable and hydration cannot change current dismissal binding.
- Background output, chimes/toasts and policy/timers continue; productive surfaces remain mounted and unchanged.
- Native Browser Debug visibility behavior is covered by host-contract regression evidence; platform limits are explicitly documented without claiming unobserved native runtime results.
- Regression suites/builds succeed and docs describe observed behavior. No placeholders, mock-only claims or unclosed applicable qualification gates.

## Side-effect review checklist

- [x] Server: partial patch, enum rejection, snake_case persistence, existing auth/merge/file-write safety unchanged.
- [x] Preferences: explicit source/generation/edit fencing, offline snapshot and rollback preserved; no activation persistence/network writes.
- [x] Keyboard: capture order, all xterm installations, suggestion/copy/find/font/pane handlers and Monaco shortcuts respect privacy first.
- [x] Input: clipboard/IME/composition/drag/touch/wheel/context menu and dismissal releases do not mutate underlying consumers.
- [x] Focus/accessibility: sink retains focus, inert/aria-hidden reversible, modal scopes safe, toasts' live region stays available.
- [x] Visual: both styles cover zoom/resizing/safe areas/body portals; no clear-content flash or visible blackout branding.
- [x] Notifications/media: audible chimes, visible toasts/expiry, browser notification policy and background media unchanged; toast input blocked.
- [x] Terminal/editor: same model/session/transport/host/dimensions, no mask-induced fits/reconnects/selection switches.
- [x] Native Browser Debug: hidden child cannot cover mask; visibility restores without navigation/target/generation changes.
- [x] Lifecycle: StrictMode/reload/unmount leave usable inactive root; every listener/attribute/proof service cleaned up.
- [x] Scope: no OS-wide accelerator, password/PIN, auto-timeout, new permissions/dependencies, foreign-frame shortcut protocol or unrelated refactor.

## Risk Assessment

- Test-only green with real event leakage: mandatory real browser/PTY/editor smoke and browser-generated key sequences.
- Platform shortcut conflicts/delivery differ: test physical keys on real OS; retain configurable chord; do not label matching unit tests native qualification.
- Notification channel is unavailable: use deterministic browser regression for channel logic, and record live eligible event/audio prerequisite separately; never invent a chime observation.
- Native child may flash over mask despite DOM success: supported native visual gate mandatory, inspect existing host visibility acknowledgment rather than hiding failure in screenshot tests.
- Full suite may expose unrelated preexisting failures: preserve user changes, classify with evidence, fix Cognito regressions; do not weaken consumer assertions to obtain green.

## Security Considerations

- Smoke on loopback/disposable data; never type destructive commands, overwrite real TOML, alter live credentials or disable auth on externally reachable services.
- Screenshots/reports contain harmless fixture text only; no clipboard dumps, tokens, project secrets or raw key logs.
- Blur is not a redaction guarantee; notifications are intentionally not hidden. Background commands continue, and OS capture/chrome/external windows remain outside privacy authority.

## Next steps

Phase 05 is DONE (2026-10-02; 100%; 7/7h). All five phases and the parent Cognito Mode plan are complete (5/5; 28/28h). Product questions: none.
