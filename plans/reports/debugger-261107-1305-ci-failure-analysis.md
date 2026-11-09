# CI Failure Diagnostic Report — Run `42331116964` (`PR Quality Gate` #83)

- **Run URL:** https://github.com/loidinhm31/dam-hopper/actions/runs/42331116964
- **Branch / PR:** `feat/ai-os-redesign` (PR #83, merge ref `98adbe99b5e76ffada6ceef8b967aa96dafd4183`, HEAD `d39ee81245807abbd5f51de88e1d547db8657fba`)
- **Workflow:** `.github/workflows/pr-quality-gate.yml`

---

## Executive Summary

4 independent quality jobs failed in run `42331116964` (causing the downstream `Quality Gate` aggregator job to fail):

1. **`Lint, typecheck, and frontend builds` (`static_build`)** — `Lint workspace` (`pnpm lint`) failed with **3 ESLint `react-hooks/immutability` errors** in `packages/ui/src/os/LockScreenOverlay.tsx:73-75` (`onTrailingKeyDown`, `onTrailingKeyUp`, `onTrailingBlur` accessed inside `removeTrailingGuard` before declaration).
2. **`JS tests - ui` (`js_tests` matrix `ui`)** — `Run ui tests` (`pnpm --filter @dam-hopper/ui test`) failed on **1 unit test** in `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx:1476:33` querying removed inline disclosure button `button[aria-label="Collapse demo files"]`.
3. **`Rust server - Windows` (`server_windows`)** — `Compile all server tests` (`cargo test --manifest-path server/Cargo.toml --no-run`) failed with **3 Windows-only (`#[cfg(windows)]`) compiler errors**: `error[E0609]` in `server/src/api/terminal.rs:862` (`error.0` on enum `ApiError`) and two `error[E0063]` in `server/src/config/tests.rs:635,697` (missing `ui` and `workspaces` fields on `DamHopperConfig`).
4. **`Application E2E journeys` (`application_e2e`)** — `Run application E2E tests` (`pnpm --filter @dam-hopper/ui test:e2e`) failed on **1 Playwright spec** (`packages/ui/e2e/os-cutover/os-cutover.spec.ts:56:28`, skipping serial test 2 at line 104) because `AgentHubApp.tsx` replaced `data-os-agent-hub` and legacy card-roster scope filter buttons (`agent-hub-filter-all`, `agent-hub-filter-agents`, `agent-hub-filter-background`) in `a1fae3fe` without updating `os-cutover.spec.ts`.

---

## 1. Failed Jobs & Steps

| Job Name | Job ID | Failed Step | Command | Exit Code |
| --- | --- | --- | --- | --- |
| `Lint, typecheck, and frontend builds` | `128277611138` | `Lint workspace` | `pnpm lint` | `1` |
| `JS tests - ui` | `128277611216` | `Run ui tests` | `pnpm --filter @dam-hopper/ui test` | `1` |
| `Rust server - Windows` | `128277611125` | `Compile all server tests` | `cargo test --manifest-path server/Cargo.toml --no-run` | `1` |
| `Application E2E journeys` | `128277611012` | `Run application E2E tests` | `pnpm --filter @dam-hopper/ui test:e2e` | `1` |
| `Quality Gate` | `128281357687` | `Require every quality job` | Aggregator gate check | `1` |

*(Note: In `Lint, typecheck, and frontend builds`, steps `Typecheck and build shared packages`, `Typecheck and build browser extension`, and `Build web app` did not run because `Lint workspace` failed first. In `Rust server - Windows`, steps `Run Windows-safe server regressions` and `Check all server targets` did not run because `Compile all server tests` failed first.)*

---

## 2. Exact Error Messages & Stack Traces / Compiler Errors

### Failure A: `Lint, typecheck, and frontend builds` → `Lint workspace`

```text
/home/runner/work/dam-hopper/dam-hopper/packages/ui/src/os/LockScreenOverlay.tsx
  73:45  error  Error: Cannot access variable before it is declared
  `onTrailingKeyDown` is accessed before it is declared, which prevents the earlier access from updating when this value changes over time. (react-hooks/immutability)
  74:43  error  Error: Cannot access variable before it is declared
  `onTrailingKeyUp` is accessed before it is declared, which prevents the earlier access from updating when this value changes over time. (react-hooks/immutability)
  75:42  error  Error: Cannot access variable before it is declared
  `onTrailingBlur` is accessed before it is declared, which prevents the earlier access from updating when this value changes over time. (react-hooks/immutability)

✖ 395 problems (3 errors, 392 warnings)
```

### Failure B: `JS tests - ui` → `Run ui tests`

```text
FAIL  src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx > TraditionalTerminalProjectsNavigator > Workspace rows & open picker integration (Phase 05) > forwards disclosure state and toggle action to workspace rows
AssertionError: expected null not to be null
 ❯ src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx:1476:33
    1473|       const disclosureBtn = container.querySelector<HTMLButtonElement>(
    1474|         'button[aria-label="Collapse demo files"]',
    1475|       )!;
    1476|       expect(disclosureBtn).not.toBeNull();
        |                                 ^
    1477|       expect(disclosureBtn.getAttribute("aria-expanded")).toBe("true");

Test Files  1 failed | 376 passed (377)
     Tests  1 failed | 3620 passed (3621)
```

### Failure C: `Rust server - Windows` → `Compile all server tests`

```text
error[E0609]: no field `0` on type `ApiError`
   --> src\api\terminal.rs:862:78
    |
862 |             .unwrap_or_else(|error| panic!("Windows cwd fallback: {}", error.0));
    |                                                                              ^ unknown field

error[E0063]: missing fields `ui` and `workspaces` in initializer of `DamHopperConfig`
   --> src\config\tests.rs:635:18
    |
635 |     let config = DamHopperConfig {
    |                  ^^^^^^^^^^^^^^^ missing `ui` and `workspaces`

error[E0063]: missing fields `ui` and `workspaces` in initializer of `DamHopperConfig`
   --> src\config\tests.rs:697:18
    |
697 |     let config = DamHopperConfig {
    |                  ^^^^^^^^^^^^^^^ missing `ui` and `workspaces`

error: could not compile `dam-hopper-server` (lib test) due to 3 previous errors; 33 warnings emitted
```

### Failure D: `Application E2E journeys` → `Run application E2E tests`

```text
  1) [chromium] › e2e/os-cutover/os-cutover.spec.ts:15:3 › DamHopper OS Root Cutover, Hub Inventory & Close Guard Journey › qualifies root cutover, legacy route translation, inventory-first Hub, beside intent, and shared Close prompt

    Error: expect(locator).toBeVisible() failed

    Locator: locator('[data-os-agent-hub]').first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

      54 |
      55 |     const agentHub = page.locator("[data-os-agent-hub]").first();
    > 56 |     await expect(agentHub).toBeVisible({ timeout: 10_000 });
         |                            ^
      57 |
      58 |     // 5. Test Scope Filters: All / Agents / Background
      59 |     const filterAll = agentHub.locator('[data-testid="agent-hub-filter-all"]').first();
        at /home/runner/work/dam-hopper/dam-hopper/packages/ui/e2e/os-cutover/os-cutover.spec.ts:56:28

  1 failed
    [chromium] › e2e/os-cutover/os-cutover.spec.ts:15:3 › DamHopper OS Root Cutover, Hub Inventory & Close Guard Journey › qualifies root cutover, legacy route translation, inventory-first Hub, beside intent, and shared Close prompt
  1 did not run
  11 passed (2.2m)
```

---

## 3. Root Cause Analysis

### Root Cause A: `packages/ui/src/os/LockScreenOverlay.tsx:71-101`
- Introduced in commit `f2f87201` (`feat(os): add agent hub git float, 4-way dock, battery telemetry, hologram home, and pin lock screen`).
- `removeTrailingGuard` (lines 71–78) is declared before `onTrailingKeyDown` (line 80), `onTrailingKeyUp` (line 87), and `onTrailingBlur` (line 98), while `onTrailingKeyUp` and `onTrailingBlur` depend on `[removeTrailingGuard]`.
- `eslint-plugin-react-hooks` (`react-hooks/immutability`) flags accessing `const` hook variables (`onTrailingKeyDown`, `onTrailingKeyUp`, `onTrailingBlur`) inside `removeTrailingGuard` prior to their lexical declaration.

### Root Cause B: `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx:1463-1481`
- In commit `a1fae3fe` (`feat(agent-hub): implement terminal-first workspace with diff viewer and short integer tab IDs`), the project file tree was relocated from inline left-sidebar row expansion to the right-sidebar panel, and per-row disclosure buttons (`button[aria-label="Collapse <project> files"]`) were removed from `TraditionalTerminalProjectWorkspaceRow.tsx` (explicitly tested in `TraditionalTerminalProjectWorkspaceRow.test.tsx:136-152`: `"does not render disclosure chevron button on project row"`).
- In `TraditionalTerminalProjectWorkspaceRow.tsx:263`, `isDisclosed` now controls whether an inactive row (`isActive === false`) renders the worktree selector (`[role="combobox"]`) and commit chip (`[aria-label^="Commit "]`).
- However, `TraditionalTerminalProjectsNavigator.test.tsx:1463-1481` still queries `button[aria-label="Collapse demo files"]`, which returns `null`.

### Root Cause C: `server/src/api/terminal.rs:862` and `server/src/config/tests.rs:635,697`
- **Issue 1 (`server/src/api/terminal.rs:862`):** `ApiError` in `server/src/api/error.rs:11-41` was refactored from a tuple struct `ApiError(pub AppError)` into an enum `pub enum ApiError { App(AppError), Custom { ... } }` implementing `std::fmt::Display`. The Windows-only test `windows_default_terminal_cwd_is_an_existing_directory` (`#[cfg(all(test, windows))]`) still accessed `error.0`.
- **Issue 2 (`server/src/config/tests.rs:635,697`):** `DamHopperConfig` in `server/src/config/schema.rs:670-684` added `pub ui: Option<UiConfig>` and `pub workspaces: Option<Vec<KnownWorkspace>>`. Two `#[cfg(windows)]` unit tests (`write_config_escapes_native_windows_absolute_project_paths` at line 635 and `config_roundtrip_preserves_unc_project_paths` at line 697) were not updated with `ui: None, workspaces: None,`.
- Because both modules are gated by `#[cfg(windows)]`, Linux `cargo test` skipped compiling them.

### Root Cause D: `packages/ui/e2e/os-cutover/os-cutover.spec.ts:55-73,122-123` and `packages/ui/src/os/apps/AgentHubApp.tsx:175-178`
- In commit `a1fae3fe`, `AgentHubApp.tsx` replaced the card-roster UI (`data-os-agent-hub={window.id}` and scope filter buttons `data-testid="agent-hub-filter-all"`, `data-testid="agent-hub-filter-agents"`, `data-testid="agent-hub-filter-background"`) with the terminal-first workspace (`data-testid="agent-hub-app"`, `AgentHubHeader`, and `TraditionalTerminalProjectsDisplay`).
- As enforced in `packages/ui/browser-tests/os-agent-hub.browser.tsx:188-193`, the card roster and scope filter pills were intentionally removed in Phase 01–07 (`B4`).
- `packages/ui/e2e/os-cutover/os-cutover.spec.ts` was not updated to match the new `AgentHubApp` DOM contract:
  1. Lines 55 and 122 query `page.locator("[data-os-agent-hub]").first()`, whereas `AgentHubApp.tsx:176` only sets `data-testid="agent-hub-app"`.
  2. Lines 58–73 click `[data-testid="agent-hub-filter-all"]`, `[data-testid="agent-hub-filter-agents"]`, and `[data-testid="agent-hub-filter-background"]`, which no longer exist in `AgentHubApp`.

---

## 4. Proposed Minimal Fixes

### Fix 1: `packages/ui/src/os/LockScreenOverlay.tsx` (lines 61–115)
Store a cleanup callback in a `useRef<(() => void) | null>(null)` when installing the window listeners in `installTrailingGuard`, so `removeTrailingGuard` does not reference `onTrailingKeyDown`, `onTrailingKeyUp`, or `onTrailingBlur` before their declarations:

```tsx
  const trailingGuardInstalledRef = useRef<boolean>(false);
  const trailingGuardCleanupRef = useRef<(() => void) | null>(null);

  const removeTrailingGuard = useCallback(() => {
    if (trailingGuardInstalledRef.current) {
      trailingGuardCleanupRef.current?.();
      trailingGuardCleanupRef.current = null;
      trailingGuardInstalledRef.current = false;
    }
  }, []);
```
And in `installTrailingGuard`:
```tsx
      window.addEventListener("keydown", onTrailingKeyDown, true);
      window.addEventListener("keyup", onTrailingKeyUp, true);
      window.addEventListener("blur", onTrailingBlur, true);
      trailingGuardCleanupRef.current = () => {
        window.removeEventListener("keydown", onTrailingKeyDown, true);
        window.removeEventListener("keyup", onTrailingKeyUp, true);
        window.removeEventListener("blur", onTrailingBlur, true);
      };
      trailingGuardInstalledRef.current = true;
```

### Fix 2: `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx` (lines 1463–1481)
Update `"forwards disclosure state and toggle action to workspace rows"` to assert the current `isDisclosed` contract in `TraditionalTerminalProjectWorkspaceRow.tsx:263` (inactive row hides worktree/commit metadata when `disclosedGroupIds` is empty, and reveals worktree combobox + commit chip when `group.id` is in `disclosedGroupIds`):

```tsx
    it("forwards disclosure state to inactive workspace rows", async () => {
      renderNavigator({
        groups: [group],
        activeGroupId: "other-group",
        disclosedGroupIds: new Set(),
      });
      expect(
        container.querySelector('[role="combobox"][aria-label^="Worktree for"]'),
      ).toBeNull();

      renderNavigator({
        groups: [group],
        activeGroupId: "other-group",
        disclosedGroupIds: new Set([group.id]),
      });
      expect(
        container.querySelector('[role="combobox"][aria-label^="Worktree for"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[aria-label^="Commit 1234567"]'),
      ).not.toBeNull();
    });
```

### Fix 3: `server/src/api/terminal.rs:862` & `server/src/config/tests.rs:635,697`
1. In `server/src/api/terminal.rs:862`, replace `error.0` with `error`:
   ```rust
   .unwrap_or_else(|error| panic!("Windows cwd fallback: {}", error));
   ```
2. In `server/src/config/tests.rs` at lines 656 and 718, add `ui: None, workspaces: None,` to both `DamHopperConfig` initializers:
   ```rust
   features: FeaturesConfig::default(),
   ui: None,
   workspaces: None,
   config_path: config_path.clone(),
   ```

### Fix 4: `packages/ui/e2e/os-cutover/os-cutover.spec.ts:55-73,122-123`
1. Migrate both Agent Hub root locators in `packages/ui/e2e/os-cutover/os-cutover.spec.ts` (lines 55 and 122) from `[data-os-agent-hub]` to the current production contract `page.locator('[data-testid="agent-hub-app"]').first()` (matching `packages/ui/e2e/os-agent-hub-workspace/os-agent-hub-workspace.spec.ts:84` and `packages/ui/browser-tests/os-agent-hub.browser.tsx:175`).
2. In `packages/ui/e2e/os-cutover/os-cutover.spec.ts:58-73`, replace the retired card-roster filter pill interactions (`agent-hub-filter-all`, `agent-hub-filter-agents`, `agent-hub-filter-background`) with terminal-first Agent Hub workspace assertions and interactions (verifying `[data-testid="agent-hub-context-pill"]`, `[data-testid="agent-hub-attn-counter"]`, `[data-testid="agent-hub-work-counter"]`, and toggling `button[aria-label="Toggle projects sidebar"]` while verifying `nav[aria-label="Terminal projects and agents"]` hides and restores).

---

## 5. Local Reproduction & Validation Commands

*(Note: Investigation was read-only against CI logs and local source files; run these commands after applying fixes to verify.)*

```bash
# 1. Reproduce / validate ESLint failure + LockScreenOverlay behavioral tests (trailing keyup, blur, unmount cleanup) + downstream static_build steps
pnpm lint
pnpm --filter @dam-hopper/ui exec vitest run src/os/LockScreenOverlay.test.tsx
pnpm --filter @dam-hopper/shared build && pnpm --filter @dam-hopper/browser-bridge typecheck && pnpm --filter @dam-hopper/browser-bridge build && pnpm --filter @dam-hopper/ui build && pnpm --filter @dam-hopper/browser-extension typecheck && pnpm --filter @dam-hopper/browser-extension build && pnpm --filter @dam-hopper/web build

# 2. Reproduce / validate UI unit test failure
pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx

# 3. Validate Rust server tests (Note: #[cfg(windows)] blocks in terminal.rs:862 and config/tests.rs:635,697 require a Windows target or the Windows CI runner to compile and execute)
cargo test --manifest-path server/Cargo.toml --lib config::tests::
# On Windows runner / cross-target:
# cargo test --manifest-path server/Cargo.toml --no-run
# cargo test --manifest-path server/Cargo.toml --lib api::terminal::

# 4. Reproduce / validate E2E os-cutover spec (runs both serial tests in os-cutover.spec.ts)
pnpm --filter @dam-hopper/ui test:e2e:typecheck
pnpm --filter @dam-hopper/ui exec playwright test e2e/os-cutover/os-cutover.spec.ts
```

---

## Unresolved Questions & Downstream Gate Risks

- **Skipped downstream steps in `static_build` and `server_windows`:** Because `Lint workspace` (`pnpm lint`) and `Compile all server tests` (`cargo test --no-run` on Windows) failed early, their subsequent job steps (`Typecheck and build shared packages`, `Typecheck and build browser extension`, `Build web app`, and Windows `api::terminal::` / `idle_suspend::activity::sampler::` / `pty::manager::` test execution) did not execute in run `42331116964` and must be run once the 4 blockers above are fixed.
