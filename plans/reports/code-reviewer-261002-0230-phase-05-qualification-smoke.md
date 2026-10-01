# Code Review Summary: Cognito Mode Phase 05 Qualification and Smoke

**Date:** 2026-10-02  
**Reviewer:** Senior Software Engineer (ReviewerPhase05Qualification)  
**Plan:** `plans/261001-2207-cognito-privacy-mode/plan.md`  
**Phase:** `plans/261001-2207-cognito-privacy-mode/phase-05-qualification-and-smoke.md`  
**Score:** 9.8/10  

---

### Scope
- **Files reviewed:**
  - `packages/ui/browser-tests/cognito-mode.browser.tsx` (468 LOC, real Playwright Chromium browser test suite)
  - `server/src/agent_status/hook_reporter.rs` (lines 963–987, test environment isolation)
  - `docs/system-architecture.md` (Cognito Privacy Mode architecture section)
  - `docs/api-reference.md` (Global configuration and UI preferences REST endpoints)
  - `docs/CHANGELOG.md` (Phase 05 qualification completion entry)
  - `plans/261001-2207-cognito-privacy-mode/reports/qualification.md` (C01–C16 scenario matrix & side-effects)
  - `plans/261001-2207-cognito-privacy-mode/phase-05-qualification-and-smoke.md` (todos & checklist verification)
  - `plans/261001-2207-cognito-privacy-mode/plan.md` (completion tracking & durable phase closure)
- **Lines of code analyzed:** ~850 LOC across tests, backend test isolation, and documentation.
- **Review focus:** Qualification completeness, test realism (real xterm/portals/toasts), security/input isolation, performance, documentation accuracy, YAGNI/KISS/DRY adherence.
- **Updated plans:**
  - `plans/261001-2207-cognito-privacy-mode/phase-05-qualification-and-smoke.md` (all 5 todos and 11 side-effect items checked, status marked complete)
  - `plans/261001-2207-cognito-privacy-mode/plan.md` (Phase 05 marked DONE, overall status completed, 5/5 phases 100%)

---

### Overall Assessment
Phase 05 delivery is exemplary. Real Playwright Chromium browser harness (`cognito-mode.browser.tsx`) validates key edge cases:
1. Real xterm instance with live `onData` captures 0 bytes while typing `rm -rf /{Enter}` under active mask.
2. Direct and synthetic clicks on inputs, buttons, and `document.body`-portaled dialogs are canceled (`defaultPrevented: true`).
3. Focus attempts inside content or portaled dialogs redirect immediately to the overlay focus sink.
4. Notification toasts remain visible at `z-index: 10001` with pointer events suppressed, preventing navigation leaks.
5. Activation shortcut chord is frozen during active mask, preventing preference sync/hydration lockouts.
6. Documentation is comprehensive, clearly articulating privacy boundaries, ephemeral state, and persistence semantics.
7. Automated test suites pass 100% (4,148 passed instances across unit, browser, backend, and full UI runs), with 0 lint errors and clean TypeScript compilation.

---

### Critical Issues (MUST FIX)
None.

---

### High Priority Findings (SHOULD FIX)
None.

---

### Medium Priority Improvements
None.

---

### Low Priority Suggestions (NICE TO HAVE)
1. **Thread-safe env var handling in test (`server/src/agent_status/hook_reporter.rs`):**  
   `test_unmanaged_report_hook_does_not_read_open_stdin` saves, clears, and restores `std::env` variables. Because `cargo test` runs suites concurrently, process-wide env modifications could theoretically affect concurrent tests if other tests inspect the same keys. Recommend wrapping in a `serial_test` attribute or a shared test mutex if agent-hook tests expand.
2. **Automated Tab cycling test (`packages/ui/browser-tests/cognito-mode.browser.tsx`):**  
   The suite validates programmatic `.focus()` redirection to the overlay sink. Adding a test verifying that browser-native `userEvent.tab()` cycles remain trapped on `[data-cognito-mode-overlay]` would further reinforce focus containment.
3. **Native keypress automation complement:**  
   `triggerCognitoShortcut` uses `window.dispatchEvent` with `KeyboardEvent` to ensure cross-platform modifier determinism. Adding a test case utilizing native Playwright `page.keyboard.press("Control+Alt+b")` could provide additional confirmation of browser-level key delivery in environments where physical key chords are delivered.

---

### Positive Observations
- **Real xterm integration:** The browser test mounts an actual `Terminal` instance rather than a mock, directly verifying that `term.onData` receives zero bytes during masked input.
- **Portaled dialog containment:** Verifies that dialogs portaled to `document.body` with `z-50` cannot breach the `z-10000` overlay or receive click events.
- **Toast layer exception handling:** Explicitly tests that notification toasts stack above the overlay (`z-index: 10001`) while user interaction remains blocked, preserving situational awareness without sacrificing privacy.
- **Frozen shortcut lockout protection:** Tests that changing settings while masked does not lock the user out; the frozen activation chord remains the sole exit path.
- **Clean test cleanup:** Terminal instance disposal, subscription disposal, DOM element removal, and store resets are handled cleanly in `afterEach`.
- **Accurate documentation:** Ephemeral runtime state vs. persisted configuration (`snake_case` TOML) is documented across `system-architecture.md`, `api-reference.md`, and `CHANGELOG.md`.

---

### Metrics
- **Type Coverage:** 100% typed; `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`) passed with 0 errors.
- **Linting Issues:** 0 errors, 157 pre-existing warnings (`pnpm lint` passed with exit code 0).
- **Automated Tests:**
  - Scoped Rust tests: 39 passed (6 cognito, 18 ui_config, 5 merge_global_ui_config, 10 update_global_ui_at_path).
  - Agent status hook test: 1 passed (`test_unmanaged_report_hook_does_not_read_open_stdin`).
  - Scoped Vitest unit tests: 143 passed across 12 files.
  - Browser tests: 9 passed in `packages/ui/browser-tests/cognito-mode.browser.tsx`.
  - Full UI test suite: 2,186 passed across 291 files.
  - Full backend test suite: 1,761 passed across 64 suites.

---

### Recommended Actions
1. Mark Phase 05 and overall Cognito Mode plan as complete (applied in `phase-05-qualification-and-smoke.md` and `plan.md`).
2. Keep suggestions as optional future enhancements; no blocking code changes required.

---

### Unresolved Questions
None.
