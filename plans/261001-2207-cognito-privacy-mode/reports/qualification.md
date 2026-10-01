# Cognito Mode Qualification Report — Phase 05

**Date:** 2026-10-02  
**Feature:** Cognito Mode privacy screen mask  
**Scope:** Phase 05 Integrated Qualification and Smoke  
**Status:** Automated/API checks recorded; actual-app, native-shell, and planned build gates remain open

---

## 1. Test Counts Reconciliation & Execution Evidence

### 1.1 Command-by-Command Test Execution Breakdown

Evidence combines Rust/UI automated tests, a Chromium browser harness that mounts Cognito components with real xterm, and a separate live loopback REST smoke. Unit/component tests may use fixtures or mocks. The browser harness is not the full DamHopper app or a native shell; its shortcut helper dispatches synthetic keyboard events. Run-level counts include intentional overlap between focused regression commands and project-wide suites.

| Command / Suite | Scope / Target | Passed | Failed | Skipped / Ignored | Filtered | Unique vs Execution |
|---|---|---:|---:|---:|---:|---|
| `cargo test --manifest-path server/Cargo.toml cognito` | Focused Rust | 6 | 0 | 0 | 1,761 | 6 unique unit tests |
| `cargo test --manifest-path server/Cargo.toml ui_config` | Focused Rust | 18 | 0 | 0 | 1,749 | 18 unique unit tests |
| `cargo test --manifest-path server/Cargo.toml merge_global_ui_config` | Focused Rust | 5 | 0 | 0 | 1,762 | 5 unique unit tests |
| `cargo test --manifest-path server/Cargo.toml update_global_ui_at_path` | Focused Rust | 10 | 0 | 0 | 1,757 | 10 unique unit tests |
| **Focused Rust Subtotal** | **4 commands** | **39** | **0** | **0** | **7,029** | **39 unique focused tests** |
| Focused Vitest command (12 UI files) | Focused UI components | 143 | 0 | 0 | N/A | 143 unique unit tests |
| `cognito-mode.browser.tsx` (Playwright Chromium) | Real browser | 9 | 0 | 0 | N/A | 9 unique browser tests |
| Cognito browser Vitest command (post-fix rerun) | Real browser | 9 | 0 | 0 | N/A | 0 additional unique cases; 9 execution instances |
| `cargo test ... test_unmanaged_report_hook_does_not_read_open_stdin` | Backend regression | 1 | 0 | 0 | 1,766 | 1 unique regression test |
| `pnpm --filter @dam-hopper/ui test` | Full UI suite (291 files) | 2,186 | 0 | 0 | 0 | 2,186 test cases |
| `cargo test --manifest-path server/Cargo.toml` | Full backend (64 suites) | 1,761 | 0 | 6 | 0 | 1,761 test cases |
| **Total Test Executions (Across Invocations)** | **All test commands** | **4,148** | **0** | **6** | **8,795** | **Execution instances including repeated browser run** |

*Note on totals:* Across successful invocations, 4,148 test execution instances were recorded, including the secondary browser-suite pass shown above. Lint is a static analysis check (`pnpm lint`, 0 errors, 157 warnings) and is tracked separately, not counted as test execution.

---

## 2. Build and quality-check status

- No dedicated `cargo check`, UI production build, web production build, benchmark, or coverage command is recorded in the tester report. Build/typecheck status and coverage are **not measured**.
- `pnpm lint` exited 0 with **157 warnings**; this static-analysis result does not establish build status.

---

## 3. Live loopback REST smoke

The test record describes a live `dam-hopper-server` on `127.0.0.1:14806` using disposable configuration. `GET /api/global-config` returns a `GlobalConfig` object; the Cognito preference values are nested under `ui` (other response fields omitted below).

| Step | Recorded result |
|---|---|
| Initial `GET /api/global-config` | `200 OK`; `ui.cognitoModeShortcut` = `Mod+Alt+KeyB`; `ui.cognitoModeStyle` = `heavy-blur` |
| `POST /api/global-config/ui` with custom shortcut and style | `200 OK`; `{"updated": true}` |
| `GET /api/global-config` readback | `200 OK`; shortcut = `Mod+Alt+KeyK`; style = `black-screen` |
| Partial UI update using `POST /api/global-config/ui` with only the style | `200 OK`; follow-up `GET` retained `Mod+Alt+KeyK` and returned `heavy-blur` |
| Invalid style submitted to `POST /api/global-config/ui` | `400 Bad Request`; expected `heavy-blur` or `black-screen` |

Focused Rust tests separately cover snake_case TOML serialization/round-trip and partial-merge behavior. The live smoke excerpt does not record the resolved config path, raw TOML readback, or post-restart readback; the C08 restart-persistence gate is therefore incomplete. The default global path is `~/.config/dam-hopper/config.toml`, unless `XDG_CONFIG_HOME` overrides the config directory. Runtime `active` is client-memory state, not a `UiConfig` field and not persisted.

---

## 4. Scenario Matrix (C01–C16)

The results below classify the strongest evidence shown. Automated or harness-level assertions do **not** satisfy the planned interactive actual-app smoke. `NOT RUN` or `PARTIAL` means the corresponding acceptance gate is not passed.

| ID | Planned scenario | Evidence recorded | Result / boundary |
|---|---|---|---|
| **C01** | Fresh/legacy config; open Settings | Rust schema defaults and Settings component tests | **AUTOMATED ONLY** — defaults and controls are covered; no fresh/legacy full-app Settings launch. |
| **C02** | Activate from a focused real terminal | Chromium Vitest harness with real xterm | **HARNESS ONLY** — `onData` stays empty while masked; chord is dispatched as synthetic `KeyboardEvent`, not an OS key. |
| **C03** | Isolate keyboard, pointer, input, and portal consumers | Browser harness plus input-guard tests | **HARNESS / UNIT** — verifies xterm bytes, DOM input/focus, click suppression, and fixture portal behavior; not the actual app consumers. |
| **C04** | Chord repeats, modifier order, and trailing releases | Input-guard unit tests | **UNIT ONLY** — no interactive OS keyboard delivery or full-app smoke. |
| **C05** | Monaco/Settings/search, modal, and portal isolation | Browser harness generic portal fixture | **FIXTURE ONLY** — actual Monaco, Settings, search, and application menus were not mounted. |
| **C06** | Shortcut capture, cancel, blur, and reset | Settings shortcut component tests | **UNIT ONLY** — no actual application Settings smoke. |
| **C07** | Black Screen and Heavy Blur appearance | Browser class assertions and CSS inspection | **PARTIAL** — style selection is covered; no visual screenshot or unsupported-backdrop runtime simulation. |
| **C08** | Preference update, TOML readback, reload, and server restart | Live loopback REST update/readback and focused Rust config tests | **PARTIAL** — API update/readback and backend TOML serialization are covered; resolved TOML path, live file readback, and server restart are not recorded. |
| **C09** | Eligible OMP/Claude event, visible toast, expiry, and audible chime | Browser test inserts a notification fixture and calls the sound player | **FIXTURE ONLY** — toast layering and blocked click are asserted; no live agent event, timer-expiry smoke, or audible-output measurement. |
| **C10** | Background terminal counter/job continuity while masked | Code inspection and component harness | **NOT RUN** — no live PTY job/output, session identity, connection, or dimensions were observed. |
| **C11** | Preference-source/hydration change and disconnect/reconnect while active | Browser harness changes the settings store directly | **PARTIAL** — frozen-chord behavior is asserted; no profile-source hydration or disconnect/reconnect smoke. |
| **C12** | Min/default/max zoom, resize, scrolling, and mobile viewport | CSS inspection; harness default viewport is 1280×800 | **NOT RUN** — requested zoom/resize/mobile scenarios were not exercised. |
| **C13** | StrictMode/unmount/remount and reload while masked | Input-guard unit cleanup and store-default tests | **UNIT ONLY** — no full-app StrictMode or page-reload smoke. |
| **C14** | Native Browser Debug child visibility in a supported shell | `BrowserDebugKeepAliveHost.test.tsx` with a test host | **NATIVE SMOKE NOT RUN** — test asserts the host call `setViewport(null)`; no native OS child-window observation. |
| **C15** | Activation while iframe/native child owns keyboard focus | Documented scope boundary | **DOC ONLY** — no foreign-frame or native-focus runtime scenario. |
| **C16** | Unsupported backdrop-filter and reduced-motion behavior | CSS inspection | **SOURCE INSPECTION ONLY** — no unsupported-feature or reduced-motion browser simulation. |

---

## 5. Documentation Review

- **System architecture:** Describes client-memory state, root capture guard, inert content boundary, toast layering, Browser Debug visibility contract, and visual/privacy limits. It distinguishes host-component behavior from native-shell qualification.
- **API reference:** Documents `GET /api/global-config`, sparse `POST /api/global-config/ui` updates, camelCase JSON, snake_case TOML, defaults, invalid-style response, and the fact that activation is not a config field.
- **Configuration guide:** Confirms canonical preference names/defaults and Settings paths; clarifies that audible output depends on browser/device state and the mask is not redaction or OS capture protection.
- **Changelog:** Records automated/REST evidence and the outstanding actual-app, PTY, audio, viewport, and native-shell gates without claiming full C01–C16 qualification.
- **Codebase summary:** Updates the Cognito module map and points readers to the qualification boundary.

---

