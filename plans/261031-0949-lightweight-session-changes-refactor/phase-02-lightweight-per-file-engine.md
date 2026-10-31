# Phase 02 — Lightweight per-file engine and lazy comparison

Priority P1 · DONE (2026-10-31 21:34:24 +07:00) · 0.75d · owner: Rust engine implementer.
Marked DONE per user direction; technical acceptance remains incomplete per the Cycle 3 review.
Context: [design](../reports/design-261031-0949-lightweight-session-changes-refactor.md), [lifecycle gate](phase-01-config-and-extension-lifecycle.md). Current symbols: `capture.rs::prepare_session_capture`, `inventory.rs::capture_inventory`, `comparison.rs::{run_comparison_scan,list_changed_files,get_file_detail}`, `control.rs::handle_settled`, `store.rs::{SessionChangesRecord,SessionChangesService}`.

## Architecture and cutover contract

Delete recursive inventory/absence machinery, not just its callers. Retain useful bounded byte/text helpers in existing modules. `mod.rs` loses `absence` and `absence_tests`; delete both files. Replace `BaselineInventory`, `FromNowRecord` and duplicated `current_revision_manifest` with a bounded per-path map containing stable file ID, immutable first-touch original presence/bytes/mode, provenance/reason and capture reservation. Registration is metadata-only; baseline ID now identifies the tool-observed session record, not a repository-wide snapshot.

Private base remains `/private/session-changes/v1`, with existing PTY bearer authentication. Replace `/prepare`, `/activate`, `/receipt`, `/fail` and their barrier DTOs with `POST /register`; retain metadata-only `/lookup` and `/settled`; add `POST /capture`. Public `/status`, `/files`, `/refresh`, `/files/{fileId}` remain; remove scan-based `/from-now` and its client path in Phase 04, with no compatibility shim. Never make a public viewer request register a producer or manufacture historical originals.

### Wire and state rules for downstream owners

- `/register`: `{version:1, ompSessionId, rootId, cwdHint?}`; bearer derives terminal/incarnation, bounded existing root preflight derives authority. Idempotently returns current `{serverEpoch,terminalIncarnation,ompSessionId,rootId,baselineId}` and metadata status. No file enumeration/content reads; root metadata validation is allowed only here.
- `/capture`: registration tuple plus `captureId`, `paths` (normalized root-relative literals), and `mode: "preEdit" | "unproven"`. Enforce existing 16 KiB body bound; chunk requests within one total tool deadline. Per-path result includes `fileId`, presence/provenance, captured/already-known/unknown disposition and reason. Validate request version, tuple, path count/length and generation before work.
- `preEdit` reserves each first-touch slot before read, deduplicates concurrent first capture, admits bytes before allocation and seals the first result. Only a safely probed `ENOENT` proves `Absent` (new provenance `absentAtFirstTouch`, replacing `absentInVerifiedDirectory`). Permission/read/race/exclusion/timeout failures yield `Unknown/Unproven`, never `Absent`.
- `unproven` records a post-result-only path without reading its original. For a timed-out `captureId`, it invalidates that attempt's pending/late publication and conservatively downgrades an unacknowledged result from the same attempt; never damages an earlier independently acknowledged baseline. Unknown is sticky for that path; later capture cannot adopt post-edit bytes as the original.
- Status uses metadata readiness `ready`/`incomplete`/`missing`/`unavailable`, `origin: "toolObserved"`, `acknowledgment: "notApplicable"`; remove obsolete barrier-only states/fields/vectors from Rust and migrate TS in Phase 04. Coverage describes observed paths, never whole-root completeness. Add explicit disabled error/state semantics consistent across Rust/TS (producer/public requests return no-store 503 `trackingDisabled`).
- `/settled`: existing session/baseline/epoch/turn tuple; record last settled turn, bounded dedup IDs and dirty generation only. `/lookup` and public `/status` project cached metadata only, with no filesystem metadata/content access, comparison work, spawned jobs or hidden retries.
- Preserve `rootId` through every public call, including refresh; do not retain current hard-coded `"."` routing where it can select the wrong record.
- `/files` first page may omit `comparisonRevision`: explicit viewer request computes a bounded tracked-path comparison and returns revision plus files. Cursor pages require that revision. `/refresh` recomputes and publishes a new immutable revision. Detail is fenced by expected revision; any lazy re-read that differs invalidates/rejects stale revision rather than mixing bytes and counts from different revisions. A request never scans unobserved paths.
- Baseline IDs and service generation fence publication; `serverEpoch` fences restarts. Revision/file IDs are opaque and cannot be used as filesystem paths. UI query keys include owner, identity, root and revision.

These concrete field additions/removals must be reflected in `server/tests/fixtures/session-changes-wire.json`, TS decoders/clients and producer tests before integrated qualification. The approved design remains authority if a discovered source constraint requires contract revision; coordinate every consumer before implementation proceeds.

## Independently verifiable task boundaries

Every task performs its own local compile, focused behavior tests, smoke and review before evidence-backed completion; no predecessor borrows evidence from `qualify-integrated-session-changes`. `per-file-capture-engine` migrates every Rust consumer/test that would otherwise fail to compile when inventory/barrier types disappear, including the existing comparison implementation's real bounded per-path storage access. It leaves a working capture + explicit-refresh path, not a stub or dangling symbol. `lazy-view-comparison` then owns viewer bootstrap/revision behavior and eliminating any remaining eager entrypoint work; `qualify-engine-protocol` expands already passing tests, not the first executable coverage.

Add new wire fixture vectors without deleting legacy test vectors still used by unmigrated TS consumers. These temporary test inputs are not production protocol aliases or shims; `lazy-panel-and-triggers` removes them together with the last TS consumers. Rust tests migrate to the new vectors at the task that changes their contract, keeping both language builds locally compilable between steps.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "per-file-capture-engine",
    "title": "Replace repository inventory with bounded first-touch file capture",
    "blocked_by": ["server-session-changes-switch"],
    "allowed_files": ["server/src/session_changes", "server/src/api/session_changes.rs", "server/src/api/router.rs", "server/tests/fixtures/session-changes-wire.json", "server/tests/session_changes_protocol.rs", "server/tests/session_changes_controls.rs", "server/tests/session_changes_api.rs", "server/tests/session_changes_adversarial.rs", "server/tests/session_changes_lifecycle.rs"],
    "constraints": ["Delete absence.rs and absence_tests.rs and all capture_inventory traversal; no Git status/diff or shell scan replacement.", "Enforce 2 MiB per original, 64 MiB global retained storage, 500 tracked paths per session and 32 retained identities before allocation/publication.", "Registration is metadata-only; timeout/unproven capture is never upgraded from post-edit bytes; maintain authenticated PTY/root/generation fences.", "Migrate all Rust callers, comparison storage access and existing affected unit/integration tests in this task, keeping real capture and explicit-refresh behavior working; Phase 03's prerequisite asset already exists.", "Retain only legacy test fixture vectors needed by still-unmigrated TS tests until the UI task removes them; no production old-protocol fallback."],
    "acceptance": ["Register creates an empty bounded record; supported pre-edit capture stores exact original once or verified absence; repeated edits preserve it.", "Concurrent same-path capture has one reservation; unknown/timeout and OFF/remove races cannot publish false originals or leak byte reservations.", "No AbsenceTrie, recursive walker, from-now snapshot API, three-step barrier or obsolete inventory storage remains in server domain/API; affected Rust tests compile against new types now.", "Existing comparison callers operate on the bounded observed-path map without old inventory types; explicit refresh/detail remain real and locally smoke-testable before the lazy-view successor.", "Direct-path containment, symlink, ignored/nested-root, special-file and unstable-file exclusions remain explicit unknown/excluded coverage, never fabricated additions."],
    "verification": ["At this task boundary run cargo check --manifest-path server/Cargo.toml, cargo test --manifest-path server/Cargo.toml session_changes and cargo test --manifest-path server/Cargo.toml --test session_changes_protocol --test session_changes_controls --test session_changes_api --test session_changes_adversarial --test session_changes_lifecycle; update basic compile/contract expectations here, not in descendants.", "Smoke real register/capture/explicit-refresh against a temp project through actual service/API: first touch, ENOENT, repeated capture, quota release and comparison of captured originals. Inspect removed traversal/barrier callsites in local review; record fresh compile/tests/smoke/review evidence before completion."]
  },
  {
    "id": "lazy-view-comparison",
    "title": "Move all current reads and line stats behind explicit viewer requests",
    "blocked_by": ["per-file-capture-engine"],
    "allowed_files": ["server/src/session_changes", "server/src/api/session_changes.rs", "server/tests/fixtures/session-changes-wire.json", "server/tests/session_changes_protocol.rs", "server/tests/session_changes_controls.rs", "server/tests/session_changes_api.rs", "server/tests/session_changes_adversarial.rs", "server/tests/session_changes_lifecycle.rs"],
    "constraints": ["Settled/status/lookup may update or project bounded metadata only; no file reads, stats, diff tasks or whole-root discovery.", "Reuse text_diff bounds and blocking permits; only compare paths in the session map on files/refresh/detail requests.", "Retained original/current buffers share accounting and avoid duplicate clones; transient current reads remain bounded by per-file size and concurrency permits."],
    "acceptance": ["With no viewer, session start and repeated settled/status calls perform zero file-content reads and zero diffs; settled/status perform zero disk access.", "Opening files lazily reads tracked current paths and returns bounded line counts; reverting exact original bytes removes the row; new/deleted/mode-only/binary/unknown rows are honest.", "Files bootstrap without an existing comparison; cursor/detail/refresh cannot mix baseline/root/revision or publish after OFF/generation change.", "Detail reports presence directly from provenance, enforces text rendering bounds and handles current mutation with an explicit stale-revision response."],
    "verification": ["At this task boundary run cargo check --manifest-path server/Cargo.toml, cargo test --manifest-path server/Cargo.toml session_changes::comparison and cargo test --manifest-path server/Cargo.toml --test session_changes_protocol --test session_changes_controls --test session_changes_api --test session_changes_adversarial --test session_changes_lifecycle; author no-work and lazy-bootstrap assertions here using deterministic I/O/diff seams.", "Smoke real register/capture/settled/status followed by files/refresh/detail on a temp project; prove zero unviewed reads/diffs and coherent revision/revert behavior. Collect local review and completion evidence before the expanded regression/UI successors; no browser or descendant report is required."]
  },
  {
    "id": "qualify-engine-protocol",
    "title": "Author regression coverage for lightweight engine and producer protocol",
    "blocked_by": ["lazy-view-comparison"],
    "allowed_files": ["server/tests/session_changes_protocol.rs", "server/tests/session_changes_controls.rs", "server/tests/session_changes_api.rs", "server/tests/session_changes_adversarial.rs", "server/tests/session_changes_lifecycle.rs", "server/tests/fixtures/session-changes-wire.json", "server/src/session_changes/capture_tests.rs", "server/src/session_changes/comparison_tests.rs", "server/src/session_changes/types_tests.rs", "server/src/session_changes/root_tests.rs"],
    "constraints": ["Expand existing passing scan/barrier migration tests rather than defer predecessors' first coverage here; preserve bearer/root/PTY/owner failure coverage.", "Run this task's own compile/tests/local smoke/review before completion; final integrated qualification is additional cross-layer evidence.", "No permanent runtime telemetry, test-only bypass of containment/auth or mocked claim of real OMP qualification."],
    "acceptance": ["Fixtures cover registration, preEdit/unproven capture, disabled response, toolObserved status and revisionless files bootstrap with root propagation.", "Tests cover 2 MiB boundary and +1, 64 MiB global boundary across sessions, 500/501 paths, 32/33 sessions, duplicate requests and reservation release.", "Tests prove no late publication after timeout/OFF/session switch/terminal removal and no filesystem/diff work from settled/status.", "Existing retained-session exit/removal, restart fencing, invalid bearer, symlink escape, ignored paths and read-only review behaviors remain covered."],
    "verification": ["At this task boundary run cargo check --manifest-path server/Cargo.toml, cargo test --manifest-path server/Cargo.toml --test session_changes_protocol --test session_changes_controls --test session_changes_api --test session_changes_adversarial --test session_changes_lifecycle and cargo test --manifest-path server/Cargo.toml session_changes.", "Smoke the new boundary/race cases through real temp-project service/API calls, collect independent local review and exact compile/test/smoke results before completion; fixture consumer review does not require UI or live OMP descendants."]
  }
]
```

- [x] <!-- evcrate-task:per-file-capture-engine --> Replace repository inventory with bounded first-touch file capture
- [x] <!-- evcrate-task:lazy-view-comparison --> Move all current reads and line stats behind explicit viewer requests
- [x] <!-- evcrate-task:qualify-engine-protocol --> Author regression coverage for lightweight engine and producer protocol

## Ordered implementation

### `per-file-capture-engine`

1. Replace domain DTOs/constants and record ownership first; preserve existing path/depth/body/concurrency bounds where still applicable. Remove trie limits and old 128/512 MiB scan budgets rather than retaining confusing dead constants.
2. Implement per-file safe open/probe in `inventory.rs` or `capture.rs`, without `read_dir` recursion. Normalize once, reject traversal/unsupported URLs, resolve beneath authorized canonical root, reject symlink ancestors/target and special files; handle nonexistent target using a validated parent chain. Use race-resistant open/identity validation, bounded reads and metadata-before/after stability checks.
3. Keep current configured-root preflight and per-path ignored/nested-root policies without whole-repo Git work. No tool request may broaden its root using `cwdHint` or an absolute path. Reserve slots/bytes atomically before allocation, with RAII-style release on every failure/cancellation path.
4. Implement `/register`, `/capture` modes and `/lookup` metadata; remove old producer barrier and scan-based `/from-now` server route/function. A dropped HTTP future must not leave a blocking read able to overwrite a sealed unknown row; use deadline/reservation identity and generation checks at publish.
5. Replace presence/provenance rules and fixtures. Empty/zero-byte original is Present, not Absent; only pre-edit ENOENT qualifies. Unknown reservations count toward 500 paths to bound metadata even with zero captured bytes.
6. Before completion, adapt comparison storage access and all existing Rust DTO imports/assertions in the owned unit/integration suites to the new per-path model. Provide basic register/capture/explicit-refresh tests and smoke now; keep new fixture vectors additive until TS consumer migration. Compile, run focused suites and obtain review without waiting for lazy-view or qualification successors.

### `lazy-view-comparison`

1. Delete `handle_settled`'s spawned `run_comparison_scan`; update dedup, last-settled ID and dirty hint in memory. Keep `/status` a direct state projection; do not stat the root/file to refresh availability there.
2. Complete viewer-only evaluation over at most 500 known paths using the predecessor's already-working bounded per-path comparison helpers. Reuse `compute_line_stats`, byte-equality/content-kind checks; no clone into a second inventory/manifest. Evaluate baseline/current existence only for observed paths.
3. Publish a coherent immutable comparison revision under identity/generation check. Use cheap shared immutable buffers if retained; account every retained byte against 64 MiB total so cached current views cannot bypass baseline cap. Bound transient reads to 2 MiB/file and existing two blocking permits; cap response/detail serialization separately.
4. `/files` with no revision computes first view; explicit refresh computes a new revision. Stable cursor pages use that revision. Detail validates file ID against record and requested revision; re-read only on this explicit request and return `refreshRequired` if bytes no longer match the requested snapshot, then let viewer refresh normally.
5. Make reversion remove an observed changed row; unknown originals remain unknown even if current contents resemble an empty file. Preserve binary/mode-only metadata display and honest unavailable line counts, not fake zero counts.
6. Migrate affected API/unit test expectations at this same boundary and add the basic no-work/bootstrap/revision assertions. Run local compile/tests, real API smoke and review before completion; the regression successor adds adversarial depth, not prerequisite evidence.

### `qualify-engine-protocol`

1. Expand the already migrated/passing lifecycle/protocol tests and new fixture vectors; remove any remaining obsolete Rust assertion helpers while preserving legacy fixture inputs still consumed by TS until the UI task. Do not edit prior plan contracts or historical documentation.
2. Add deterministic I/O/diff seams only where needed for no-work assertions; keep them local/test-scoped and measure production resource behavior during integrated smoke, not with fabricated fixture counters alone.
3. Cover simultaneous first touches, timed-out late completion, same-path unknown sealing, file-growth races, global cap admission, purge accounting and stale viewer revisions. Document unsupported external writers honestly.

## Failure, rollback and security/bounds

- Failure to prove pre-edit bytes yields unknown/unproven and incomplete coverage; a tool remains free to execute. Failed comparison leaves explicit old/stale revision metadata, not a false fresh result.
- Reuse private bearer-to-PTY authority and authenticated public routes; validate tuple on every operation, no-store all responses, no file/patch/token logs. Server epoch and enable generation are distinct; both matter.
- Concurrent external writers cannot be attributed exclusively to OMP. Capture stability checks detect observed races; UI continues warning about external writers. No claim of universal workspace detection.
- After OFF, stale requests cannot re-register or refill records until a new enabled generation explicitly registers. Enabling never resurrects prior baselines.
- Rollback by OFF/purge and safe remove. Never reinstate recursive scanning as fallback. Each engine task supplies its own completed local evidence; the finalizer later checks the complete producer/server/UI contract independently.
