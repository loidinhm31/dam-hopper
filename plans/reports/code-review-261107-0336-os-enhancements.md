## Code Review Summary

### Scope
- Review: all 32 requested working-tree paths; approximately 4,500 changed/new lines including tests. Static source/diff review, plus supporting callsite tracing.
- Files reviewed:
  - `server/src/config/{schema.rs,global.rs,tests.rs}`
  - `packages/ui/src/api/client.ts`
  - `packages/ui/src/lib/ui-config.ts`
  - `packages/ui/src/stores/{settings.ts,lock-screen.ts,lock-screen.test.ts}`
  - `packages/ui/src/os/{os.css,intents.ts,DesktopCanvas.tsx,DesktopCanvas.test.tsx,MonitorTray.tsx,MonitorTray.test.tsx,Dock.tsx,Dock.test.tsx,LockScreenOverlay.tsx,LockScreenOverlay.test.tsx,PinSetupDialog.tsx,PinSetupDialog.test.tsx,TopBar.tsx,TopBar.test.tsx,WindowFrame.tsx,OsShell.tsx,input-arbiter.ts,input-arbiter.test.ts}`
  - `packages/ui/src/os/agent-hub/{AgentHubHeader.tsx,AgentHubHeader.test.tsx}`
  - `packages/ui/src/os/apps/AgentHubApp.tsx`
  - `packages/ui/src/components/organisms/{TraditionalTerminalProjectsDisplay.tsx,SettingsAppearanceSection.tsx,SettingsAppearanceSection.test.tsx}`
- Supporting evidence: `README.md`, PDR/code standards, enhancement overview/phases 01/05/06, intent router, root keyboard coordinator, Cognito input guard, shell suppression provider, resource host, modal/control primitives.
- Updated plans: none; review-only ownership. Phase 06 has an unimplemented PIN-management integration requirement.
- No builds, tests, linters, formatters, or browser runs executed. Qualification remains Main/tester-owned; previously reported suite totals are not independent evidence from this review.

### Overall Assessment / Signoff
**CHANGES REQUESTED — signoff withheld.** Three high-priority defects and two medium-priority acceptance gaps. Dock JSX preserves component identity; PIN cryptography and client-only separation follow the intended design. However, float-Git handling is unreachable, lock isolation misses the existing root keyboard coordinator, and storage errors can produce a falsely configured lock.

### Critical Issues
None identified in inspected changes. This is a browser convenience lock, not a server authorization boundary; findings below do not imply backend authentication bypass.

### High Priority Findings

#### R1 — New Git float/reveal handler never executes
- Evidence: `packages/ui/src/os/OsShell.tsx:814-842` registers an earlier `git:status` handler; the modified handler is registered again at `1389-1430`. `packages/ui/src/os/intents.ts:290,319-324` preserves insertion order and returns on the first `handled` result.
- Failure/impact: the earlier handler always handles the intent and ignores `payload.mode`. With default placement `tile`, the new Hub Git button opens tiled, not floating. An existing tiled/maximized Git window is not floated; a Git window on another desktop is not revealed by the new logic. The main feature path therefore misses its acceptance contract.
- Correction: consolidate to one `git:status` consumer containing the intended mode/reveal behavior; remove the obsolete registration. Preserve normal maximization semantics when no explicit float mode is requested.
- Required regression: dispatch the actual Hub `git:status` intent through the mounted shell/router with tiled default placement, existing tiled/maximized window, and existing window on another desktop. Header callback tests alone cannot detect this.
- Confidence: high; direct control-flow evidence.

#### R2 — Locked screen does not own the root keyboard dispatch path
- Evidence: the only production caller supplying `isLockScreenActive` is `packages/ui/src/os/WindowFrame.tsx:363-370`. `LockScreenOverlay.tsx:383-502` installs its own window-capture listeners in an effect. The already-mounted app installs the root coordinator in layout effects at `packages/ui/src/embed/dam-hopper-app.tsx:299-301`; `use-cognito-mode-input-guard.ts:246-247` also installs/configures it. `packages/ui/src/os/action-dispatch.ts:187-375` has Cognito precedence but no lock policy, and executes palette/focus/font/app shortcuts with `stopImmediatePropagation()` before the later overlay listener.
- Failure/impact: while locked, configured OS shortcuts still mutate underlying window/settings state; palette/focus actions remain active. Remapping an action to a digit also prevents that digit from reaching PIN entry. The new arbiter branch cannot protect this earlier dispatcher. The lock is additionally absent from terminal suppression (`shell-input-context.tsx:122-128`), so the native terminal input boundary remains enabled.
- Correction: integrate lock physical-input ownership into the existing root coordinator immediately after Cognito, rather than depending on listener registration order. Preserve PIN/Tab handling and trailing releases without executing background actions. Include lock state in the shared terminal-suppression boundary.
- Required regression: mount the real coordinator plus lock overlay; verify palette, cycle-focus, app launch, font changes, remapped digit chords, and trailing events cannot reach background actions, while Cognito toggle retains precedence and PIN entry works.
- Confidence: high for root-dispatch defect; terminal-suppression omission directly observed, not a claim of an exercised PTY leak.

#### R3 — Failed browser-storage writes are reported as successful PIN setup/removal
- Evidence: `packages/ui/src/stores/lock-screen.ts:229-243` catches verifier persistence errors and still sets `hasPin: true`; `175-179` treats a missing verifier as successful recovery/unlock. `262-277` likewise reports successful removal despite failed deletes. `PinSetupDialog.test.tsx:403-436` mocks `setPin` rejection rather than exercising the real storage failure.
- Failure/impact: a quota/security failure during initial setup closes the dialog as success. Locking then accepts any full-length digit sequence because no verifier exists. Failed change/removal similarly misrepresents which PIN remains persisted and can restore the old configuration on reload.
- Correction: propagate verifier write/delete failures and commit success state only after the required storage operation succeeds; show the existing dialog error UI. Do not silently advertise a configured lock without a usable verifier. Keep intentional browser-data-reset recovery distinct from successful setup.
- Required regression: make real `Storage.setItem`/`removeItem` throw; assert rejected setup/change/removal, unchanged configuration, visible errors, and no falsely successful lock.
- Confidence: high; direct error-path evidence.

### Medium Priority Improvements

#### R4 — PIN change/remove UI is unreachable
- Evidence: `packages/ui/src/os/TopBar.tsx:354-361` only requests setup when no PIN exists; once configured, it only locks. The sole production `PinSetupDialog` mount is `OsShell.tsx:1800-1803`, without a management mode. `SettingsAppearanceSection.tsx:268-402` adds dock controls but no Screen Lock PIN row. Phase 06 explicitly requires status, Lock Now, Change PIN, Remove PIN, and setup actions (`plans/261107-0247-os-enhancements/phase-06-shell-integration.md:32-33`).
- Failure/impact: users can create a PIN but cannot change or remove it through the shipped UI. Isolated dialog tests do not establish user reachability.
- Correction: wire the planned local PIN-management row/actions and explicit dialog modes; keep PIN/verifier fields out of server settings persistence.
- Required regression: exercise setup → change → lock/unlock → remove through Settings and confirm no PIN/verifier network payload.
- Confidence: high; production callsites traced.

#### R5 — New controls miss the explicit 44px touch-target requirement
- Evidence: the new lock trigger uses only `p-1.5` around a `h-3.5 w-3.5` icon (`packages/ui/src/os/TopBar.tsx:363-365`), yielding approximately 26px square from declared styles. Hub Git uses `py-1` inside a 40px header (`agent-hub/AgentHubHeader.tsx:48,108-123`). PIN dialog controls inherit 32px buttons and 36px inputs (`PinSetupDialog.tsx:212-269,296-311`; `components/atoms/Button.tsx:22-25`; `components/ui/Input.tsx:9`). No applicable 44px global override was found.
- Failure/impact: new lock/Git/PIN controls do not satisfy the user's explicit minimum touch target, despite the dock's 44px targets and lock keypad's 64px targets.
- Correction: apply minimum 44px interactive dimensions and adjust surrounding chrome sizing where necessary; retain explicit accessible labels.
- Required qualification: measure actual bounding boxes in browser at supported viewport sizes, including the dialog close control.
- Confidence: high from declared sizing; browser measurements not performed.

### Low Priority Suggestions
- Remove unused `normalizeDockPosition` import at `packages/ui/src/stores/settings.ts:35`; no lint-clean claim is made.

### Positive Observations
- `OsShell.tsx:1766-1773` keeps `<Dock>` then `<main>` in stable JSX order and changes only flex direction. No position-dependent keys/conditional subtree replacement were introduced; static keepalive invariant is respected.
- `lock-screen.ts:18-50` uses WebCrypto PBKDF2-SHA256, 100,000 iterations, a fresh 16-byte random salt, and a 256-bit verifier. PIN/verifier remain separate from server UiConfig/settings persistence in inspected callsites.
- `PinSetupDialog.tsx:286-293` clearly states browser-local storage and that this does not replace server authentication.
- Lock overlay uses z-index 9990, allows Cognito handling to take priority, skips its focus recovery while Cognito is active, and provides labeled large keypad buttons and live error/cooldown status.
- Battery display rejects unsupported/invalid readings, preserves zero percent, annotates battery staleness, and removes telemetry from text/title/accessible label under Cognito. Hologram uses static decorative CSS/SVG with pointer and accessibility exclusion.
- Server-side dock-position validation and JSON/TOML normalization accompany the client preference.

### Recommended Actions
1. Resolve R1–R3 before approval; add integration/error-path regressions at their real boundaries.
2. Finish planned PIN-management wiring and 44px target acceptance (R4–R5).
3. Main/tester: collect focused tests for the above, TypeScript/build/lint evidence, and live dock-position lifecycle/Cognito/keyboard/touch qualification. Existing tests largely mount components in isolation; they do not prove root dispatch ownership or live terminal/Monaco continuity.

### Metrics / Coverage Limits
- Findings: critical 0; high 3; medium 2; low 1.
- Type coverage / test coverage: not measured. Lint issue total: not measured.
- Static requested-file coverage: complete. Runtime/browser/build coverage: not exercised by this reviewer.
- No source, tests, or plan/task state changed; only this review report was written.

### Unresolved Questions
None blocking interpretation of these source-backed findings. Runtime acceptance remains unverified, not presumed passing.
