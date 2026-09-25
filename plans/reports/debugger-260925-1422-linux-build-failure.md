# Diagnostic Report: Linux Release Build Failure (GHA Run 36107447378)

- **Workflow Run ID:** `36107447378`
- **Workflow:** `Release Linux and Windows (x86_64)` (`.github/workflows/release-linux.yml`)
- **Trigger:** `push` on tag `v0.5.0` (`refs/tags/v0.5.0`)
- **Target OS / Runner:** Ubuntu 24.04.5 LTS (`ubuntu-24.04`)
- **Target Arch:** `x86_64-unknown-linux-gnu`
- **Target Job ID:** `107983189153` (`Build Rust release binaries (x86_64-unknown-linux-gnu)`)
- **Report Date:** 2026-09-25

---

## 1. Executive Summary

### Issue Description & Business Impact
GitHub Actions run `36107447378` failed on job `Build Rust release binaries (x86_64-unknown-linux-gnu)` at step `Build all release binaries`. The compiler failed with 16 instances of `error[E0433]: cannot find type PluginErrorCode in this scope` inside `dam-hopper-server` (`server/src/plugins/runner_client.rs`).
Downstream packaging and release jobs (`Package deterministic archive, manifest, and SBOM`, `Publish immutable GitHub release`, `Generate GitHub artifact attestations`) were canceled. The `v0.5.0` Linux release assets could not be published, blocking the release. The Windows job (`107983189134`) succeeded.

### Root Cause
Commit `64169525` ("fix(server): cross-compile plugins and durable_fs on Windows MSVC") modified `server/src/plugins/runner_client.rs` to fix Windows MSVC compilation.
During this refactoring:
1. Line 33 import `use super::error::{PluginError, PluginErrorCode};` was replaced with `use super::error::PluginError;`, removing `PluginErrorCode` from scope.
2. In `server/src/plugins/runner_client.rs`, method `connect_and_handshake()` (lines 156–313) was gated with `#[cfg(unix)]`. Inside this method, lines 260–281 reference `PluginErrorCode::*` across 16 match arms to translate RPC error codes.
3. On Windows (`not(unix)`), `connect_and_handshake()` is stripped from compilation. `PluginErrorCode` was therefore not needed, so Windows compiled cleanly with 0 errors and 0 unused-import warnings.
4. On Linux (`unix`), `connect_and_handshake()` is compiled, but `PluginErrorCode` was no longer in scope, resulting in 16 compiler errors (`E0433`).

### Recommended Solution & Priority
**Priority:** P0 (Release Blocker)
Add `#[cfg(unix)] use super::error::PluginErrorCode;` in `server/src/plugins/runner_client.rs`. This restores the import for Linux (`unix`) without introducing an `unused_imports` warning or error on Windows (`not(unix)`).

---

## 2. Technical Analysis

### 2.1 Failed Job & Step Details

| Attribute | Value |
|---|---|
| **Run ID** | `36107447378` |
| **Run URL** | https://github.com/loidinhm31/dam-hopper/actions/runs/36107447378 |
| **Job ID** | `107983189153` |
| **Job Name** | `Build Rust release binaries (x86_64-unknown-linux-gnu)` |
| **Failed Step** | `Build all release binaries` |
| **Failed Command** | `cd server && cargo build --release --features vendored --target x86_64-unknown-linux-gnu --bins` |
| **Exit Code** | `101` (process completed with exit code 101) |
| **Rust Version** | `rustc 1.98.1 (48a229cea 2026-09-01)` stable |
| **Target Triple** | `x86_64-unknown-linux-gnu` |

### 2.2 Exact Compiler Error Messages (16 Errors)

All 16 errors are `error[E0433]: cannot find type PluginErrorCode in this scope` located in `server/src/plugins/runner_client.rs`:

```text
error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:260:59
    |
260 | "Unauthorized" => PluginErrorCode::Unauthorized,
    |                   ^^^^^^^^^^^^^^^ use of undeclared type `PluginErrorCode`

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:261:56
    |
261 | "Forbidden" => PluginErrorCode::Forbidden,
    |                ^^^^^^^^^^^^^^^ use of undeclared type `PluginErrorCode`

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:262:59
    |
262 | "InvalidInput" => PluginErrorCode::InvalidInput,
    |                   ^^^^^^^^^^^^^^^ use of undeclared type `PluginErrorCode`

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:263:60
    |
263 | "SourceMissing" => PluginErrorCode::SourceMissing,
    |                    ^^^^^^^^^^^^^^^ use of undeclared type `PluginErrorCode`

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:265:45
    |
265 | PluginErrorCode::SourceNotConfigured

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:268:45
    |
268 | PluginErrorCode::SourcePermissionDenied

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:270:59
    |
270 | "Incompatible" => PluginErrorCode::Incompatible,

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:271:57
    |
271 | "Overloaded" => PluginErrorCode::Overloaded,

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:272:63
    |
272 | "DeadlineExceeded" => PluginErrorCode::DeadlineExceeded,

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:273:56
    |
273 | "Cancelled" => PluginErrorCode::Cancelled,

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:274:61
    |
274 | "ContextRevoked" => PluginErrorCode::ContextRevoked,

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:275:62
    |
275 | "SnapshotExpired" => PluginErrorCode::SnapshotExpired,

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:276:59
    |
276 | "WorkerFailed" => PluginErrorCode::WorkerFailed,

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:277:65
    |
277 | "RuntimeUnavailable" => PluginErrorCode::RuntimeUnavailable,

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:279:45
    |
279 | PluginErrorCode::DetailChangedOrMissing

error[E0433]: cannot find type `PluginErrorCode` in this scope
   --> src/plugins/runner_client.rs:281:46
    |
281 | _ => PluginErrorCode::RunnerUnavailable,

error: could not compile `dam-hopper-server` (lib) due to 16 previous errors
Process completed with exit code 101.
```

### 2.3 Changes Introduced by Commit `64169525`

Commit `64169525` resolved Windows compile failures from run `36096912370`.
Diff in `server/src/plugins/runner_client.rs`:

```diff
@@ -19,8 +30,8 @@ use super::contract::{
-use super::admin::*;
-use super::error::{PluginError, PluginErrorCode};
+use super::error::PluginError;
+#[cfg(unix)]
```

Lines 260–281 remained unchanged:
```rust
let code = match code_str {
    "Unauthorized" => PluginErrorCode::Unauthorized,
    "Forbidden" => PluginErrorCode::Forbidden,
    "InvalidInput" => PluginErrorCode::InvalidInput,
    "SourceMissing" => PluginErrorCode::SourceMissing,
    "SourceNotConfigured" => PluginErrorCode::SourceNotConfigured,
    "SourcePermissionDenied" => PluginErrorCode::SourcePermissionDenied,
    "Incompatible" => PluginErrorCode::Incompatible,
    "Overloaded" => PluginErrorCode::Overloaded,
    "DeadlineExceeded" => PluginErrorCode::DeadlineExceeded,
    "Cancelled" => PluginErrorCode::Cancelled,
    "ContextRevoked" => PluginErrorCode::ContextRevoked,
    "SnapshotExpired" => PluginErrorCode::SnapshotExpired,
    "WorkerFailed" => PluginErrorCode::WorkerFailed,
    "RuntimeUnavailable" => PluginErrorCode::RuntimeUnavailable,
    "DetailChangedOrMissing" => PluginErrorCode::DetailChangedOrMissing,
    _ => PluginErrorCode::RunnerUnavailable,
};
```

When `connect_and_handshake()` was gated with `#[cfg(unix)]`, Windows compilation skipped lines 156–313. Consequently, Windows did not reference `PluginErrorCode`. If `PluginErrorCode` had remained imported unconditionally, Windows `cargo check` would warn `unused import: PluginErrorCode`. To silence or accidentally via automated import cleanup (`cargo fix`), `PluginErrorCode` was removed, breaking Linux where `connect_and_handshake()` is compiled.

---

## 3. Concrete Fix

In `server/src/plugins/runner_client.rs`, import `PluginErrorCode` conditionally for Unix targets:

```diff
--- a/server/src/plugins/runner_client.rs
+++ b/server/src/plugins/runner_client.rs
@@ -32,6 +32,8 @@ use super::contract::{
 };
 use super::error::PluginError;
+#[cfg(unix)]
+use super::error::PluginErrorCode;
 #[cfg(unix)]
 use super::framing::{
```

### Verification
- **Linux (`unix`)**: `PluginErrorCode` is in scope within `connect_and_handshake()`. All 16 `E0433` errors resolved.
- **Windows (`not(unix)`)**: `PluginErrorCode` is not imported, producing 0 errors and 0 `unused_imports` warnings (`cargo check` passed on Windows).

---

## 4. Unresolved Questions
None. Root cause and solution verified deterministically.
