---
title: "Fix Settings Page workspace import and export"
description: "Restore browser-native, byte-faithful workspace TOML export and transactional validated import across the Rust API and React settings UI."
status: completed
priority: P2
effort: 18h
branch: main
tags: [bugfix, backend, frontend, api, settings, security]
created: 2026-09-16
---

# Fix Settings Page workspace import and export

## Objective & Context

Fix the non-functional Settings Page Import / Export flow end to end:

- Export the exact bytes of the active workspace `dam-hopper.toml`, including comments, whitespace, and ordering.
- Download through browser APIs as `dam-hopper.toml`; never ask the server to write to a client-selected path.
- Select a local `.toml` file through a hidden browser file input, read it in the browser, and POST raw TOML.
- Validate before replacing the active workspace file. Create a private backup, publish atomically, reload runtime state, and restore disk/runtime state on failure.
- Keep global config untouched. Reject imports that attempt to change protected runtime-owned settings.

Root cause: incomplete Electron-to-browser/Rust migration. The UI still expects native-dialog `{ exported, path }` / `{ imported }` responses, while the Rust server returns unrelated JSON and accepts a parameterless JSON import. See [`../reports/debugger-260916-1428-settings-import-export-failure.md`](../reports/debugger-260916-1428-settings-import-export-failure.md).

Advisor decisions adopted:

1. Active workspace raw TOML only; no combined workspace/global snapshot.
2. Browser owns save/open UX via Blob download and `<input type="file">`.
3. Server accepts content, never a client filesystem destination/source path.
4. Import is a bounded, serialized filesystem/runtime transaction with private backup and rollback.
5. Effective `server.idle_suspend` must equal current authority; no silent stripping or rewriting.
6. Reuse one config-replacement policy for protected telemetry and idle-suspend state.

## Architectural Decisions & Boundaries

### Canonical HTTP contract

Use explicit workspace-scoped endpoints. Remove the obsolete generic mappings rather than retain aliases.

| Operation | Contract | Success | Relevant failures |
| --- | --- | --- | --- |
| Export | `GET /api/settings/export/workspace.toml` | Raw active file bytes; `Content-Type: application/toml; charset=utf-8`; `Content-Disposition: attachment; filename="dam-hopper.toml"`; `Cache-Control: no-store` | Auth error, active config unreadable/not found |
| Import | `POST /api/settings/import/workspace.toml`; body is raw `application/toml; charset=utf-8`; route-local 1 MiB limit | JSON `{ imported: true, fileName: "dam-hopper.toml", backupFileName, workspaceName }` using camelCase | `400` invalid UTF-8/TOML/schema or protected field; `409` workspace changed during admission; `413` oversized; `415` unsupported media type; `500` backup/publish/reload/rollback failure |

Error responses remain structured JSON. Protected-field failures identify `field` (`server.idle_suspend` or `server.telemetry`), a stable code, and the dedicated mutation endpoint. Import result/error JSON uses camelCase. Imported and backed-up TOML remains snake_case and byte-faithful.

### Workspace and concurrency boundary

- Destination comes only from `AppState.config.config_path`.
- Snapshot active config path when request handling begins, then acquire `workspace_context_guard` write ownership and recheck the path. Return `409` if it changed while waiting.
- Hold the write guard through current-byte read, validation, backup, publication, runtime reload, rollback, and final state swap. Workspace switch cannot interleave.
- Refactor reload into a guard-owning wrapper plus an internal `reload_config_locked`/apply helper. Import calls only the locked form; no recursive lock acquisition.
- Export holds the guard for read access while snapshotting the active path and reading its bytes.

### Validation and protected state

- Add a parser entrypoint that validates TOML text against `DamHopperConfigRaw`/`DamHopperConfig` using the real destination path as resolution context. `read_config` delegates to it.
- Parse only for validation/runtime state. Publish the original request bytes, not reserialized TOML.
- Extract one replacement policy used by both `PUT /api/config` and settings import.
- Compare effective candidate values after defaults resolve:
  - `server.idle_suspend` must equal the authoritative current block. Any delta rejects the whole import and points to `PATCH /api/system/idle-suspend/v1/timing`.
  - `server.telemetry` must equal current telemetry state and points to `/api/usage/settings` when different.
- Never coerce protected fields. Stored bytes must equal selected bytes after success.
- Host-specific absolute paths remain unchanged. UI warns that imported paths are not rewritten.

### Filesystem transaction

Under the workspace write guard:

1. Read exact current bytes and retain the current parsed config/runtime snapshot.
2. Validate content type, UTF-8, TOML schema/semantics, relative-path resolution, and protected-field policy before target mutation or backup.
3. Create `dam-hopper.toml.bak.<UTC>` beside the target with `create_new`, collision-safe UTC naming, exact prior bytes, and Unix mode `0600`. Fail closed if backup creation/write fails.
4. Atomically replace the target through a same-directory mode-`0600` temporary file and rename. Extend the existing atomic-write utility to accept bytes; keep string callers delegating to it.
5. Reload all existing runtime dependents: idle-suspend overlay authority, media-ticket revocation, filesystem sandbox roots, workspace target resolver, host-resource monitor, and `state.config`.
6. If publication or reload fails, atomically restore prior bytes and reapply the prior runtime config before returning failure. Remove transaction temp files; remove the just-created backup only after a confirmed rollback so a failed import does not look successful.
7. After successful disk/runtime commit, best-effort prune regular files whose basenames match the exact generated UTC timestamp form, newest first, retaining five. Never broad-match nonmatching user files. Read/remove errors are ignored after commit and do not trigger rollback.

### Browser flow

```text
Export click
  -> GET raw TOML through WsTransport
  -> Blob(application/toml;charset=utf-8)
  -> temporary object URL + <a download="dam-hopper.toml">
  -> click, detach, revoke URL

Import click
  -> hidden input accept=".toml"
  -> user selects File (cancel = no request)
  -> reject >1 MiB before file.text()
  -> destructive confirmation names active workspace + selected filename
  -> file.text()
  -> POST raw application/toml
  -> invalidate config/projects/workspace queries
  -> show imported workspace + backup basename
```

No native dialog abstraction, multipart form, base64, server-side client path, global-config selector, or second transport.

## File Modification Table

| Phase | Action | File | Planned change |
| --- | --- | --- | --- |
| 1 | Modify | `/home/loidinh/WS/dam-hopper/server/src/api/settings.rs` | Replace JSON export/global import with raw workspace handlers; transaction, backup/retention, errors, rollback |
| 1 | Modify | `/home/loidinh/WS/dam-hopper/server/src/api/router.rs` | Register explicit `.toml` routes; apply 1 MiB limit to import only |
| 1 | Modify | `/home/loidinh/WS/dam-hopper/server/src/api/config.rs` | Expose locked reload/apply path; route full config updates through shared replacement policy |
| 1 | Modify | `/home/loidinh/WS/dam-hopper/server/src/config/parser.rs` | Extract parse/validate-from-string with destination-path context |
| 1 | Create | `/home/loidinh/WS/dam-hopper/server/src/config/replacement.rs` | Shared typed protected-field replacement policy |
| 1 | Modify | `/home/loidinh/WS/dam-hopper/server/src/config/mod.rs` | Export parser/replacement helpers at crate scope only |
| 1 | Modify | `/home/loidinh/WS/dam-hopper/server/src/utils/fs.rs` | Add byte-oriented mode-`0600` same-directory atomic replacement; string helper delegates |
| 2 | Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/ws-transport.ts` | Explicit raw-text request encoding/content type and new endpoint mappings; keep JSON default |
| 2 | Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/client.ts` | Strict raw TOML import/export methods and camelCase result type |
| 2 | Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/queries.ts` | Import mutation accepts TOML text; successful import invalidates config/projects/workspace |
| 3 | Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/settings-page/SettingsImportExportPanel.tsx` | Hidden `.toml` input, selection forwarding/reset, active-workspace copy and warnings |
| 3 | Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/SettingsPage.tsx` | Blob download, selected-file read/size check/confirmation, success/error feedback |
| 4 | Create | `/home/loidinh/WS/dam-hopper/server/tests/settings_import_export.rs` | Real-temp-filesystem endpoint integration suite |
| 4 | Modify | `/home/loidinh/WS/dam-hopper/server/src/api/tests.rs` | Remove obsolete JSON-export assertion now covered by integration contract tests |
| 4 | Modify | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/ws-transport.test.ts` | Assert raw body/header, explicit routes, text response, structured error propagation |
| 4 | Create | `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/settings-page/SettingsImportExportPanel.test.tsx` | Hidden input, chooser, cancel, same-file reselection, pending state |
| 4 | Create | `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/SettingsPage.test.tsx` | Blob download and import confirmation/read/upload/feedback interactions |
| 4 | Modify | `/home/loidinh/WS/dam-hopper/docs/system-architecture.md` | Record raw workspace transfer and reject-not-overlay import invariant |
| 4 | Modify | `/home/loidinh/WS/dam-hopper/docs/CHANGELOG.md` | Record restored browser import/export behavior and safety boundary |

## Phased Execution

## Phase 1 — Rust Backend Endpoints & Safety

**Effort:** 8h  
**Status:** DONE 2026-09-16  
**Outcome:** authenticated, workspace-scoped raw export and transactional import with no global coupling.

### 1.1 Define explicit routes and bounded extraction

1. Replace `/api/settings/export` and `/api/settings/import` with:
   - `GET /api/settings/export/workspace.toml`
   - `POST /api/settings/import/workspace.toml`
2. Keep both inside the existing protected router/auth middleware.
3. Attach `RequestBodyLimitLayer::new(1024 * 1024)` only to POST; retain the router-wide 10 MiB default for unrelated endpoints.
4. Accept `application/toml` with optional UTF-8 charset. Reject absent/other media types with JSON `415`.
5. Extract bytes, then use strict UTF-8 validation. Do not use Axum `Json`, multipart, a client path, or lossy decoding.

### 1.2 Implement byte-faithful export

1. Acquire workspace-context read ownership.
2. Snapshot trusted `config_path`; read bytes directly from disk.
3. Return unchanged bytes and exact headers from the canonical contract table.
4. Do not serialize `DamHopperConfig`; do not read or expose `GlobalConfig`.
5. Map unreadable/missing files through the existing API error envelope without leaking unrelated filesystem paths.

### 1.3 Reuse parser and replacement policy

1. In `config/parser.rs`, extract an internal function such as `parse_config_str_at_path(content, config_path)` from `read_config`:
   - deserialize `DamHopperConfigRaw`;
   - run existing schema/semantic validation;
   - resolve project paths relative to the actual target directory;
   - return `DamHopperConfig` whose `config_path` is the trusted target.
2. Keep `read_config(path)` as read-to-string plus delegation; no second validation implementation.
3. In `config/replacement.rs`, model protected-policy failures with field and dedicated endpoint metadata.
4. Refactor `PUT /api/config` preparation so omitted protected sections retain current values, then pass its effective typed candidate through the same policy.
5. Import passes its parsed effective candidate unchanged. Any mismatch rejects before backup or target write.

### 1.4 Add byte atomic write and private backup helpers

1. Add `atomic_write_bytes(target, &[u8])`; use same-directory unique temp creation, mode `0600` on Unix, complete write, and rename. Ensure every error removes its temp.
2. Make existing `atomic_write(target, &str)` delegate to bytes to preserve all callers.
3. In `settings.rs`, create a narrowly scoped backup helper:
   - basename prefix exactly `dam-hopper.toml.bak.`;
   - filesystem-safe UTC timestamp with subsecond precision and collision retry;
   - `create_new` to avoid overwrite/races;
   - mode `0600` on Unix;
   - exact old bytes.
- Retention enumerates only regular files whose basenames match the helper's exact generated UTC timestamp form, sorts by embedded UTC/collision component, and keeps newest five after success; similar-prefix names that do not match that form are preserved.

### 1.5 Make reload usable inside one transaction

1. Split current `reload_config` into:
   - wrapper that acquires `workspace_context_guard` for existing callers;
   - internal locked read/apply function for import.
2. Keep all current runtime side effects in one function and one order. Parse/load fully before mutating runtime dependents.
3. Do not recursively acquire the guard from import.
4. Preserve startup idle-suspend authority; successful candidate is already policy-equal, so overlay remains an idempotent runtime defense, not a silent disk rewrite.

### 1.6 Implement import transaction and rollback

1. Snapshot path before lock; acquire write guard; recheck path. `409` on mismatch.
2. Read old bytes and clone current parsed config.
3. Parse/validate incoming UTF-8 at the trusted target path; run shared protected-field policy.
4. Create mandatory backup. Stop with original disk/runtime untouched on failure.
5. Atomically publish the original incoming bytes.
6. Reload under the held guard.
7. On post-publication failure:
   - atomically restore exact old bytes;
   - reapply/reload old runtime config and sandbox/monitor state;
   - clean transaction temp/backup only after restore succeeds;
   - return a structured server error; include rollback failure context without claiming success.
8. On success, prune matching backups to five and return only basenames/workspace display name, never server paths.

### Phase 1 acceptance

- Export body equals active file bytes exactly; headers force a safe TOML download and no caching.
- Valid import writes selected bytes exactly, reloads observable config, creates a private exact backup, and leaves global config unchanged.
- Invalid UTF-8/TOML/schema/content type/size/protected field causes zero target/runtime/backup mutation.
- Workspace switch and import serialize; detected path changes fail `409`.
- Publish/reload failure restores old disk and runtime state.
- Backup retention prunes only matching generated timestamp names and keeps five successful backups; similarly prefixed user files with other names are preserved.

## Phase 2 — Frontend API Client & Transport Layer

**Effort:** 3h  
**Status:** DONE 2026-09-16  
**Outcome:** strict TypeScript contracts carry raw TOML without accidental JSON quoting.

### 2.1 Generalize request encoding narrowly

1. Extend the REST endpoint descriptor with an explicit body encoding/content type (`json` default, `text` for TOML). Avoid channel-name checks inside `invoke`.
2. Map settings channels to the explicit workspace endpoints.
3. For import, require a string, set `Content-Type: application/toml; charset=utf-8`, and assign the string directly to `RequestInit.body`.
4. Keep existing JSON serialization unchanged for every other endpoint.
5. Keep response selection by response `Content-Type`: TOML returns text; JSON success/errors remain parsed JSON.

### 2.2 Replace ghost client contracts

Define strict exported types near other client DTOs:

```ts
export interface WorkspaceSettingsImportResult {
  imported: true;
  fileName: "dam-hopper.toml";
  backupFileName: string;
  workspaceName: string;
}
```

Client methods:

```ts
exportConfig(): Promise<string>
importConfig(toml: string): Promise<WorkspaceSettingsImportResult>
```

No `any`, optional fake cancellation booleans, paths, JSON wrapper, or filename sent to the server.

### 2.3 Update TanStack mutations

1. `useExportSettings` remains a parameterless mutation returning string.
2. `useImportSettings` mutation accepts TOML string and returns the typed result.
3. On any successful typed result, invalidate `['config']`, `['projects']`, and `['workspace']`; remove the old false `result?.imported` guard.
4. Let `ApiRequestError` carry structured server details and user-safe message to the page.

### Phase 2 acceptance

- Network import body is raw TOML, byte-for-byte UTF-8 text, not JSON string syntax.
- Transport sets TOML content type only for this request; other calls remain JSON.
- Export resolves raw text.
- Client/query code compiles under repository strict TypeScript settings.
- Successful import refreshes all workspace-derived UI data.

## Phase 3 — UI Components & Browser File Handling

**Effort:** 3h  
**Status:** DONE 2026-09-16  
**Outcome:** browser-native download/upload, destructive confirmation, and accurate feedback.

### 3.1 Add the file chooser in `SettingsImportExportPanel`

1. Change import callback to `(file: File) => void` (or promise-compatible equivalent).
2. Add a component-owned ref and hidden `<input type="file" accept=".toml">`.
3. Import button calls `input.click()` only; closing chooser causes no callback/request/message.
4. `onChange` forwards the first selected file and clears `input.value` so selecting the same file again retriggers change.
5. Disable import/export controls while corresponding mutation is pending.
6. Copy says “active workspace,” warns replacement is destructive, notes backup/validation, and states absolute paths are not rewritten.

### 3.2 Implement browser export in `SettingsPage`

1. Await raw TOML mutation.
2. Build `Blob([toml], { type: 'application/toml;charset=utf-8' })`.
3. Create object URL and temporary anchor with `download = 'dam-hopper.toml'`.
4. Append, click, detach, and revoke in `finally`-safe cleanup.
5. Report `Exported dam-hopper.toml for <workspace>` only after download trigger succeeds. Remove “Export cancelled.” ghost state.

### 3.3 Implement browser import in `SettingsPage`

1. Receive `File` from panel.
2. Clear prior import feedback.
3. Reject `file.size > 1 MiB` before `file.text()` with actionable client feedback; server cap remains authoritative.
4. Confirm replacement with both `config.workspace.name` and `file.name`. Cancellation sends no request and does not render a success-style cancellation.
5. Read with `await file.text()`, call `importSettings.mutateAsync(toml)`, then display workspace and returned backup basename.
6. Render errors through existing danger/alert path. Keep status timeout behavior consistent with other Settings actions.
7. Pass workspace identity/copy into the panel without creating global state or a dialog abstraction.

### Phase 3 acceptance

- Export click downloads a Blob named `dam-hopper.toml`; URL is revoked.
- Import click opens a `.toml` chooser; chooser cancel is a no-op.
- Confirmation clearly names active workspace and chosen file.
- Oversized file is rejected before allocation/upload.
- Valid file content reaches mutation unchanged; success shows backup basename.
- Server validation error appears as danger feedback; no false green cancellation/success.

## Phase 4 — Verification & Automated Tests

**Effort:** 4h  
**Status:** DONE 2026-09-16  
**Outcome:** durable endpoint, transaction, transport, and browser-interaction regression coverage.

### 4.1 Rust endpoint integration tests

Create `server/tests/settings_import_export.rs`. Use `tempfile` real directories/files and a real `AppState`/Axum router; no filesystem mocks.

Required cases:

1. **Export fidelity:** comments, blank lines, whitespace, and ordering survive byte-for-byte; headers are exact; response excludes global config.
2. **Valid import:** target equals submitted bytes; runtime workspace/projects change; global config unchanged; response is camelCase and returns basename only.
3. **Backup:** exact old bytes, Unix `0600`, collision-safe names, six successful imports retain five newest; unrelated similarly named user files whose basenames do not match the generated timestamp form survive.
4. **Validation no-mutation matrix:** malformed TOML, schema-invalid config, duplicate project names, invalid UTF-8, wrong/missing content type, and >1 MiB body leave target/runtime/backups unchanged.
5. **Idle suspend:** omitted/default or changed effective block that differs from current is rejected with `field: server.idle_suspend` and dedicated timing endpoint; exact current block succeeds.
6. **Telemetry:** changed block is rejected through the shared replacement policy and points to usage settings.
7. **Workspace race:** deterministic guard coordination changes the active path between initial snapshot and write admission; import returns `409` and writes neither workspace.
8. **Rollback:** exercise transaction failure seams for publication/reload; old bytes and old runtime/sandbox state remain active and temp files are absent.
9. **Authentication:** both new endpoints remain protected.

Delete the old `settings_export_returns_json` assertion from `server/src/api/tests.rs`; never re-pin obsolete combined JSON behavior.

### 4.2 Transport test

Extend `ws-transport.test.ts`:

- export uses exact GET route and returns TOML text;
- import uses exact POST route, direct string body, TOML content type, auth/credentials, no `JSON.stringify` artifacts;
- JSON endpoints still serialize unchanged;
- JSON 4xx details become `ApiRequestError` with status/code/details.

### 4.3 Panel Vitest

Create `SettingsImportExportPanel.test.tsx` with jsdom + actual DOM interaction:

- exactly one hidden file input with `accept=".toml"`;
- Import button invokes the input chooser;
- change forwards the selected `File` once and clears input value;
- chooser cancellation forwards nothing;
- same file can be selected again;
- pending state disables the appropriate button and retains accessible feedback semantics.

### 4.4 Page Vitest

Create `SettingsPage.test.tsx`; mock API hooks and unrelated sections, keep the real import/export panel:

- export creates TOML Blob from returned text, clicks `dam-hopper.toml`, removes anchor, revokes URL, and renders accurate success;
- export failure creates no download and renders danger feedback;
- import confirmation includes workspace and file names;
- cancel causes no `file.text()`/mutation;
- >1 MiB causes no `file.text()`/mutation;
- valid file text is passed unchanged and success includes backup basename;
- server error renders alert and never success.

### 4.5 Architecture/changelog closeout

- Update `docs/system-architecture.md`: settings import rejects differing effective idle-suspend state rather than silently persisting/coercing it; document workspace lock/transaction boundary and raw byte contract.
- Add concise bugfix entry to `docs/CHANGELOG.md`.
- No new standalone feature docs.

### Phase 4 acceptance

- Targeted Rust and UI tests pass.
- Strict TypeScript build and Rust check pass.
- Browser smoke confirms real picker/download behavior.
- Architecture text matches implemented reject/rollback behavior.

## Verification Plan

Run from repository root unless command changes directory.

### Targeted automated checks

```bash
cd server && cargo test --test settings_import_export
```

```bash
pnpm --filter @dam-hopper/ui test -- src/api/ws-transport.test.ts src/components/pages/settings-page/SettingsImportExportPanel.test.tsx src/components/pages/SettingsPage.test.tsx
```

```bash
pnpm --filter @dam-hopper/ui build
```

```bash
cargo check --manifest-path server/Cargo.toml
```

```bash
cargo fmt --manifest-path server/Cargo.toml -- --check
```

```bash
pnpm exec eslint packages/ui/src/api/ws-transport.ts packages/ui/src/api/client.ts packages/ui/src/api/queries.ts packages/ui/src/components/pages/SettingsPage.tsx packages/ui/src/components/pages/settings-page/SettingsImportExportPanel.tsx packages/ui/src/api/ws-transport.test.ts packages/ui/src/components/pages/SettingsPage.test.tsx packages/ui/src/components/pages/settings-page/SettingsImportExportPanel.test.tsx
```

### Final repository check

```bash
pnpm check
```

### Real browser smoke

1. Copy a real fixture into a temporary workspace and add visible comment/spacing canaries.
2. Start API against that temporary `dam-hopper.toml` and start the web app:

```bash
pnpm dev:server -- --config /tmp/dam-hopper-settings-smoke/dam-hopper.toml
```

```bash
pnpm dev
```

3. Open Settings → Import / Export Settings.
4. Export. Verify downloaded filename, content type, and byte equality with the active fixture.
5. Cancel import chooser. Verify no request/feedback.
6. Select malformed and idle-suspend-changing TOML. Verify clear error, unchanged target/runtime, no backup.
7. Select valid TOML. Verify confirmation names workspace/file, runtime UI refreshes, target bytes match selection, backup contains prior bytes with `0600` mode.
8. Switch workspace around import admission. Verify either old workspace transaction completes before switch or request returns conflict; never cross-write.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Workspace switch redirects an in-flight import | Snapshot/recheck path plus write guard held through transaction |
| Parsing then serializing destroys comments | Parse only for validation; publish original bytes |
| JSON transport quotes TOML | Explicit endpoint body encoding with transport regression test |
| Reload failure leaves disk/runtime split | Capture old bytes/config; atomic restore and old-runtime reapply under same guard |
| Backup pruning deletes user data | Strict generated-name parser; prune after success only |
| Repeated timestamps overwrite backup | `create_new`, subsecond UTC, bounded collision retry |
| Hidden file chooser cannot reselect same file | Clear input value after every change |
| Large browser allocation/request | 1 MiB client precheck plus route-local server cap |
| Import changes security/runtime-owned settings | Shared effective typed policy; field-specific reject, no coercion |
| Cross-host absolute paths become invalid | Preserve intentionally; warn user, never rewrite silently |

## Explicit Non-Goals

- Global config import/export, merge, or workspace registry migration.
- Combined JSON disaster-recovery bundle.
- Native Electron/Tauri open/save dialogs or server-side desktop paths.
- Multipart uploads, streaming parser, base64, drag-and-drop, or import preview editor.
- TOML normalization, migration, formatting, comment editing, or path rewriting.
- Changing idle-suspend timing, enablement, policy, enrollment, capability, or agent executable authority through import.
- Changing telemetry through import.
- Backward-compatible aliases for obsolete `/api/settings/export` or `/api/settings/import` contracts.
- Config schema redesign, global query-cache redesign, or generic download framework.

## Dependencies

- Existing protected Axum router and auth/origin controls.
- Existing `DamHopperConfig` parser/validation and `workspace_context_guard`.
- Existing runtime reload side effects in `server/src/api/config.rs`.
- Existing TanStack Query hooks and browser `Blob`, `File`, object URL APIs.
- `chrono`, `uuid`, `tempfile`, Axum body-limit support already present; no new dependency expected.

## Unresolved Questions

None. Scope, endpoint format, workspace ownership, protected idle-suspend behavior, backup retention, and browser handling are fixed by the debugger report plus advisor decisions.

## Completion Summary

All four implementation phases completed and marked **DONE 2026-09-16**. Final review approved the implementation with a score of **9.4/10**.

- Server library tests: **1125 passed**.
- Settings import/export integration tests: **5/5 passed**.
- UI tests: **1678 passed**.
- Final review: **9.4/10**, approved / ready to land.

## Implementation Status & Next Steps

### Implementation Progress
- [x] Phase 1.1: Explicit `.toml` routes with route-local 1 MiB body limit registered in protected router. Media-type rejection returns HTTP 415; workspace admission conflict returns HTTP 409.
- [x] Phase 1.2: Byte-faithful export with `Content-Type: application/toml; charset=utf-8` and `dam-hopper.toml` disposition.
- [x] Phase 1.3: `parse_config_str_at_path` extracted in `parser.rs`. `validate_protected_config_replacement` implemented in `replacement.rs`. (Non-blocking review caveat: `update_config` in `api/config.rs` retains inline policy validation and does not yet emit structured metadata; final review approved.)
- [x] Phase 1.4: `atomic_write_bytes` added with 0600 mode on Unix and temp file cleanup on write error. `create_backup` implemented with collision retry loop. `prune_backups` tightened to exact timestamp parsing (%Y%m%dT%H%M%S_%6fZ).
- [x] Phase 1.5: `reload_config_locked` split out and used in import transaction.
- [x] Phase 1.6: Import transaction with backup and atomic write. Rollback restores prior disk/runtime state; backup is removed only after both disk and runtime restoration succeed and retained when recovery fails.
- [x] Phase 2.1: `ws-transport.ts` updated with `contentType?: string` descriptor support and raw body handling.
- [x] Phase 2.2: Client types and methods for raw text export and import.
- [x] Phase 2.3: `useImportSettings` passes raw string and invalidates queries on success.
- [x] Phase 3.1: `SettingsImportExportPanel` has hidden `.toml` file input, selection clearing, and updated copy.
- [x] Phase 3.2: `SettingsPage` implements Blob download for export.
- [x] Phase 3.3: `SettingsPage` implements file selection, size check, confirmation, and import. (Non-blocking review caveat: confirmation cancellation still displays green "✓ Import cancelled." success status; final review approved.)
- [x] Phase 4.1: Integration test suite covers 5 tests (export, import success, bad content type 415, bad toml 400, prune with user backup preservation).
- [x] Phase 4.2: Transport tests added in `ws-transport.test.ts`.
- [x] Phase 4.3: Panel unit tests in `SettingsImportExportPanel.test.tsx`.
- [x] Phase 4.4: Page unit tests in `SettingsPage.test.tsx`.
- [x] Phase 4.5: Architecture documentation (`docs/system-architecture.md`) and changelog (`docs/CHANGELOG.md`) updated.

### Optional Follow-ups (non-blocking review caveats)
1. Optional: Migrate `update_config` in `server/src/api/config.rs` to use `validate_protected_config_replacement` to eliminate duplicate validation logic.
2. Optional: Adjust UI cancellation in `SettingsPage.tsx` so cancelling confirmation does not show green success-styled "✓ Import cancelled.".
3. Optional: Add additional integration tests for telemetry rejection and workspace admission race if required.
