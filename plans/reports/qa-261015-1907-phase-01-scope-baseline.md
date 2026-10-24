# QA Test Report: Phase 01 — Scope Baseline and Contract Freeze

- **Date:** 2026-10-15
- **Branch:** `feat/android-native-app`
- **Deliverables Under Test:** `docs/android-native-acceptance.md`, `native-app/README.md`
- **Result:** 4/4 Test Suites Passed (Contract documentation corrected and verified)

---

## 1. Test Results Overview

| Suite # | Test Target | Criteria | Result | Details |
|---|---|---|---|---|
| **Suite 1** | Markdown Links & Doc References | Validate all relative links in `docs/android-native-acceptance.md` & `native-app/README.md`; run `validate-docs.cjs` | **PASSED** (2/2 files clean) | 6/6 relative document links resolve on disk. `validate-docs.cjs` passed (non-blocking warnings recorded in existing docs). |
| **Suite 2** | Source Isolation & Tree Integrity | Verify zero unintended changes or deletions in `server/`, `apps/web/`, `apps/native/`, `packages/ui/`, `packages/shared/` | **PASSED** | 0 modified, deleted, or untracked files in existing server, web, desktop, and package source directories. |
| **Suite 3** | Requirements & Exclusions Catalog | Verify 30 included requirements (`A01`-`V01`) and 9 approved exclusions (`B01`-`B09`) have owning phases and testable journeys | **PASSED** (39/39 entries) | 30/30 included requirements cataloged with owning phases and observable journeys; 9/9 approved exclusions cataloged with first-release treatment. |
| **Suite 4** | Server Wire Contracts Correspondence | Verify REST routes, HTTP methods, and WebSocket frames against `router.rs` and `ws_protocol.rs` | **PASSED** (81/81 contracts) | 21/21 REST endpoints (path + HTTP method) match `router.rs`. 60/60 WS frame kinds match serde tags in `ws_protocol.rs`. |

---

## 2. Detailed Test Executions & Evidence

### Suite 1: Markdown Links and References
- `native-app/README.md`:
  - `../docs/architecture/android-native-client.md` -> Valid
  - `../docs/android-native-acceptance.md` -> Valid
  - `../plans/261015-1647-android-native-app/plan.md` -> Valid
- `docs/android-native-acceptance.md`:
  - `../plans/261015-1647-android-native-app/research/decision-context.md` -> Valid
  - `./architecture/android-native-client.md` -> Valid
  - `../plans/261015-1647-android-native-app/validation-answers.md` -> Valid
- `validate-docs.cjs` Output:
  - 0 blocking errors.
  - Pre-existing warnings in existing codebase noted (1 historical broken link in `docs/CHANGELOG.md`, 24 unverified env keys in legacy config docs).

### Suite 2: Source Code Isolation
- `git status --porcelain server apps/web apps/native packages/ui packages/shared` returned empty output.
- Untracked files strictly bounded to `native-app/`, `docs/android-native-acceptance.md`, `docs/architecture/android-native-client.md`, and `plans/261015-1647-android-native-app/`.
- Single modified file in working tree: `docs/system-architecture.md` (+19 lines introducing proposed Android client architecture reference).

### Suite 3: Scope Requirements Catalog (30 Included + 9 Excluded)
- Included requirements verified (30/30):
  - Multi-server & Auth: `A01` (Phases 03, 04), `A02` (Phase 04)
  - Shell & Config: `C01` (Phase 06), `NAV01` (Phases 06, 17), `C02` (Phases 06, 17)
  - Terminal & Agents: `T01` (Phase 07), `T02` (Phases 05, 07), `T03` (Phase 07)
  - Files & Search: `F01` (Phase 08), `F02` (Phases 08, 09)
  - Native Editor & Diff: `E01` (Phases 05, 09), `E02` (Phase 09), `E03` (Phase 10), `E04` (Phase 10)
  - Encrypted Transfer & Media: `X01` (Phases 05, 11), `M01` (Phases 09, 11)
  - Git Operations: `G01` (Phase 12), `G02` (Phase 12), `G03` (Phase 12)
  - Workflows & Plans: `W01` (Phase 13), `W02` (Phase 13)
  - Agent Store & Memory: `S01` (Phase 14), `S02` (Phase 14)
  - Host Telemetry & Usage: `H01` (Phase 15), `U01` (Phase 15)
  - Host Controls & Tunnels: `P01` (Phase 16), `H02` (Phase 16), `C03` (Phases 16, 17)
  - System & Privacy: `N01` (Phases 07, 17), `V01` (Phases 17, 18)
- Excluded requirements verified (9/9):
  - `B01` (HTML preview), `B02` (Mermaid DOM render), `B03` (Browser extension bridge), `B04` (Local PTY/Git/agents/SSH), `B05` (Desktop/PlayStore/FCM), `B06` (Remote updater/admin), `B07` (IDE shell/Runtime view), `B08` (FABs/floating overlays), `B09` (Secondary navigation rails/drawers).

### Suite 4: Wire Contracts Correspondence
Corrected Section 5 in `docs/android-native-acceptance.md` to reflect exact authoritative Rust contracts:
- REST Endpoints (21/21):
  - Auth: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/mfa/setup`, `POST /api/auth/mfa/confirm`, `POST /api/auth/mfa/verify`, `POST /api/auth/mfa/challenge`, `GET /api/auth/status`, `POST /api/auth/logout`.
  - Filesystem search: `GET /api/fs/search` (`SearchParams` with `worktreePath`, `max` default 200, cap 500, `scope` project/workspace), `GET /api/fs/search-paths`.
  - SSE Stream: `GET /api/system/resources/v1/events` (Bearer auth, no query params, initial status control emission, 32 global / 4 per-subject subscriber caps with 429 Retry-After: 30, fallback to REST `GET /api/system/metrics`).
  - Media: `POST /api/fs/video/tickets`, `DELETE /api/fs/video/tickets`, `POST /api/fs/image/tickets`, `DELETE /api/fs/image/tickets`, `DELETE /api/fs/media-session`, `GET /api/fs/video/stream/{ticket}`, `GET /api/fs/image/stream/{ticket}`.
- WebSocket Protocol (60/60 frame kinds):
  - Inbound (`ClientMsg`): `terminal:write`, `terminal:resize`, `terminal:attach`, `fs:subscribe_tree`, `fs:unsubscribe_tree`, `fs:read`, `fs:write_begin`, `fs:write_chunk`, `fs:write_chunk_binary`, `fs:write_commit`, `fs:op`, `fs:upload_begin`, `fs:upload_chunk`, `fs:upload_commit`, `auth:register_start`, `auth:register_finish`, `auth:login_start`, `auth:login_finish`, `auth:session_remove`, `fs:put_begin`, `fs:put_chunk`, `fs:put_commit`, `fs:put_save`.
  - Outbound (`ServerMsg`): `terminal:output`, `terminal:buffer`, `terminal:exit`, `terminal:lifecycle`, `terminal:lagged`, `terminal:agentStatusChanged`, `terminal:agentStatusRemoved`, `terminal:agentStatusInvalidated`, `process:restarted`, `fs:tree_snapshot`, `fs:event`, `fs:error`, `fs:overflow`, `fs:read_result`, `fs:write_ack`, `fs:write_chunk_ack`, `fs:write_result`, `fs:op_result`, `fs:upload_begin_ok`, `fs:upload_chunk_ack`, `fs:upload_result`, `auth:register_start_response`, `auth:register_finish_response`, `auth:login_start_response`, `auth:login_finish_response`, `fs:put_begin_ok`, `fs:put_chunk_ack`, `fs:put_result`, `fs:put_save_result`, `tunnel:created`, `tunnel:ready`, `tunnel:failed`, `tunnel:stopped`, `tunnel:reminder`, `port:discovered`, `port:lost`, `host:uiConnection`.

---

## 3. Unresolved Questions

1. **Phase 01 Completion Status vs Planning Ledger:**
   `plans/261015-1647-android-native-app/phase-01-scope-baseline-and-contract-freeze.md` still lists status as pending and contains an uncompleted Todo checklist. Should the planning agent advance this file's status to completed now that the contract baseline in `docs/android-native-acceptance.md` is frozen?
2. **Physical Device Acquisition Timing:**
   Reference physical device is named as Google Pixel 7 (Tensor G2, ARM64-v8a). Should physical device hardware confirmation be required prior to starting Phase 05 (crypto bridge & native terminal/editor evaluation) or only at Phase 18 (qualification)?
