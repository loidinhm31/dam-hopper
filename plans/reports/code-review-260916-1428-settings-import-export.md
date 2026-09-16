# Code Review: Settings Page Import / Export Workspace Feature

**Plan:** `plans/260916-1428-settings-import-export/plan.md`  
**Score:** 7.5/10  
**Status:** Requires Remediation Before Merge

---

## Code Review Summary

### Scope
- **Files reviewed (18):**
  - `server/src/utils/fs.rs` (atomic_write_bytes, mode 0600)
  - `server/src/config/parser.rs` (parse_config_str_at_path)
  - `server/src/config/replacement.rs` (validate_protected_config_replacement)
  - `server/src/config/mod.rs` (module declarations & exports)
  - `server/src/api/config.rs` (reload_config_locked)
  - `server/src/api/settings.rs` (export_workspace_settings, import_workspace_settings, backup/retention)
  - `server/src/api/router.rs` (routes & 1 MiB limit)
  - `server/src/api/error.rs` (derive Debug)
  - `server/src/api/tests.rs` (updated export and import tests)
  - `server/tests/settings_import_export.rs` (integration test suite)
  - `packages/ui/src/api/ws-transport.ts` (contentType handling, raw toml body, routes)
  - `packages/ui/src/api/client.ts` (SettingsImportResponse, exportConfig, importConfig)
  - `packages/ui/src/api/queries.ts` (useImportSettings with tomlContent)
  - `packages/ui/src/components/pages/settings-page/SettingsImportExportPanel.tsx` (hidden file input, wording)
  - `packages/ui/src/components/pages/SettingsPage.tsx` (handleExport Blob download, handleImportFile confirmation and size check)
  - `packages/ui/src/api/ws-transport.test.ts` (export/import transport tests)
  - `packages/ui/src/components/pages/settings-page/SettingsImportExportPanel.test.tsx` (panel tests)
  - `packages/ui/src/components/pages/SettingsPage.test.tsx` (page integration tests)
- **Lines of code analyzed:** ~800 additions/changes across Rust backend and TypeScript frontend
- **Review focus:** Security, concurrency/race safety, transactional integrity, contract adherence, error handling, edge cases, YAGNI/KISS/DRY
- **Updated plans:** `plans/260916-1428-settings-import-export/plan.md`

### Overall Assessment
Implementation resolves core blocker by ditching legacy Electron/native-dialog expectations and replacing with browser Blob export and hidden file input import. Raw TOML export is byte-faithful. Workspace context read/write guards prevent concurrent workspace mutations. Route-local 1 MiB body limit and 0600 file modes implemented. TypeScript compile and lint clean.
However, several discrepancies and edge cases must be addressed:
1. HTTP status code contract mismatches (400 returned instead of 415 for unsupported media type, and 400 instead of 409 for workspace admission change).
2. Data loss risk in backup retention: `prune_backups` uses broad prefix matching (`starts_with("dam-hopper.toml.bak.")`) instead of validating timestamp format, which will delete unrelated user files sharing that prefix.
3. Rollback failure suppression: if disk restore succeeds but in-memory reload fails, backup file is deleted anyway and response falsely claims restoration.
4. Duplicated validation: `server/src/api/config.rs` was not migrated to use the shared `validate_protected_config_replacement` policy.
5. Temp file leak in `atomic_write_bytes` on write failure.
6. UI displays green success-styled "✓ Import cancelled." on dialog dismissal.
7. Integration test coverage is missing 8 of 10 plan-specified verification scenarios.

---

## Critical Issues

### 1. Backup Retention Deletes User Files (Data Loss Risk)
- **Location:** `server/src/api/settings.rs:155`
- **Problem:** `prune_backups` matches entries with `name.starts_with(BACKUP_PREFIX)`. Any user file in the directory named e.g. `dam-hopper.toml.bak.custom` or `dam-hopper.toml.bak.snapshot-2026.toml` is counted as an automated backup and deleted when count exceeds 5.
- **Impact:** Permanent loss of user-created manual backup or configuration files. Plan Phase 1.4 & Risk Table explicitly mandated strict generated-name parsing so unrelated user files survive.
- **Fix:** Parse and validate the exact embedded timestamp format (`%Y%m%dT%H%M%S_%6fZ`) before including entry in pruning candidate list.
```rust
fn is_server_backup_file(name: &str) -> bool {
    name.strip_prefix(BACKUP_PREFIX)
        .and_then(|ts| chrono::NaiveDateTime::parse_from_str(ts, "%Y%m%dT%H%M%S_%6fZ").ok())
        .is_some()
}
```

### 2. HTTP Status Code Contract Violations (415 & 409 Mapped to 400)
- **Location:** `server/src/api/settings.rs:193-195`, `208-210`
- **Problem:**
  - When `Content-Type` is not `application/toml`, handler returns `AppError::InvalidInput(...)` which maps to HTTP `400 Bad Request` instead of `415 Unsupported Media Type`.
  - When `current_path != initial_path` (workspace switched during lock acquisition), handler returns `AppError::InvalidInput(...)` which maps to HTTP `400 Bad Request` instead of `409 Conflict`.
- **Impact:** Violates canonical API specification in plan (lines 44, 139, 185, 203) and standard REST contract. Clients and middlewares cannot differentiate validation failures from content negotiation (415) or state race conflicts (409).
- **Fix:** Add or map dedicated status codes in `ApiError`/`AppError` (e.g. `AppError::UnsupportedMediaType` -> 415, `AppError::Conflict` or dedicated variant -> 409).

---

## High Priority Findings

### 3. Incomplete Rollback & Misleading Error on Runtime Reload Failure
- **Location:** `server/src/api/settings.rs:237-249`
- **Problem:**
```rust
if let Err(reload_err) = crate::api::config::reload_config_locked(&state).await {
    let restore_res = crate::utils::fs::atomic_write_bytes(&current_path, &old_bytes);
    let _ = crate::api::config::reload_config_locked(&state).await;
    let parent = current_path.parent().unwrap_or(std::path::Path::new("."));
    let backup_path = parent.join(&backup_file_name);
    if restore_res.is_ok() {
        let _ = std::fs::remove_file(&backup_path);
    }
    return Err(ApiError::from_app(crate::error::AppError::Internal(format!(
        "Failed to reload imported config, restored previous configuration: {}",
        reload_err.0
    ))));
}
```
If `atomic_write_bytes` succeeds but runtime reload (`reload_config_locked`) fails:
1. Result of second `reload_config_locked` is ignored (`let _ = ...`).
2. Backup is deleted (`restore_res.is_ok()`).
3. Returned error claims previous configuration was restored, even though runtime state remains split or corrupted.
- **Fix:** Verify both disk restore AND runtime reload succeed before deleting backup. If runtime reload fails, preserve backup and report that runtime rollback failed.

### 4. Code Duplication & Missing Policy Adoption in `server/src/api/config.rs`
- **Location:** `server/src/api/config.rs:39-40, 50-125`, `server/src/config/replacement.rs`
- **Problem:** `validate_protected_config_replacement` was created in `replacement.rs`, but `server/src/api/config.rs` never adopted it. `update_config` still uses custom inline functions `preserve_and_reject_telemetry_mutation` and `preserve_and_reject_idle_suspend_mutation`.
- **Impact:** Violates DRY and plan Phase 1.3 requirement ("Refactor `PUT /api/config` preparation so omitted protected sections retain current values, then pass its effective typed candidate through the same policy"). Divergent validation logic between REST config updates and file imports.
- **Fix:** Route `update_config` through `validate_protected_config_replacement`.

---

## Medium Priority Improvements

### 5. Temp File Leak in `atomic_write_bytes` on Write Failure
- **Location:** `server/src/utils/fs.rs:23`
- **Problem:** `write_with_mode(&tmp, content)?;` returns early with `?`. If `write_all` fails (e.g. out of disk space), `.dam-hopper-tmp-<uuid>.tmp` remains on disk.
- **Fix:** Ensure error handler cleans up `tmp`:
```rust
if let Err(e) = write_with_mode(&tmp, content) {
    let _ = std::fs::remove_file(&tmp);
    return Err(e);
}
```

### 6. Missing Collision Retry Loop in `create_backup`
- **Location:** `server/src/api/settings.rs:91-144`
- **Problem:** `create_backup` uses `create_new(true)`. If a file exists at the exact same timestamp, the operation fails and aborts import without retrying.
- **Fix:** Add a bounded retry loop (e.g. up to 5 attempts) appending a collision counter `_N` if timestamp collides.

### 7. UI UX: Confirmation Cancel Renders Green "✓ Import cancelled."
- **Location:** `packages/ui/src/components/pages/SettingsPage.tsx:122-126`, `SettingsImportExportPanel.tsx:89-93`
- **Problem:** Dismissing `window.confirm` sets `importMsg = "Import cancelled."`. Panel renders `importMsg` using `tone="success"` (`✓ Import cancelled.`).
- **Impact:** Violates plan constraint: "Cancellation sends no request and does not render a success-style cancellation." Confusing UX for user.
- **Fix:** Clear messages on cancellation without setting `importMsg`.

### 8. Incomplete Integration Test Matrix
- **Location:** `server/tests/settings_import_export.rs`
- **Problem:** Plan Phase 4.1 listed 9 test scenarios; only 5 are implemented. Missing:
  - Unix mode `0600` assertion on backup file.
  - Collision-safe naming and non-pruning of user-created similarly named files.
  - Validation no-mutation matrix (schema-invalid config, duplicate project names, invalid UTF-8, missing content-type, >1 MiB body).
  - Telemetry replacement rejection.
  - Workspace race (409 conflict).
  - Rollback failure seam.
  - Authentication check for both endpoints.
- **Fix:** Add remaining integration test cases to `server/tests/settings_import_export.rs`.

### 9. Missing Documentation Updates
- **Location:** `docs/system-architecture.md`, `docs/CHANGELOG.md`
- **Problem:** Planned documentation updates (Phase 4.5) were omitted.

---

## Low Priority Suggestions

### 10. Avoid JSDOM Unhandled Navigation Error in SettingsPage Tests
- **Location:** `packages/ui/src/components/pages/SettingsPage.test.tsx:110`
- **Problem:** `a.click()` in jsdom causes `Error: Not implemented: navigation (except hash changes)` to print to stderr.
- **Fix:** Prevent default or mock `HTMLAnchorElement.prototype.click` in the test setup.

### 11. Redundant Condition in `useImportSettings` Query Invalidation
- **Location:** `packages/ui/src/api/queries.ts:1407`
- **Observation:** `if (result?.imported)` is redundant since `imported` is always `true` on successful response.

---

## Positive Observations
- **Byte-Faithful TOML Export:** Directly streams bytes from disk under `workspace_context_guard.read()`, preserving comments, blank lines, and formatting perfectly.
- **Strict Concurrency Safety:** `workspace_context_guard.write()` held continuously through snapshot re-check, validation, backup creation, atomic publish, and runtime reload.
- **Browser-Native UX:** Replaced obsolete Electron dialog mocks with standard Web API Blob download and hidden file input.
- **Double-Layered Payload Size Guard:** Client validates `< 1 MiB` before calling `file.text()`; Axum `RequestBodyLimitLayer(1024 * 1024)` validates at HTTP layer.
- **File Permissions:** `0600` mode strictly enforced on Unix for both atomic writes and backup creation.
- **Clean Component Separation:** `SettingsImportExportPanel` remains presentationally clean with forwarded callbacks; `SettingsPage` handles browser IO.

---

## Recommended Actions
1. **Fix Prune Logic:** Update `prune_backups` in `server/src/api/settings.rs` to validate the datetime format string so manual user backups are never deleted.
2. **Correct HTTP Error Codes:** Return 415 for invalid Content-Type and 409 for workspace path mismatch in `server/src/api/settings.rs`.
3. **Tighten Rollback Handling:** In `import_workspace_settings`, verify both disk write and runtime reload succeed before unlinking backup; surface runtime reload errors if rollback is partial.
4. **Clean up Temp Files on Error:** In `atomic_write_bytes`, ensure `tmp` is removed if `write_with_mode` fails.
5. **Deduplicate Config Validation:** Refactor `update_config` in `server/src/api/config.rs` to invoke `validate_protected_config_replacement`.
6. **Fix UI Cancel Message:** Remove `setImportMsg("Import cancelled.")` from `handleImportFile` in `SettingsPage.tsx`.
7. **Expand Integration Tests:** Add missing test cases to `server/tests/settings_import_export.rs`.
8. **Update Architecture & Changelog Docs:** Complete Phase 4.5 documentation tasks.

---

## Metrics
- **Type Coverage:** 100% (Strict TypeScript `tsc -p tsconfig.json` passing with zero errors)
- **Linting Issues:** 0 errors/warnings on changed UI files via ESLint
- **Targeted Automated Tests:**
  - Rust integration (`settings_import_export`): 5/5 passed
  - Rust unit (`settings_export`, `settings_import`): 2/2 passed
  - UI Vitest (`ws-transport`, `SettingsImportExportPanel`, `SettingsPage`): 42/42 passed

---

## Unresolved Questions
1. Should `validate_protected_config_replacement` return structured error JSON containing `field`, `code`, and remediation endpoint URLs, or is the current human-readable message in `AppError::InvalidInput` sufficient for client consumption?
2. Should `prune_backups` retain 5 backups per workspace or 5 across the entire directory if multiple workspaces share a directory? (Current implementation prunes per directory).
