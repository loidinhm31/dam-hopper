# Review triage — Lightweight Session Changes refactor

## Disposition

Accepted all four findings from [independent plan review](independent-plan-review.md). Plan contracts revised; no product implementation, task-state mutation or runtime qualification performed. Resolution below means **authored correction**, not independent reviewer approval. Coordinator retains targeted follow-up, final validation and hydrate/sync.

## R1 — Blocker: independent completion evidence and asset ordering

**Accepted; corrected across overview and all phases.**

- `omp-tool-event-producer.blocked_by` is now `[]`; it creates the complete real Session Changes asset, isolates Agent Status, and owns initial `server/tests/omp-session-changes.test.ts` creation. Basic compile/tests/local HTTP smoke/review occur before its completion.
- `managed-extension-lifecycle` now depends on that producer task. Its `include_str!("assets/omp-session-changes.ts")` consumer has an existing complete source asset before compile; no fake asset, missing-file boundary or cycle.
- All 11 tasks specify local compile/typecheck (or justified Markdown-only not-applicable), focused tests, smoke and review before evidence-backed completion. No predecessor defers its first evidence to `qualify-integrated-session-changes` or any other descendant.
- Engine implementation tasks now own necessary existing unit/API/protocol test migrations. `per-file-capture-engine` updates all Rust consumers of removed inventory/barrier types and keeps real bounded explicit-refresh behavior working. `lazy-view-comparison` adds and runs its own basic no-work/bootstrap/revision tests. Regression tasks expand already passing coverage rather than supply predecessors' first tests.
- Keep old wire vectors only as temporary test inputs for unmigrated TS tests, not production protocol shims. UI task owns final vector cleanup and follows `qualify-engine-protocol` to serialize shared fixture writes; remaining Rust vector tests rerun at UI completion.
- `qualify-integrated-session-changes` remains the final additional cross-layer suite plus real OMP/browser/Tauri journey and integrated review, after completed prerequisite evidence. Earlier local checks are not substituted by this final run.
- Shared build/check lanes serialize at coherent task boundaries; no verification against half-edited siblings. Phase numbering groups concerns; dependency graph controls execution.

Revised critical path:

`omp-tool-event-producer -> managed-extension-lifecycle -> server-session-changes-switch -> per-file-capture-engine -> lazy-view-comparison -> qualify-engine-protocol -> lazy-panel-and-triggers -> qualify-integrated-session-changes -> document-lightweight-session-changes`.

Other inputs: switch → `settings-toggle-owner-binding` → panel; producer → `qualify-omp-producer` → integrated gate.

## R2 — High: all config replacement entrypoints

**Accepted; corrected in Phase 01 lifecycle task.**

- Added `server/src/api/settings.rs` and `server/src/api/workspace.rs` to `server-session-changes-switch.allowed_files`.
- Centralized serialized reconciliation must cover config update/reload/startup, cache-clear external-file reload, TOML import/recovery, workspace init and workspace switch before `state.config` replacement. Preserve existing workspace lock order and unrelated reconfiguration.
- After requested OFF has invalidated/purged tracking, import cleanup/reload/persistence failure cannot automatically restore old ON bytes and reload them. Keep runtime OFF, retain backup/error evidence, persist OFF where possible; recovery of unrelated fields must overlay OFF and use the same helper. Explicitly report any inability to persist OFF.
- Acceptance/local smoke and owned `server/tests/session_changes_lifecycle.rs` regressions now cover cache-clear ON↔OFF, missing/explicit workspace flags, init/switch and import cleanup-error recovery. Initial default-off opt-in migration is owned now, not left to an engine descendant.

## R3 — High: exhaustive restore constructor

**Accepted; corrected in Phase 01 lifecycle task.**

- Added `server/src/persistence/restore.rs` to `server-session-changes-switch.allowed_files`.
- Explicitly migrate the exhaustive `ServerConfig` literal at inspected lines 366–375 using false or an appropriate default update. Preserve existing restore coverage; serde defaults do not repair Rust literals.
- Local verification includes `cargo check`, config tests, `cargo test --manifest-path server/Cargo.toml persistence::restore` and lifecycle tests before completing the task.

## R4 — Medium: obsolete normative code standards

**Accepted; corrected in Phase 04 docs task.**

- Added `docs/code-standards.md` to `document-lightweight-session-changes.allowed_files`.
- Exact instructions/acceptance replace inspected clauses at lines 126–136: obsolete metadata-tree limits, 128/512 MiB budgets, receipt-qualified sessionStart/fromNow states and AbsenceTrie proofs become 2 MiB/file, 64 MiB global, 500 files/session, 32 sessions, first-touch presence/unknown provenance and viewer-only comparison rules.
- Preserve root containment, immutability/read-only review, keyboard isolation and Monaco protections. Docs task performs its own focused contract/link checks, operator-example smoke and review; compile is explicitly not applicable to Markdown-only edits.

## Structural inspection and validation boundary

Read-tool results from actual revised artifacts passed in-memory assertions: overview **78 lines**, unchanged required frontmatter/progress, four linked phases with task counts **2/3/2/4**, exactly one fence each, exact seven-field JSON, matching markers, normalized literal writable paths and **11 unique IDs**. Dependencies resolve, graph acyclic, **zero unordered writable overlaps**. R1 producer-before-bundle and R2–R4 owned-path assertions pass; every task verification contract includes local compile/applicability, focused checks, smoke and review. **0 structural assertions failed.** This is author-side static inspection, not installed-helper validation or independent follow-up approval.

`hydrate` and `sync` deliberately **not run** by author, per coordinator direction. Existing `tasks.json` not edited. Coordinator must deliberately rehydrate revised semantic fingerprints, sync managed progress and collect actual `ok:true` / zero-diagnostic outputs before helper acceptance; then request the permitted targeted review follow-up. Product compile/tests/smoke/review strings remain future execution gates, not claims of commands exercised in this authoring run.

## Unresolved questions

None requiring product-design decisions. Coordinator rehydrate/sync and targeted independent review remain pending gates.
