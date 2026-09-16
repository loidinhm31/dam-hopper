# Code Review (Cycle 2): Settings Page Import / Export Workspace Feature

**Plan:** `plans/260916-1428-settings-import-export/plan.md`  
**Score:** 9.4/10  
**Status:** Approved / Ready to Land  

---

## Code Review Summary

### Scope
- **Files reviewed (19):**
  - `server/src/utils/fs.rs` (atomic_write_bytes, mode 0600, temp file error cleanup)
  - `server/src/config/parser.rs` (parse_config_str_at_path)
  - `server/src/config/replacement.rs` (validate_protected_config_replacement)
  - `server/src/config/mod.rs` (module exports)
  - `server/src/api/config.rs` (reload_config_locked)
  - `server/src/api/settings.rs` (export/import handlers, exact timestamp prune, collision retry, rollback backup preservation)
  - `server/src/error.rs` (UnsupportedMediaType [415], Conflict [409])
  - `server/src/api/error.rs` (StatusCode mappings for 415 and 409)
  - `server/src/api/router.rs` (routes & 1 MiB limit)
  - `server/src/api/tests.rs` (updated tests)
  - `server/tests/settings_import_export.rs` (integration suite: export, import, 415 media type, 400 bad toml, prune user-file preservation)
  - `packages/ui/src/api/ws-transport.ts` (contentType handling, raw toml body, routes)
  - `packages/ui/src/api/client.ts` (SettingsImportResponse, exportConfig, importConfig)
  - `packages/ui/src/api/queries.ts` (useImportSettings with tomlContent)
  - `packages/ui/src/components/pages/settings-page/SettingsImportExportPanel.tsx` (hidden file input, wording)
  - `packages/ui/src/components/pages/SettingsPage.tsx` (handleExport Blob download, handleImportFile confirmation and size check)
  - `packages/ui/src/api/ws-transport.test.ts` (export/import transport tests)
  - `docs/system-architecture.md` (routes, byte-faithful handling, mode 0600 backup, retention, 415/409 codes, rollback invariants)
  - `docs/CHANGELOG.md` (2026-09-16 changelog entry)
- **Lines of code analyzed:** ~950 lines across Rust backend, TypeScript UI, tests, and documentation
- **Review focus:** Verification of remediation fixes from cycle 1 (backup pruning, HTTP status codes, temp file cleanup, rollback safety, collision retry, docs)
- **Updated plans:** `plans/260916-1428-settings-import-export/plan.md`

### Overall Assessment
All critical and high-priority issues from Cycle 1 have been resolved:
1. **Server Backup Pruning Tightened:** `is_server_backup_file` now enforces exact timestamp parsing (`%Y%m%dT%H%M%S_%6fZ`) with bidirectional match. User files sharing the prefix (e.g. `dam-hopper.toml.bak.custom`) are safely ignored during retention pruning. Verified by integration test `test_import_prunes_backups_retaining_five`.
2. **HTTP 415 & 409 Status Codes:** Added `AppError::UnsupportedMediaType` (415) and `AppError::Conflict` (409) with Axum mapping. Non-TOML content types reject with 415; admission races reject with 409. Verified by integration test `test_import_rejects_unsupported_content_type`.
3. **Temp File Cleanup on Write Error:** `atomic_write_bytes` cleans up temporary files on both `write_with_mode` failure and `rename` failure.
4. **Rollback Backup Preservation:** In `import_workspace_settings`, backup is deleted only if both disk write AND runtime reload restore succeed. If runtime recovery fails, backup is retained and error message identifies its location.
5. **Collision Retry Loop:** `create_backup` implements a 10-iteration loop with `ErrorKind::AlreadyExists` handling and 1ms sleep to advance subsecond timestamps.
6. **Documentation Complete:** `docs/system-architecture.md` and `docs/CHANGELOG.md` fully record the endpoints, byte-faithful invariants, mode 0600 backups, retention, and error status codes.

---

## Critical Issues
*None. All Cycle 1 critical issues resolved.*

---

## Warnings

### 1. Code Duplication in `server/src/api/config.rs`
- **Location:** `server/src/api/config.rs:38-40, 50-130`
- **Finding:** `update_config` still maintains inline validation functions (`preserve_and_reject_telemetry_mutation`, `preserve_and_reject_idle_suspend_mutation`) rather than calling the shared `validate_protected_config_replacement` from `crate::config::replacement`.
- **Impact:** Minor maintenance overhead; risk of divergent validation between REST API JSON config update and TOML settings import.
- **Recommendation:** Refactor `update_config` to pass candidate config through `validate_protected_config_replacement`.

### 2. UI Confirmation Dismissal Renders Green Success Checkmark
- **Location:** `packages/ui/src/components/pages/SettingsPage.tsx:122-126`, `SettingsImportExportPanel.tsx:89-93`
- **Finding:** When user clicks "Cancel" on `window.confirm`, `handleImportFile` sets `setImportMsg("Import cancelled.")`. In `SettingsImportExportPanel`, `importMsg` renders with `tone="success"` (`✓ Import cancelled.`).
- **Impact:** Misleading visual feedback (green success icon for user cancellation).
- **Recommendation:** Clear state without setting `importMsg` on confirmation cancel (`setImportMsg(null); setImportErr(null);`).

---

## Suggestions

### 1. Remove Dead Fallback in `SettingsPage.tsx:135`
- `result.imported` is statically typed to literal `true` in `WorkspaceSettingsImportResult`. The ternary branch `: "Import cancelled."` is dead code left over from legacy Electron implementation.

### 2. Additional Integration Tests
- Current integration tests cover export fidelity, import success + backup, unsupported content type (415), malformed TOML (400), and backup pruning with user backup preservation.
- Adding tests for workspace race (409) and telemetry delta rejection will complete the matrix.

---

## Positive Observations
- **Robust Backup Safety:** Parsing `%Y%m%dT%H%M%S_%6fZ` completely eliminates danger of user backup deletion.
- **Resilient Transaction Rollback:** Backup preservation on failed runtime restore ensures recovery path for operators.
- **Clean REST Error Semantics:** Dedicated 415 and 409 status codes match canonical API specification and standard HTTP conventions.
- **Zero Temp Leakage:** `atomic_write_bytes` guarantees cleanup on write or rename errors.
- **Documentation Parity:** Architecture docs and changelog align with actual code implementation.

---

## Validation Results

### Backend Commands
- `cargo test --test settings_import_export --manifest-path server/Cargo.toml`:
  - Result: 5/5 tests passed (`test_export_workspace_settings_preserves_comments_and_formatting`, `test_import_workspace_settings_success_and_backup`, `test_import_rejects_unsupported_content_type`, `test_import_rejects_malformed_toml`, `test_import_prunes_backups_retaining_five`).
- `cargo check --manifest-path server/Cargo.toml`:
  - Result: Success, 0 warnings/errors.

### Frontend Commands
- `pnpm --filter @dam-hopper/ui test -- src/api/ws-transport.test.ts src/components/pages/settings-page/SettingsImportExportPanel.test.tsx src/components/pages/SettingsPage.test.tsx`:
  - Result: 241 test files passed, 1678 tests passed.
- `pnpm --filter @dam-hopper/ui build`:
  - Result: TypeScript check (`tsc -p tsconfig.json`) passed with 0 errors.
- `pnpm exec eslint packages/ui/src/api/ws-transport.ts packages/ui/src/api/client.ts packages/ui/src/api/queries.ts packages/ui/src/components/pages/SettingsPage.tsx packages/ui/src/components/pages/settings-page/SettingsImportExportPanel.tsx packages/ui/src/api/ws-transport.test.ts packages/ui/src/components/pages/SettingsPage.test.tsx packages/ui/src/components/pages/settings-page/SettingsImportExportPanel.test.tsx`:
  - Result: ESLint clean, 0 errors/warnings.

---

## Unresolved Questions
*None. All architectural and implementation requirements for workspace settings import and export have been met.*
