# Phase 02 — Implement bounded immutable snapshots and current revisions

Priority: P2. Status: completed. Owner: **Snapshot engine owner**.

## Context and prerequisites

[Canonical overview](plan.md) · [Frozen contracts](contracts.md) · [Ownership](ownership.md) · [Acceptance matrix](acceptance-matrix.md).

contracts.md S1,S4–S8,S11; repository-evidence secure_path and size measurement. Reuse read_regular_snapshot and direct canonical resolve_vcs_root containment semantics behind the S1 bounded preflight; prohibit discover_vcs_roots/resolve_git_request_root/status/discovery helpers, not HEAD/index diff. Wire types available from freeze-session-contract.

Dependencies are exact task IDs in the single contract fence below; no phase-order inference. Dirty-start raw bytes, known absence vs unknown coverage, no-follow reads, mode-only and unsupported indicators; immutable original and bounded one-current revision. Preserve original through staging/commits; no source in diagnostics.

## Architecture and boundaries

Dedicated domain service owns private TempDir, reservations/accounting/cancellation, two global blocking permits and per-key generation. Capture builds immutable PREPARED only; comparison swaps bounded current candidate. Engine exposes real methods for server binding/control, not collector/router coupling.

Parallelization: only incomparable tasks with disjoint literal ownership may run together; see ownership.md execution groups. Same-file handoffs are explicitly dependency-ordered. At each coherent task handoff main coordinator parks writers sharing its Rust crate/TS build, runs prerequisite-local compile/tests/smoke and collects independent review, then completes task and releases descendants. No concurrent check over half-edited peer files. Final full suites/integrated OMP/native acceptance remain separate downstream gates. Contract drift stops affected consumers; no new scheduler or hydration by authoring.

## Exact writable file actions

No deletes planned. Files not listed remain read-only; escalate a missing caller instead of expanding ownership. Create means first task creator; later DAG-ordered owners Modify the already-created file.

### `capture-session-baseline` — Snapshot engine owner

- Modify `/home/loidinh/WS/dam-hopper/server/src/lib.rs` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/server/src/session_changes/mod.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/store.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/inventory.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/capture.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/capture_tests.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/root.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/root_tests.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/absence.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/absence_tests.rs` — task implementation/test or scoped evidence artifact.

### `compare-session-revision` — Snapshot engine owner

- Modify `/home/loidinh/WS/dam-hopper/server/src/session_changes/mod.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/comparison.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/text_diff.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/src/session_changes/comparison_tests.rs` — task implementation/test or scoped evidence artifact.

## Ordered implementation steps

### `capture-session-baseline`

1. Modify the already registered types-only lib.rs/mod.rs from completed freeze; implement Arc-owned service, epoch, identity reservations, private out-of-worktree TempDir, fixed bounds and allocation/disk/response lease accounting. No mutex across await/I/O; reserve before allocation.
2. Inventory tracked plus nonignored untracked for one authorized root; no recursive nested Git roots/gitlinks, no symlink/special reads. Preserve raw normalized relative path identity; reject nonUTF8/lossy collisions with explicit gaps. Complete eligible inventory does not prove historical absence. Implement S4 absence.rs metadata trie with certified complete child-name tables, excluded/opaque prefixes and bounded revalidation; no ignored content. Prove a current-only path absent only at earliest missing child under certified parent; excluded/truncated/unproven ancestry yields originalPresence unknown, unknown change/null counts. Namespace+manifest share10k nodes/8MiB/depth64; no collect-all unbounded listing.
3. Implement root.rs/root_tests.rs direct one-root preflight before capture: path4KiB/64 components,128 metadata ops/64KiB scratch/1s inside10s, <=128 untargeted candidates/512KiB input and same two permits; no discovery helper/subprocess/status hidden before admission. Read regular snapshots with secure_path, hash raw bytes and retain verified subset/mode. Final bounded inventory/metadata revalidation marks drift permanently incomplete. Track baseline manifest membership independently of future index/ignore changes.
4. Implement prepare-only reservation publication guarded by monotonic deadline/generation/credential target validation callback. TTL expiry/failure cannot later publish even when blocking closure returns. Hold permit/accounting until real completion; do not claim timeout kills I/O.
5. Add real temporary repo tests for dirty/untracked start, missing/empty, CRLF/EOF, ignored files, mode, symlink swap/ancestor races, gitlinks, limits, cancellation and late task completion. Add absence_tests.rs with ignored secret later unignored/force-added, excluded subtree later eligible, truly absent sibling, truncated parent and directory drift; verify known add only from certified absence, no ignored bytes read. Add root_tests.rs with wide/deep repository, malformed/traversal/aggregate roots, bounded candidate rejection and absence of unrelated subtree reads observed through injected filesystem-operation recorder, not source text. Use test-injected tiny limits/time control rather than production test flags.

Success criteria: AC1/2/7 local engine: actual dirty-start bytes plus bounded direct-root and certified namespace absence proof; ignored/truncated originals remain unknown, never silently complete. Private snapshots and metadata bounded; no worktree/index/branch writes, no late original publication or unbounded blocking queue.

### `compare-session-revision`

1. Union immutable original manifest with fresh eligible current names; read original paths even after stage/commit/ignore changes. For current-only paths consume frozen S4 trie certificates; ignored-at-start then eligible stays unknown/null, truly absent certified sibling is added, truncation cannot become absence. Preserve unknown absence, unsupported file kinds, mode-only and raw byte equality. Renames delete+add; reversed net content disappears.
2. Build bounded candidate current bytes privately; reserve space for old leased revision+candidate; monotonic decimal revision only on successful atomic publication. Failed refresh preserves old timestamp/revision and reports why.
3. Compute text line counts under exact byte/line/long-line/work/deadline caps; null counts for unsupported/unknown, countsComplete false. Preserve CRLF/EOF changes; absence differs from empty. Avoid expensive unbounded text algorithms.
4. Provide stable file IDs/cursors and pinned page/detail reads from stored immutable current bytes, no mutable working-file reread. Validate revision at publication; lease/accounting limits prevent old response history retention.
5. Add real repo tests for staged/committed changes, deletion of original untracked file, return-to-baseline, binary/nonUTF8/oversize, revision race, page byte limit, capacity failure and immutable current content after later disk edit; cover historical ignored/unignored/force-add and truncated-provenance comparisons without fabricated addition/counts.

Success criteria: AC2/3/4/6 local engine: pinned list/count/detail fidelity survives HEAD/index changes; ignored-to-eligible paths unknown, certified truly absent paths known-added; no mutations. Current capacity/deadline failure never evicts/rebaselines original or fabricates zero coverage.

## Durable task contract

```evcrate-tasks
[
  {
    "id": "capture-session-baseline",
    "title": "Build private storage, bounded inventory and immutable prepared capture",
    "blocked_by": [
      "freeze-session-contract"
    ],
    "allowed_files": [
      "server/src/lib.rs",
      "server/src/session_changes/mod.rs",
      "server/src/session_changes/store.rs",
      "server/src/session_changes/inventory.rs",
      "server/src/session_changes/capture.rs",
      "server/src/session_changes/capture_tests.rs",
      "server/src/session_changes/root.rs",
      "server/src/session_changes/root_tests.rs",
      "server/src/session_changes/absence.rs",
      "server/src/session_changes/absence_tests.rs"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "AC1/2/7 local engine: actual dirty-start bytes plus bounded direct-root and certified namespace absence proof; ignored/truncated originals remain unknown, never silently complete.",
      "Private snapshots and metadata bounded; no worktree/index/branch writes, no late original publication or unbounded blocking queue."
    ],
    "verification": [
      "Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml --lib.",
      "Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --lib session_changes::capture_tests; cargo test --manifest-path server/Cargo.toml --lib session_changes::root_tests; cargo test --manifest-path server/Cargo.toml --lib session_changes::absence_tests.",
      "Local smoke before completion: Use real temporary repository to capture dirty/untracked bytes and prove absent sibling versus ignored/truncated unknown via engine; observe root/time/metadata limits and mutation invariance without HTTP descendants.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  },
  {
    "id": "compare-session-revision",
    "title": "Implement bounded current revision, file counts and pinned details",
    "blocked_by": [
      "capture-session-baseline"
    ],
    "allowed_files": [
      "server/src/session_changes/mod.rs",
      "server/src/session_changes/comparison.rs",
      "server/src/session_changes/text_diff.rs",
      "server/src/session_changes/comparison_tests.rs"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "AC2/3/4/6 local engine: pinned list/count/detail fidelity survives HEAD/index changes; ignored-to-eligible paths unknown, certified truly absent paths known-added; no mutations.",
      "Current capacity/deadline failure never evicts/rebaselines original or fabricates zero coverage."
    ],
    "verification": [
      "Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml --lib.",
      "Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --lib session_changes::comparison_tests.",
      "Local smoke before completion: Use real temporary repo capture->edit->compare->pinned detail, stage/commit/reverse and ignored-to-eligible proof scenarios without server/UI descendants.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  }
]
```

- [x] <!-- evcrate-task:capture-session-baseline --> Build private storage, bounded inventory and immutable prepared capture
- [x] <!-- evcrate-task:compare-session-revision --> Implement bounded current revision, file counts and pinned details

## Verification and evidence

All prerequisite checks **completed and verified**:
- `cargo check --manifest-path server/Cargo.toml --lib`: Clean pass.
- `cargo test --manifest-path server/Cargo.toml --lib session_changes::`: 20 unit tests passed (including `capture_tests::test_prepare_activate_receipt_lifecycle`, `capture_tests::test_fail_capture_latches_original_unavailable`, `root_tests::*` (6 tests), `absence_tests::*` (4 tests), `comparison_tests::test_comparison_flow_modified_added_deleted`).
- Adversarial root preflight, mutation invariance, and absence trie proofs verified in `server/tests/session_changes_adversarial.rs`.
- Carried hardening items recorded: publication CAS tokens for from-now/failure paths, candidate memory pre-allocation against 512 MiB limit, and row-derived presence for unproven paths in detail.

### `capture-session-baseline` local completion gate

- Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml --lib.
- Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --lib session_changes::capture_tests; cargo test --manifest-path server/Cargo.toml --lib session_changes::root_tests; cargo test --manifest-path server/Cargo.toml --lib session_changes::absence_tests.
- Local smoke before completion: Use real temporary repository to capture dirty/untracked bytes and prove absent sibling versus ignored/truncated unknown via engine; observe root/time/metadata limits and mutation invariance without HTTP descendants.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

### `compare-session-revision` local completion gate

- Local compile/bundle before completion: cargo check --manifest-path server/Cargo.toml --lib.
- Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --lib session_changes::comparison_tests.
- Local smoke before completion: Use real temporary repo capture->edit->compare->pinned detail, stage/commit/reverse and ignored-to-eligible proof scenarios without server/UI descendants.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

## Risks, security, failure and rollback

Whole-root scan is not atomic; never upgrade original coverage later. Bounded blocking I/O can still stall permits: tracking unavailable while terminal remains usable. Rollback destroys only private storage/service, never user repository. Service API changes require contract owner/integration reconciliation.

## Next gate

Gate G2: **PASSED**. Capture and comparison passed local compile, real filesystem/domain tests, and review.

## Unresolved questions

None. Phase 02 completed; carried hardening items tracked in plan.md.
