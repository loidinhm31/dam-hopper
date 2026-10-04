# Phase 01 — Server Policy Update

## Context Links

- [Plan / preflight / side effects](./plan.md); [current progress](./progress.md); [Phase 02](./phase-02-server-harness-model-discovery.md); [Phase 03](./phase-03-frontend-transport-data-provider.md).
- [Scout findings](../reports/scout-261003-1822-advisor-routing-model-selector.md#1-server-policy-read-validation-and-storage).
- [Native architecture](../../docs/architecture/native-advisor.md#api-and-authorization-invariants); [configuration](../../docs/configuration/advisor.md); [repository rules](../../AGENTS.md).
- Sources: [policy.rs](../../server/src/advisor/policy.rs), [history.rs](../../server/src/advisor/history.rs), [secure_path.rs](../../server/src/fs/secure_path.rs).

## Overview

- Date: 2026-10-03. Priority: P2. Status: Implementation settled; durable completion pending qualification in Phase 05 (not DONE). Effort: 8h.
- Review evidence: Code review 9.6/10; 11/11 unit tests and 7/7 API integration tests passed cleanly.
- Add route-only, revision-checked mutation of an existing valid V2 account policy. No file creation, V1 migration, wait/history editing, or historical record mutation.

## Key Insights

- Existing symbols: `MAX_POLICY_BYTES = 16 * 1024`, `ENABLED_BACKENDS`, `PolicyRouteTargetDto`, `PolicyAdvisorDto`, `PolicyReadCurrentResultDto`, `read_current_policy`, private recursive `check_credentials`.
- Reader hashes raw bytes with SHA-256. Duplicate means equality of **backend + model + effort**; same backend/model with a different effort remains valid.
- Disk wait/history keys are snake_case; `PolicyDocumentV2Dto` serializes camelCase for HTTP. Serializing that DTO to disk would break the existing reader/producer.
- `AdvisorService` owns effective `home_dir`; `AppState` constructs it using `resolve_effective_home()`. Do not re-resolve browser HOME, scan `/home`, or use a project path.
- Existing reader checks final-file symlink/size but uses path-based read; new write safety needs real HOME/`.evcrate` directories and no-follow final-file access, not a metadata-only check followed by unchecked open.
- `advisor_settings_lock` protects server TOML, not policy JSON. Keep policy lock in `AdvisorService`; do not serialize discovery/history behind it.

## Requirements

### Functional

1. `PATCH /api/advisor/policy` body: `PolicyUpdateParamsDto { expectedRevision: string, advisor: PolicyAdvisorDto }`; exact fields only. Both routes required.
2. Return fresh `PolicyReadCurrentResultDto` with `ready`, `scope: account`, `temporal: current`, new byte revision, `observedAt`, and committed V2 policy.
3. Require ready V2 existing policy; reject missing, unsupported, invalid, unsafe, or migration-required input without modifying it. No inferred defaults.
4. Preserve all non-route values in the raw JSON tree, especially `wait.warn_after_ms`, `wait.warn_every_ms`, `history.retention_days`, and `history.max_bytes`. Do not accept these fields from clients.
5. Accept custom model identifiers independent of catalog membership. Preserve provider-qualified `omp`/`pi` identifiers; do not lowercase or strip provider prefixes. Trim surrounding model/effort whitespace consistently before validating/saving.
6. Reject unsupported backend, empty/whitespace-only model/effort, control characters, overlong identifiers, producer-invalid effort, and identical normalized routes. Use Phase 02's producer-compatible effort rules; not a discovery-success prerequisite.

### Nonfunctional

- 16 KiB HTTP body cap, source-byte cap, and final serialized-output cap; bound reads while streaming, not just via initial metadata length.
- Atomic same-filesystem publication; mode 0600 on Unix; sync file and parent directory; no truncation/in-place write.
- Stable sanitized issue codes: `ROUTE_BACKUP_IDENTICAL`, `ROUTE_ENTRY_INVALID`, `ROUTE_SCHEMA_INVALID`, `ROUTE_CREDENTIAL_FIELD`, `POLICY_FILE_UNSAFE`, `POLICY_REVISION_CONFLICT`, `POLICY_NOT_EDITABLE`, `POLICY_WRITE_FAILED`.
- HTTP 400 for validation/unsafe/not-editable, 409 for revision conflict, 413 for size, 500 for write failure; normal auth 401/403 and `ADVISOR_DISABLED` preserved. Error JSON retains `{error, code}` with no raw filesystem error, request document, or path.

## Architecture

`handler → enabled guard → AdvisorService::update_policy → policy mutex → spawn_blocking bounded read/validate/merge/atomic commit → current-policy DTO`.

Proposed symbols; not existing implementation:

- `PolicyUpdateParamsDto`, `validate_policy_value`, `validate_route_target`, `update_current_policy` in `policy.rs`.
- `AdvisorService::update_policy(params)` and `policy_update_lock: Mutex<()>` in `history.rs`; initialize in both `new` and `with_secret`.
- `AdvisorError::PolicyValidation { code }`, `PolicyRevisionConflict`, `PolicyWriteFailed` (or equivalent small typed variants) in `error.rs`; public messages sanitized.
- `policy_update_handler` in `api/advisor.rs`; route registered inside existing authenticated/admin-only `advisor_routes`.
- Reuse `fs::secure_path`'s handle-relative no-follow/openat/renameat primitives. Add a narrowly scoped checked regular-file replacement helper, e.g. `replace_regular_file_if_bytes_match(root, relative, expected_bytes, replacement_bytes)`, rather than passing SHA revision through second-resolution mtime APIs or writing another general filesystem subsystem.

Example request:

```json
{
  "expectedRevision": "<64-character lowercase SHA-256 from policy/current>",
  "advisor": {
    "primary": { "backend": "codex", "model": "custom-codex-model", "effort": "high" },
    "backup": { "backend": "omp", "model": "openai/custom-backup-model", "effort": "medium" }
  }
}
```

## Related Code Files

| Action | Repository path | Change |
|---|---|---|
| Modify | `server/src/advisor/policy.rs` | Shared reader/writer validation, request DTO, raw-value route merge, bounds/revisions |
| Modify | `server/src/advisor/history.rs` | Policy-only mutex, captured-home async update wrapper; all constructors |
| Modify | `server/src/advisor/error.rs` | Stable issue/status mapping without raw OS messages |
| Modify | `server/src/advisor/mod.rs` | Export new policy symbols; coordinate Phase 02 module registration |
| Modify | `server/src/api/advisor.rs` | `policy_update_handler`; recursive request credential screening |
| Modify | `server/src/api/router.rs` | PATCH route with 16 KiB `RequestBodyLimitLayer` in admin group |
| Modify, supporting safety | `server/src/fs/secure_path.rs` | Reuse handle-relative primitives for bounded regular-file byte comparison/replacement and directory sync; keep existing mtime callers unchanged |
| Modify | `server/tests/advisor_policy_evaluations.rs`, `server/tests/advisor_history_api.rs` | Route persistence, preservation, rejection, and auth cases |
| Intentionally unchanged | `server/src/state.rs`, snapshot/evaluation services | Use existing `advisor_service`; no settings-lock repurposing or cache invalidation |
| Delete | None | No aliases or legacy compatibility writer |

## Implementation Steps

1. Factor current JSON validation into a pure function reused by read and update. Preserve read statuses, issue precedence, V1 detection, credential rejection, and route identity semantics. Expose validated raw `Value` plus HTTP projection without duplicating wait/history rules.
2. Define strict route-only update DTO. Screen raw request JSON recursively with `check_credentials` **before** typed deserialization can drop unknown keys; reject remaining unexpected fields. Require a syntactically valid expected revision. Backend membership uses `ENABLED_BACKENDS`; model/effort strings follow inspected producer bounds (model at most 256 UTF-8 bytes, effort at most 64) and no control characters. `omp`/`pi` new route values require `provider/model`; use their producer `THINKING` sets, not OMP CLI `auto`. Do not narrow the existing observational reader's statuses or make custom-model admission depend on catalog membership.
3. Implement safe path resolution from captured effective HOME only. Require absolute real HOME directory and real `.evcrate` directory; reject linked/non-regular target. No canonical-equals-input, UID/grant matrix, arbitrary-root APIs, directory creation, or unrelated history safety changes.
4. Open validated parent/file with no-follow semantics; read at most `MAX_POLICY_BYTES + 1` bytes; reject oversize. Compare SHA-256 against `expectedRevision` while holding the service's policy lock. Parse and validate the current document; a malformed/legacy file is never overwritten.
5. Mutate only `advisor.primary` and `advisor.backup` in the already parsed bounded raw document; retain original source bytes for revision checking without cloning the JSON tree. Re-run shared document validation. Serialize pretty JSON plus final newline, retaining all unrelated values and disk key spellings; validate final byte length before creating a temporary file.
6. Extend/reuse existing secure-path helper: keep parent directory handle anchored; create exclusive no-follow same-directory temp at mode 0600; write all bytes and sync; recheck final regular-file type and expected bytes/revision immediately before rename; publish using handle-relative atomic replacement; sync directory. Clean temporary file on every pre-publication failure. Windows implementation must reject reparse-point redirection and use its existing atomic-replace semantics; no unchecked truncation fallback.
7. Treat rename as commit point. Before it, failure leaves original bytes untouched. After it, directory-sync/readback failure can mean committed-but-not-confirmed: return sanitized failure, never claim rollback, and require a current-policy reread before retry. Do not blindly restore old bytes after publication.
8. Add policy-only lock to all `AdvisorService` constructors; perform blocking filesystem work in `spawn_blocking` and retain serialization until that work actually finishes. An aborted HTTP request cannot release the lock while its spawned writer is still committing; use an owned guard moved into the blocking closure if necessary.
9. Register PATCH handler beside current-policy route under existing `require_auth` + `require_admin`, call `check_advisor_enabled`, attach 16 KiB body layer. Authentication failure must occur before write activity; no `--no-auth` bypass.
10. Return the authoritative committed bytes' projection/revision, not the submitted draft. No history refresh, snapshot clearing, evaluation invalidation, background execution, or new live-event protocol.
11. Add deterministic domain/API tests described below; run only in Phase 05 after all changes land. Update current docs in Phase 05, including intentional narrow policy-write supersession.

## Todo List

- [x] Shared raw-policy validation and strict route-only DTO.
- [x] Policy-only lock, captured-home wrapper, safe no-follow read and byte revision checks.
- [x] Atomic bounded regular-file replacement with cleanup, sync, mode, and platform safety.
- [x] Authenticated/disabled-gated PATCH handler, 16 KiB limit, stable sanitized errors.
- [x] Preservation, duplicate/custom model, stale write, unsafe path, and failure-injection tests.

## Success Criteria

- Updating fixture routes then `POST /api/advisor/policy/current` returns updated values and actual new SHA-256; wait/history values and unrelated safe keys are equal to originals.
- Same backend/model with different effort succeeds; fully identical normalized routes fail with `ROUTE_BACKUP_IDENTICAL`. Custom identifiers survive exactly after documented outer trim.
- Two concurrent updates with the same expected revision produce one successful changed document and one conflict; no torn/partial JSON.
- Requests with credential-like keys, invalid routes, >16 KiB body/source/output, linked file/parent, directory/FIFO target, stale revision, missing/V1/invalid policy fail without modifying unrelated bytes.
- Pre-rename injected I/O failure preserves original bytes and leaves no temp artifacts; post-rename confirmation failure is accurately represented and recoverable by reread.
- Admin session succeeds; non-admin/unauthenticated/no-auth/disabled requests do not access policy for mutation.

## Risk Assessment

- **Wire/disk naming mismatch:** mutate validated raw JSON, never serialize HTTP DTO to disk.
- **External writers:** service mutex fences this server's saves; byte check catches observed CLI/other-process changes. Check-then-rename cannot provide universal filesystem CAS against noncooperating writers; document this residual race, never claim a cross-process transaction guarantee.
- **TOCTOU/symlink swap:** anchored directory/file handles and commit-time regular-file check; test path swaps. Existing helper's mtime checks are insufficient for byte revisions.
- **Cancellation after commit:** cancellation suppresses old-owner UI publication, not durable disk publication; next read resolves uncertainty.
- **Overbroad refactor:** keep shared safety extension narrow and existing filesystem callers/tests unchanged; do not harden unrelated history readers in this feature.

## Security Considerations

- Fixed server-owned HOME/account file, current admin authorization per request, enabled feature, no client path/credential fields.
- Preserve credential screening on existing policy even if only routes change. Request rejection must not serialize credentials back into error details.
- No stdout/raw OS errors/body dumps or history record mutation. Mode 0600; no elevated chmod/chown or automatic repair of unsafe input.

## Next Steps

Phase 01 implementation verified and complete. Ready for Phase 02 (Server harness model discovery) and Phase 03 (Frontend transport / data provider) contract consumption. Qualification scheduled in Phase 05 (`cargo test --manifest-path server/Cargo.toml advisor::policy` and `cargo test --manifest-path server/Cargo.toml --test advisor_policy_evaluations`).
## Unresolved Questions

None requiring user input.
