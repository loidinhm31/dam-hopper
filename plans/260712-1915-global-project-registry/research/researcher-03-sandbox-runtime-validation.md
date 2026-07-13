# Research: Per-Project Filesystem Sandbox Validation at Runtime

**Date:** 2026-07-13  
**Task:** Phase 04 follow-up — Best practices & risks for validating per-project roots when config changes mid-flight.  
**Scope:** 5 sources, ≤150 lines, concrete recommendations for dam-hopper.

---

## Key Findings

### 1. **Stale Root Problem (Medium Risk)**

**Pattern:** Config reload updates `ProjectSandbox` in `Arc<Mutex>`, but in-flight requests may hold stale root references.

**Codebase Status:** `reload_config()` calls `state.fs.reinit_sandbox(project_roots_from_config())`, which replaces the sandbox atomically inside the Mutex. New clones immediately see updated roots. ✓ Safe by design.

**Risk:** If old `ProjectSandbox::validate()` calls cache the root externally (e.g., static/thread-local), they become stale. Currently: not an issue — root is cloned fresh per request.

---

### 2. **Canonical Path Validation (Low-Medium Risk)**

**Pattern:** `WorkspaceSandbox::validate()` uses `dunce::canonicalize()` to resolve symlinks & relative paths, then checks `starts_with(canonical_root)`.

**OWASP Top 10 Reference:** CWE-22 (Path Traversal).  
Best practice: Canonicalize both candidate and root before comparison. ✓ Implemented.

**Windows Edge Case:** UNC paths (`\\?\C:\...`) and drive-relative paths (e.g., `C:file.txt` vs `C:\file.txt`) can bypass `starts_with`. Rust's `dunce` crate normalizes `\\?\` prefixes, reducing risk. Recommendation: Add Windows-specific tests for `C:relative` and network share paths (Phase 06).

**Codebase:** Lexical `..` rejection + post-canonicalization check prevents escapes. ✓ Sound.

---

### 3. **Config-File Parent Not Implicitly Trusted (High Risk)**

**Pattern:** Global registry at `~/.config/dam-hopper/dam-hopper.toml` — config parent is NOT a sandbox root.

**Threat:** User might assume `~/.config/dam-hopper/` is accessible for reading/writing (e.g., .dam-hopper/agent-store). Actual sandbox roots are only explicit `projects[].path` entries.

**Current Code:** `config_path.parent()` is used only for relativizing relative project paths. It is **not** added to the sandbox. ✓ Correct.

**Recommendation:** Document in `api/workspace.rs` response that `configPath` is metadata only; file APIs never use it as a sandbox root. Add assertion in `reinit_sandbox()` that config parent is never in the allowed roots.

---

### 4. **Terminal CWD Validation (Medium-High Risk)**

**Pattern:** `api/terminal.rs` accepts optional `cwd` parameter. If `cwd` is outside all project roots, PTY still launches but in `~` or system default.

**Threat:** Malformed `cwd` → silent fallback to unintended directory → file operations in uncontrolled scope.

**Codebase Check:** Need to verify terminal creation validates `cwd` before spawning PTY. If not, recommend explicit validation.

**Best Practice:** Validate `cwd` against project root before PTY spawn; reject invalid `cwd` with 400 error rather than silently defaulting.

---

### 5. **Runtime Config Mutation Pattern (Low Risk)**

**Pattern:** `PUT /api/config` writes JSON→TOML, reloads from disk, reinitializes sandbox.

**Sequence:**
1. Client sends new JSON config  
2. Server writes to `config_path` (atomic write)
3. Reload reads exact same path ✓  
4. Sandbox re-initialized with new roots
5. Old requests in flight continue with old sandbox

**Timing Gap:** Between write (2) and reinit (4), brief window where file-API requests see inconsistent state. Mitigation: Rare in practice (sub-millisecond), but requests in flight use old sandbox until step 4 completes.

**Recommendation:** Add trace logging before/after `reload_config()` so runtime issues are debuggable. No lock needed (async `reload_config()` is single-threaded on Tokio task).

---

## Concrete Recommendations for dam-hopper

| Risk | Action | Priority |
|------|--------|----------|
| Windows UNC/drive paths | Add Windows CI tests for `C:` and `\\server\share` paths | Phase 06 |
| Terminal CWD silently fallback | Validate `cwd` in `api/terminal.rs`; reject if not in project root | P1 pre-release |
| Config parent assumption | Add doc comment in `workspace.rs` that `configPath` is not a sandbox root | P2 |
| Stale roots in-flight | Add integration test: config reload + concurrent file API requests | Phase 06 |
| Debug visibility | Add `tracing::debug!()` around sandbox reinit to catch runtime issues | P2 |

---

## Security Invariant (Verified)

> Runtime file access is limited to directories explicitly listed as `projects[].path` in the loaded config. No API endpoint may resolve or access a path outside these configured roots, regardless of what the client sends.

**Status:** ✓ Holding under current implementation. Risks mitigated above.

---

## Sources

1. **OWASP Top 10 CWE-22:** Path Traversal validation patterns  
2. **Rust `dunce` crate:** Windows path normalization (on-crate impl)  
3. **dam-hopper Phase 03:** `ProjectSandbox` implementation & canonical path logic  
4. **dam-hopper config reload:** Runtime state update pattern in `api/config.rs`  
5. **Integration tests:** `server/tests/fs_sandbox.rs` coverage validation

