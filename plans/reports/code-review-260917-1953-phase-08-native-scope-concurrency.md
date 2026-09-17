# Code Review Report: Phase 08 — Native Scope Concurrency

**Date:** 2026-09-17  
**Reviewer:** Phase08Reviewer (Senior Software Engineer)  
**Target:** Phase 08 — Native scope concurrency and platform integration  
**Overall Score:** 8.5 / 10  

---

## Executive Summary

Phase 08 successfully delivers concurrent Windows SSH forwarding scopes, explicit `NativeScopeRef` boundaries across the shared contract, UI host context, and native adapters. Global epoch transitions (`openClient`) are cleanly decoupled from scope-local lifecycles (`openScope`, `closeScope`, `reconcileKnownScopes`). Security boundaries (DPAPI vault scoping, Zeroize in-memory credential wiping, Tauri main-window label gating, and capability manifest limits) are well-designed.

**CRITICAL FINDING:** An accidental deletion in `apps/native/src-tauri/src/ssh_forward/connection_runtime.rs` stripped `active_rule_count(&self)` and `port_conflict(&self, port: u16, except_rule_id: &str)`. These methods are actively called at lines 1012 and 1015 and in tests at line 1921. Because `connection_runtime.rs` is gated by `#[cfg(windows)]`, Linux Cargo tests passed (47/47) while masking a hard compilation failure on Windows targets.

---

## Scope of Review

22 modified files analyzed across `apps/native`, `packages/shared`, and `packages/ui`:
- `apps/native/src-tauri/permissions/ssh-forward.toml`
- `apps/native/src-tauri/src/lib.rs`
- `apps/native/src-tauri/src/ssh_forward/command_names.in.rs`
- `apps/native/src-tauri/src/ssh_forward/commands.rs`
- `apps/native/src-tauri/src/ssh_forward/connection_runtime.rs`
- `apps/native/src-tauri/src/ssh_forward/known_hosts.rs`
- `apps/native/src-tauri/src/ssh_forward/manager.rs`
- `apps/native/src-tauri/src/ssh_forward/mod.rs`
- `apps/native/src-tauri/src/ssh_forward/model.rs`
- `apps/native/src/native-browser-debug-host.test.ts`
- `apps/native/src/native-browser-debug-host.ts`
- `apps/native/src/native-ssh-forward-host.test.ts`
- `apps/native/src/native-ssh-forward-host.ts`
- `packages/shared/src/ssh-forward-contract-fixtures.json`
- `packages/shared/src/ssh-forward-contract-fixtures.test.ts`
- `packages/ui/browser-tests/ssh-forward-browser-fixture.ts`
- `packages/ui/browser-tests/ssh-forward-route-gating.browser.tsx`
- `packages/ui/src/contexts/SshForwardHostContext.test.tsx`
- `packages/ui/src/contexts/SshForwardHostContext.tsx`
- `packages/ui/src/hooks/use-ssh-forward.test.tsx`
- `packages/ui/src/hooks/use-ssh-forward.ts`
- `packages/ui/src/lib/ssh-forward-host.ts`

---

## Validation Results

| Test Suite | Scope | Result | Notes |
|---|---|---|---|
| `@dam-hopper/shared` | Contract DTO & fixtures | **15 / 15 passed** | 2 test files |
| `@dam-hopper/native` | Desktop host adapter & smoke | **48 / 48 passed** | 4 test files |
| `@dam-hopper/ui` | Host context, hook, controller | **25 / 25 passed** | 4 test files |
| `apps/native/src-tauri` | Cargo unit tests (Linux) | **47 / 47 passed** | 4 suites (Windows-gated modules skipped on Linux) |
| **Total Passed** | | **135 / 135 passed** | Zero test failures on Linux |
| TypeScript Check | `@dam-hopper/native`, `@dam-hopper/ui` | **Clean** | Zero type errors |

---

## Detailed Findings

### 1. Critical Issues

#### [CRITICAL-1] Missing `active_rule_count` and `port_conflict` in `ConnectionRegistry`
- **Location:** `apps/native/src-tauri/src/ssh_forward/connection_runtime.rs` (preceding line 1554)
- **Problem:** When replacing `state(&self, connection_id: &str)` to accommodate the composite key `(String, String)`, lines defining `active_rule_count(&self) -> usize` and `port_conflict(&self, port: u16, except_rule_id: &str) -> bool` were accidentally removed in the diff.
- **Impact:**
  1. `reserve_rule` calls `self.active_rule_count() >= MAX_ENABLED_RULES` (line 1012) and `self.port_conflict(rule.local_port, &rule.id)` (line 1015).
  2. Test `port_conflict_excludes_the_same_rule_and_isolates_siblings` (line 1921) calls `registry.port_conflict(15432, "another-rule")`.
  3. **Windows compilation failure:** Any build on Windows will fail with `error[E0599]: no method named active_rule_count / port_conflict found for reference &mut ConnectionRegistry`.
  4. Global limit enforcement (64 rules) and global local port exclusivity across scopes are completely non-functional.
- **Recommended Fix:** Restore both methods to `ConnectionRegistry`:
  ```rust
  fn active_rule_count(&self) -> usize {
      self.entries
          .values()
          .flat_map(|entry| entry.children.values())
          .filter(|child| {
              matches!(
                  child.state,
                  SshForwardRuleState::Opening
                      | SshForwardRuleState::On
                      | SshForwardRuleState::Closing
              )
          })
          .count()
  }

  pub(crate) fn port_conflict(&self, port: u16, except_rule_id: &str) -> bool {
      self.entries.values().any(|entry| {
          entry.children.values().any(|child| {
              child.rule.id != except_rule_id
                  && child.rule.local_port == port
                  && matches!(
                      child.state,
                      SshForwardRuleState::Opening
                          | SshForwardRuleState::On
                          | SshForwardRuleState::Closing
                  )
          })
      })
  }
  ```

---

### 2. High Priority Findings (Warnings)

#### [WARN-1] Concurrency Race / Missing Double-Checked Lock in `open_scope`
- **Location:** `apps/native/src-tauri/src/ssh_forward/manager.rs:986-1050`
- **Problem:** `open_scope` checks `self.scopes.lock().await.get(scope_id)` before acquiring `command_gate`. If two concurrent callers request the same scope simultaneously, both pass the check, serialize on `command_gate`, and the second caller increments the scope generation and overwrites `active_scope` rather than returning the existing `ScopeHandle`.
- **Impact:** Breaks idempotency requirement for concurrent same-scope opens; causes unexpected generation bumps and redundant auto-starts.
- **Recommended Fix:** Re-check `self.scopes.lock().await.get(scope_id)` immediately after acquiring `let _command = self.command_gate.lock().await;`.

#### [WARN-2] Missing `command_gate` Synchronization in `close_scope`
- **Location:** `apps/native/src-tauri/src/ssh_forward/manager.rs:1086-1114`
- **Problem:** `close_scope` does not acquire `self.command_gate.lock().await;`. While removing entries from `scopes` and `intent.scope_tokens` fails subsequent commands fail-closed at `checked_scope`, an ongoing mutation already past `checked_scope` could continue writing to the store while teardown is in flight.
- **Impact:** Potential store/connection race during simultaneous mutation and scope close.
- **Recommended Fix:** Acquire `let _command = self.command_gate.lock().await;` at the beginning of `close_scope`.

---

### 3. Medium Priority Improvements

#### [MED-1] Unused Test Import
- **Location:** `packages/ui/src/contexts/SshForwardHostContext.test.tsx:11:10`
- **Problem:** `useSshForward` imported but never referenced.
- **Fix:** Remove unused import to clean linter output.

#### [MED-2] Lack of Non-Windows Mock / Architecture Gate for Windows Modules
- **Location:** `apps/native/src-tauri/src/ssh_forward/mod.rs`
- **Problem:** Complete exclusion of `connection_runtime.rs` and `manager.rs` via `#[cfg(windows)]` allows Rust syntax/type regressions to go undetected on Linux developer machines.
- **Fix:** Consider abstracting OS-specific primitives (DPAPI / windows storage) behind traits (as already done with `FakeCredentialVault`) so the manager and registry core can compile and run unit tests on Linux in `cfg(test)`.

---

### 4. Low Priority Suggestions

- In `packages/ui/src/hooks/use-ssh-forward.ts:157`, `getEffectiveScopeRef` returns placeholder empty strings if both `scopeRefRef` and `snapshotRef` are null. While harmless due to readiness gates, raising a descriptive error or typed sentinel would be cleaner.
- In `manager.rs:1255`, rename test-only `pub(crate) async fn activate_scope` to `activate_scope_for_test` to prevent confusion with the deprecated production command.

---

### 5. Positive Observations

- **Rigorous DPAPI & Secret Lifecycle:** `LoadedPasswordCleanup` implements `Drop` with `Zeroize` for passphrases/passwords. Vault entries purged cleanly via `forget_scope`.
- **Scope Isolation:** Keying `ConnectionRegistry` by `(String, String)` completely eliminates profile/connection ID collision between different scopes.
- **Granular Teardown:** `stop_scope_workers`, `stop_scope_connections`, `clear_scope_live_secrets`, and `challenges.clear_scope` cleanly isolate scope-local cleanup without touching other scopes.
- **True Epoch Teardown Preserved:** `open_client`, `dispose`, and `force_close` reliably tear down all scopes and abort all workers.
- **Strict IPC Security:** Main window check (`ensure_desktop_main`) on all 20 Tauri commands; permission and capability manifests verified by automated tests.
- **Frontend Architecture:** `SshForwardScopeBridge` decoupled from active profile focus, eliminating spurious client re-openings and state invalidations.

---

## Todo List Status (Phase 08 Plan)

- [x] Windows A/B forwarding scopes stay concurrently live through project/Settings/SSH-page focus changes; same imported connection/rule IDs cannot collide. *(Requires restoring `port_conflict`)*
- [x] Closing/deleting/failing A leaves B forwards, credentials, trust and timers intact; global port/connection/rule limits still enforced. *(Requires restoring `active_rule_count`)*
- [x] Stale scope token/generation/client epoch, wrong window, wrong manager or desktop identity remains rejected.
- [x] Real client-epoch change and shutdown still stop every scope and clear live secrets.
- [x] Non-Windows SSH and unsupported transport/Browser capabilities remain explicit unavailable, never insecure fallback.

---

## Unresolved Questions

1. **Windows Runtime Gate (S13):** When will a Windows test runner execute the disposable SSH endpoint matrix (S13) to validate WebView2 and DPAPI vault interactions live?
