# UI Compile, Build & Unit Regression Verification Report: Cloudflared Persistence & Reminder

**Date:** 2026-10-07
**Branch:** `feat/cloudflared-persistence-reminder`
**Scope:** UI Typecheck, Web Production Build, Scoped ESLint, Focused Tunnel/Ports/Runtime Unit Tests, Broader UI Suite, Rustfmt Check.
**Target Output Artifacts:** `apps/web/dist`

---

## 1. Test Results Overview

| Scope | Test Files | Total Tests | Passed | Failed | Skipped | Status |
|---|---|---|---|---|---|---|
| **Targeted Persistence & Reminder UI Suites** | 9 | 57 | 57 | 0 | 0 | **PASS** |
| **Broader `@dam-hopper/ui` Unit Suite** | 324 | 1,460+ | 323 files | 1 file | 0 | **FAIL (1 outdated test mock)** |

### Breakdown of Targeted Suites
- `src/lib/tunnel-reminder-dismissal.test.ts`: 3 passed (profile isolation, session storage restoration, in-memory fallback)
- `src/hooks/use-tunnel-reminders.test.tsx`: 9 passed (REST catchup, dismiss without stop, stale/generation filtering, disconnect handling, cache eviction, multi-profile stop isolation, delayed stop race, deferred GET vs reminder race, deferred GET vs stop race)
- `src/components/organisms/TunnelReminderBanner.test.tsx`: 2 passed (Cognito mode invisibility/inertness, stopTunnel error presentation)
- `src/hooks/use-ports.test.ts`: 3 passed (PTY age boundary, delayed rediscovery rejection, cross-profile incarnation isolation)
- `src/components/organisms/PortsPanel.test.tsx`: 3 passed (embedded browser action, absence without callback, origin-untracked tunnel URL/Stop retention)
- `src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx`: 4 passed (compact vs desktop trigger, diagnostics routing, browser action forwarding)
- `src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx`: 16 passed (all status states, leaf matching, click routing, embedded browser chip)
- `src/hooks/use-browser-debug.test.ts`: 14 passed
- `src/lib/browser-debug-origin.test.ts`: 3 passed

---

## 2. Coverage Metrics

Targeted suites execute critical paths for:
- Tunnel reminder dismissal uses the actual `dam-hopper:tunnel-reminders:dismissed:v1` sessionStorage array, keyed per profile and tunnel.
- Cache invalidation and generation matching (`use-tunnel-reminders.ts`, `tunnel-cache-events.ts`).
- Untracked origin port/tunnel display and embedded browser launch routing (`PortsPanel.tsx`, `TerminalRuntimeNavigatorItem.tsx`).
- Incarnation and owner filtering (`use-ports.ts`, `acceptsDetectedPortEvent`).
- CSS viewport constraints were included in the successful bundle; unit suites do not prove actual geometry. Parent separately exercised rebuilt-browser dimensions and screenshots.

---

## 3. Failed Tests Analysis

### Failure: `src/embed/dam-hopper-app.test.tsx`
- **Command:** `pnpm --filter @dam-hopper/ui test`
- **Test:** `DamHopperApp Cognito Mode root boundary > mounts data-cognito-mode-content boundary and toggles inert when cognito active`
- **Error Stack:**
  ```text
  Error: [vitest] No "getProfiles" export is defined on the "@/api/server-config.js" mock. Did you forget to return it from "vi.mock"?
   ❯ useTunnelReminders src/hooks/use-tunnel-reminders.ts:66:5
       64|   const profiles = useSyncExternalStore(
       65|     subscribeToProfileChanges,
       66|     getProfiles,
       67|     getEmptyProfiles,
       68|   );
   ❯ TunnelReminderBanner src/components/organisms/TunnelReminderBanner.tsx:11:54
   ❯ DamHopperApp src/embed/dam-hopper-app.tsx:288:9
  ```
- **Root Cause Classification:** Outdated test mock assumption (NOT production code bug).
- **Details:** `DamHopperApp` renders `TunnelReminderBanner` at root. `TunnelReminderBanner` calls `useTunnelReminders`, subscribing to `getProfiles`. `dam-hopper-app.test.tsx` defines a manual mock `vi.mock("@/api/server-config.js")` that predates reminder support and did not mock `getProfiles`. Adding `getProfiles: () => []` to the test mock resolves the test without altering application code.

### Prior Test Wording Bug (Cleaned Up by Parent)
- `src/components/organisms/TerminalRuntimeNavigatorItem.test.tsx`: An experimental 17th test attempted `const { container } = renderItem(...)` where `renderItem` returns `void`. Removed in freeze; all 16 valid behavior tests pass.

---

## 4. Performance Metrics

- **Web Production Build (`pnpm build`):**
  - Initial run: 65.05s
  - Second run: 45.12s
  - Final post-CSS run: 37.47s
- **Targeted Vitest Suite (9 test files, 57 tests):** 1.39s duration (2.05s wall time)
- **UI Typecheck (`tsc -p tsconfig.json`):** 10.32s
- **Full UI Test Suite (324 files):** 28.37s duration (29.17s wall time)
- **Slow tests identified:** None; all individual test cases ran < 110ms.

---

## 5. Build & Typecheck Status

### 1. UI TypeScript Compilation (`@dam-hopper/ui`)
- **Command:** `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`)
- **Result:** **SUCCESS (Exit Code 0)**, 0 errors.

### 2. Root Web Production Bundle (`@dam-hopper/web`)
- **Command:** `pnpm build` (`pnpm --filter @dam-hopper/web build`)
- **Result:** **SUCCESS (Exit Code 0)**. Built in 37.47s.
- **Artifacts:** Verified staged `dam-hopper-browser-debug.zip` and production assets in `apps/web/dist` (HTML, JS, CSS, Monaco/Xterm chunks). Web ready for runtime smoke.

### 3. Scoped ESLint
- **Command:** `pnpm exec eslint <19 changed UI files>`
- **Result:** **SUCCESS (Exit Code 0)**: 0 errors, 12 warnings.
  - Warnings comprise unused imports in `dam-hopper-app.tsx` and standard `react-hooks/exhaustive-deps` suggestions in `use-ports.ts`, `use-tunnel-reminders.ts`, `use-tunnels.ts`.

### 4. Rustfmt Check (Report Only)
- **Command:** `cd server && cargo fmt --check`
- **Result:** **FAIL (Exit Code 1)** due to existing diffs across whole repo.
- **Command:** `rustfmt --edition 2021 --check server/src/...`
- **Result:** Diff reported in `server/src/main.rs:186,198,216`. No source edits applied per instructions.

---

## 6. Critical Issues

No additional production issue identified by this validation slice. Targeted tests passed; the broader suite needs the root mock update below. Browser/connector qualification belongs to the parent runtime evidence, not this report.

---

## 7. Recommendations

1. **Update `dam-hopper-app.test.tsx` mock:** Add `getProfiles: vi.fn(() => [])` to `vi.mock("@/api/server-config.js")` so DamHopperApp root component mount tests pass in full CI.
2. **ESLint cleanup:** Remove unused imports (`useQuery`, `getServerUrl`, etc.) in `packages/ui/src/embed/dam-hopper-app.tsx` and unused variable `localServer` in `PortsPanel.tsx`.
3. **Format server files:** Run `cargo fmt` specifically on `server/src/main.rs` if branch hygiene gate requires it before merge.

---

## 8. Next Steps

1. Runtime smoke testing with `apps/web/dist`.
2. Update `dam-hopper-app.test.tsx` server-config mock in follow-up integration pass.
3. Verify e2e smoke against running server.

---

## Unresolved Questions

- Validation slice completed; broader root mock correction and runtime verification remain parent integration work at this report's publication.
