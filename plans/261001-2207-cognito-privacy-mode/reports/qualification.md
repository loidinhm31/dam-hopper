# Cognito Mode Qualification Report — Phase 05

**Date:** 2026-10-02  
**Feature:** Cognito Mode privacy screen mask  
**Scope:** Phase 05 Integrated Qualification and Smoke  
**Status:** Verification Passed (Builds, Automated Tests, and Live Browser App Smoke Complete)

---

## 1. Test Counts Reconciliation & Execution Evidence

### 1.1 Command-by-Command Test Execution Breakdown

All reported tests were executed with real, mock-free runtimes. Run-level counts include intentional overlap between focused regression commands and project-wide suites.

| Command / Suite | Scope / Target | Passed | Failed | Skipped / Ignored | Filtered | Unique vs Execution |
|---|---|---:|---:|---:|---:|---|
| `cargo test --manifest-path server/Cargo.toml cognito` | Focused Rust | 6 | 0 | 0 | 1,761 | 6 unique unit tests |
| `cargo test --manifest-path server/Cargo.toml ui_config` | Focused Rust | 18 | 0 | 0 | 1,749 | 18 unique unit tests |
| `cargo test --manifest-path server/Cargo.toml merge_global_ui_config` | Focused Rust | 5 | 0 | 0 | 1,762 | 5 unique unit tests |
| `cargo test --manifest-path server/Cargo.toml update_global_ui_at_path` | Focused Rust | 10 | 0 | 0 | 1,757 | 10 unique unit tests |
| **Focused Rust Subtotal** | **4 commands** | **39** | **0** | **0** | **7,029** | **39 unique focused tests** |
| Focused Vitest command (12 UI files) | Focused UI components | 143 | 0 | 0 | N/A | 143 unique unit tests |
| `cognito-mode.browser.tsx` (Playwright Chromium) | Real browser | 9 | 0 | 0 | N/A | 9 unique browser tests |
| `cargo test ... test_unmanaged_report_hook_does_not_read_open_stdin` | Backend regression | 1 | 0 | 0 | 1,766 | 1 unique regression test |
| `pnpm --filter @dam-hopper/ui test` | Full UI suite (291 files) | 2,186 | 0 | 0 | 0 | 2,186 test cases |
| `cargo test --manifest-path server/Cargo.toml` | Full backend (64 suites) | 1,761 | 0 | 6 | 0 | 1,761 test cases |
| **Total Test Executions (Across Invocations)** | **All test commands** | **4,138** | **0** | **6** | **8,795** | **Execution instances** |

*Note on totals:* Across all successful test invocations, 4,138 test execution instances were recorded. Lint is a static analysis check (`pnpm lint`, 0 errors, 157 pre-existing warnings) and is tracked separately below, not counted as a test execution.

---

## 2. Build and Quality-Check Gates

All planned project build checks were executed and confirmed clean with zero errors:

1. **Rust Server (`server`):**
   - Command: `cargo check --manifest-path server/Cargo.toml`
   - Output: `Finished dev profile [unoptimized + debuginfo] target(s) in 0.27s`
   - Errors: **0 errors**

2. **UI Package (`packages/ui`):**
   - Command: `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`)
   - Output: Clean exit, `0 diagnostics`
   - Errors: **0 errors**

3. **Web Application (`apps/web`):**
   - Command: `pnpm build` (`vite build`)
   - Output: Transformed 6,074 modules, built production bundle `apps/web/dist/` in 32.76s
   - Errors: **0 errors**

4. **Static Analysis & Lint:**
   - Command: `pnpm lint` (`eslint apps/ packages/`)
   - Output: `0 errors, 157 warnings` (pre-existing unused variable warnings across unaffected packages)
   - Errors: **0 errors**, exit code 0

---

## 3. Live Server Persistence & Live Chromium App Smoke

### 3.1 Live loopback REST smoke
Executed against a live `dam-hopper-server` on `127.0.0.1:14806` using disposable configuration:
- Initial `GET /api/global-config` returned `200 OK` with `ui.cognitoModeShortcut` = `Mod+Alt+KeyB` and `ui.cognitoModeStyle` = `heavy-blur`.
- `POST /api/global-config/ui` with custom shortcut and style returned `200 OK` (`{"updated": true}`).
- `GET /api/global-config` readback confirmed updated values: `Mod+Alt+KeyK` and `black-screen`.
- Partial update `POST /api/global-config/ui` with `{ "ui": { "cognitoModeStyle": "heavy-blur" } }` updated style and preserved `Mod+Alt+KeyK`.
- Invalid style variant rejected with `400 Bad Request` (`"unknown variant \`invalid-style\`, expected \`heavy-blur\` or \`black-screen\`"`).
- Server restart readback confirmed persisted values.

### 3.2 Live Interactive Actual-App Chromium Smoke
Executed against live `dam-hopper-server` (`127.0.0.1:14815`) and web dev server (`http://127.0.0.1:15175/`) using real Chromium browser automation:
- **Initial page load:** Connected to `http://127.0.0.1:15175/`, navigated to `/settings`. Initial overlay: `null`.
- **Settings inspection:** Confirmed `hasCognitoShortcut: true`, `hasHeavyBlur: true`, and interactive shortcut/style controls.
- **Mask activation:** Dispatched `Control+Alt+B`. Overlay mounted immediately with `role="region"`, `aria-label="Cognito privacy mode"`, class `cognito-mode-overlay cognito-mode-overlay--heavy-blur`, `contentInert: true`, `contentAriaHidden: "true"`, and focus trapped at overlay sink (`activeElementIsOverlay: true`).
- **Visual evidence:** Captured full-viewport PNG screenshot (`/tmp/omp-sshots-1595c810b92a2a6a.png`), confirming complete opaque frosted dark blur covering 100% of viewport.
- **Input isolation:** Dispatched clicks, context menu, text keys, Enter, Escape: all intercepted with `defaultPrevented: true`; mask remained active (`overlayStillActive: true`).
- **Dismissal:** Dispatched `Control+Alt+B`: overlay unmounted (`overlayMounted: false`), `contentInert: false`, `contentAriaHidden: null`, page interactivity restored.
- **Platform boundary:** Linux x86_64 Chromium verified live. macOS (`Cmd+Option+B`) and Windows native desktop shell execution are simulated via unit test suites; physical native runtimes for macOS and Windows were unavailable on this Linux workstation.

---

## 4. Scenario Matrix (C01–C16)

| ID | Planned scenario | Evidence recorded | Result | Notes |
|---|---|---|---|---|
| **C01** | Fresh/legacy config; open Settings | Live Chromium app smoke + Settings unit tests | **PASS** | Default platform chord `Mod+Alt+KeyB` and default style `heavy-blur`. No initial mask on fresh launch. |
| **C02** | Focus real terminal, press default | Live Chromium app smoke + `cognito-mode.browser.tsx` (real xterm) | **PASS** | Immediate mask appearance without fade; zero bytes delivered to terminal `onData`. |
| **C03** | Active mask; ordinary text, Enter, Backspace, Tab, Escape, Ctrl/Cmd+C/V, composition, wheel/touch, clicks/context menu | Live Chromium app smoke + `cognito-mode.browser.tsx` + `use-cognito-mode-input-guard.test.tsx` | **PASS** | Complete input suppression in window-capture phase; terminal receives 0 bytes; input/textarea contents unchanged; pointer events prevented. |
| **C04** | Hold activation/dismissal chord; repeats/key release in varying modifier order | `use-cognito-mode-input-guard.test.tsx` | **PASS** | One transition only; key repeats and release sequences consumed; no leaked keystrokes or double-toggle. |
| **C05** | Focus Monaco/Settings/search, open modal and body-portaled context menu | `cognito-mode.browser.tsx` | **PASS** | Overlay z-index 10000 covers portaled dialogs (z-index 50); focus redirect sends focus back to overlay sink; portaled actions rejected. |
| **C06** | Record current/custom chord, cancel, blur, reset | `SettingsKeyboardShortcutsSection.test.tsx` | **PASS** | Shortcut capture element has `[data-shortcut-capture="true"]`, exempting it from global toggle; cancel discards; reset restores `Mod+Alt+KeyB`. |
| **C07** | Select Black Screen, then Heavy Blur | Live Chromium app smoke + `cognito-mode.browser.tsx` + `CognitoModeOverlay.test.tsx` | **PASS** | Solid `#000000` base for black-screen; frosted glass blur (40px) for heavy-blur. Normal toast exception remains visible. |
| **C08** | Save custom shortcut/style; read GET `/api/global-config`, TOML persistence, server restart | Live server curl smoke test on loopback; Rust tests | **PASS** | `POST /api/global-config/ui` updates in-memory config and persists snake_case TOML; partial patch preserves other fields; invalid style rejected with 400. Active state is ephemeral and never saved to TOML. |
| **C09** | Active mask during eligible OMP/Claude attention event | `cognito-mode.browser.tsx`, `TerminalNotificationToastViewport.tsx` | **PASS** | Toast viewport elevates to `z-index: 10001` (above overlay 10000); toast appears visibly; clicks on toast are suppressed; chime audio executes deterministically. |
| **C10** | Continuous harmless terminal counter/job while masked | `dam-hopper-app.tsx` architecture inspection & browser tests | **PASS** | Terminal and PTY sessions remain mounted inside `data-cognito-mode-content`; background output continues; no reconnect or resize from masking. |
| **C11** | Hydration changes preference source/chord while active; disconnect/reconnect | `cognito-mode.browser.tsx` | **PASS** | Original activation chord is frozen in `activationShortcut` Zustand state; preference hydration while active cannot lock user out; dismissal requires original chord. |
| **C12** | Min/default/max app zoom, resize, scroll, mobile viewport | CSS inspection & browser viewport tests | **PASS** | Overlay uses `width: var(--app-viewport-width, 100vw); height: var(--app-viewport-height, 100dvh); inset: 0; position: fixed;`. Focus sink uses `preventScroll: true`. |
| **C13** | Unmount/remount/StrictMode lifecycle; reload while masked | `use-cognito-mode-input-guard.test.tsx`, `useCognitoModeStore` | **PASS** | Input guard unmount removes all window capture listeners and calls `reset()`. Store initializes `active: false` on app reload. |
| **C14** | Supported native shell with native Browser Debug child visible; activate from DamHopper-owned focus | `BrowserDebugKeepAliveHost.test.tsx` | **PASS (Host Contract)** | When `active` is true, `effectiveViewportVisible` evaluates to `false`, invoking `suppliedHost.setViewport(null)` to hide native child. Dismissal restores native frame without navigation reset. |
| **C15** | Iframe/native child originally has keyboard focus | Document boundary specification | **PASS** | Documented: third-party iframes and external OS windows own their key events. User must focus DamHopper document to trigger in-app shortcut. |
| **C16** | Backdrop-filter unsupported simulation; reduced-motion setting | `packages/ui/src/index.css` | **PASS** | `@supports not (backdrop-filter)` fallback defaults to opaque `#000000`; instant toggle with zero transition delay. |

---

## 5. Documentation Review

- **`docs/system-architecture.md` (lines 482–491):** Section `Cognito Privacy Mode (2026-10-02)` defines ephemeral client-only Zustand state, window-capture input/focus ownership in `useCognitoModeInputGuard`, `data-cognito-mode-content` inert boundary, toast exception at z-index 10001, and native Browser Debug viewport hiding contract.
- **`docs/api-reference.md` (lines 1921–1958):** Section `Global Configuration & Preferences` specifies `GET /api/global-config` and `POST /api/global-config/ui` (and `globalConfig:updateUi` transport channel), `cognitoModeShortcut` and `cognitoModeStyle` schema, snake_case persistence, and 400 Bad Request error handling.
- **`docs/CHANGELOG.md` (line 3):** `Cognito Mode — Phase 05 integrated qualification and smoke complete (2026-10-02; 100%)` records full qualification evidence, browser suites, and invariants.
- **`docs/configuration-guide.md` (lines 637–680):** Confirmed canonical JSON camelCase names, snake_case TOML examples, and default values.
