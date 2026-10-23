# Project Manager Status Report: LSP Phase 03 (Pinned Tool Provisioning & Resource Controls)

- **Date**: 2026-10-23
- **Phase**: Phase 03 — Pinned Tool Provisioning and Resource Controls
- **Status**: Administratively Complete under Approved Exceptions; Release Qualification Remains Pending (100% phase scope — 28h planned effort)
- **Total Plan Progress**: 25.8% credited planned effort (68h / 264h planned; Phase 01: 24h, Phase 02: 16h, Phase 03: 28h)
- **Plan Reference**: `plans/260901-1000-lsp-server-integration/phase-03-pinned-tool-provisioning-and-resource-controls.md`
- **Parent Plan**: `plans/260901-1000-lsp-server-integration/plan.md`
- **Tester Report**: `plans/reports/tester-261023-1135-phase-03-cycle-2.md`
- **Reviewer Report**: `plans/reports/code-reviewer-261023-1205-phase-03-cycle-3.md`

---

## 1. Executive Summary

Phase 03 (Pinned Tool Provisioning and Resource Controls) is closed and marked DONE administratively following explicit user approval of Cycle 3 code review (score 8.5/10, 0 critical issues). Release qualification remains pending. Targeted test suites report 55/55 tests passing across five test targets in QA test run (`tester-261023-1135-phase-03-cycle-2.md`).

Deliverables completed in scope:
- `deploy/release/build-release-archive.sh`: Deterministic release packaging for `lib/semantic-engine/` tuple (Node runtime binary, tsls `cli.mjs`, TypeScript `tsserver.js`, `package.json`), permission normalization (0755 for Node, 0644 for files), symlink dereferencing. Real production artifact fetching/assembly remains deferred to release pipeline.
- `deploy/release/generate-release-manifest.mjs`: Server-role projection, exclusion from web-only distributions, SHA-256 digest computation, and SPDX 2.3 SBOM generation with compliant sanitized IDs (`SPDXRef-File-N-sanitized`).
- `server/src/linux_release/inventory_path.rs` & `inventory_validation.rs`: Strict inventory validation rejecting non-executable or group/world-writable Node binary and stray files. Offline install/update/rollback qualification deferred to Phase 09.
- `server/src/semantic/tool_profile.rs`: Passive zero-child integrity verification (`ToolProfile::verify_integrity`) checking streaming SHA-256 digests against `PINNED_*` consts matching `provenance.json`, regular-file verification, and symlink prohibition.
- `server/src/semantic/resources.rs`: Centralized immutable `ResourcePolicy` constants (8 KiB header, 16 MiB body, 64 KiB adaptive sync threshold, 64 max open docs, 128 max in-flight requests, 1024 MiB process-tree RSS / 768 MiB Node heap). Session admission enforcement deferred to Phase 04.
- `server/src/semantic/resources/linux.rs`: Child-only Linux cgroup v2 setup via `pre_exec` hook on owned process tree; clean teardown and fallback to `PortableOnly` degradation on missing delegation/controllers (`PortableOnly` carries no hard memory guarantee; cgroups are not filesystem isolation; real-host delegation qualification deferred to Phase 09).

---

## 2. Validation & Quality Gates

Results attributed to QA Cycle 2 report (`tester-261023-1135-phase-03-cycle-2.md`):
- **`semantic_tool_profile`**: 11/11 passed (0.00s).
- **`semantic_resources`**: 8/8 passed (0.00s).
- **`linux_release_manifest`**: 12/12 passed (0.00s).
- **`--lib semantic::`**: 13/13 passed (0.00s; 1,466 filtered non-semantic unit tests).
- **`semantic_child_process`**: 11/11 passed (8.55s).
- **Total Test Count**: 55/55 passed (100%).
- **Code Review Score**: Cycle 3 code review 8.5/10 (0 critical issues, 3 warnings, 5 suggestions). User approved on 2026-10-23 under authorized exceptions.
- **Formatting**: `rustfmt --check` on Phase 03 files yields 0 diffs.

---

## 3. Plan & Roadmap Synchronizations

- `plans/260901-1000-lsp-server-integration/phase-03-pinned-tool-provisioning-and-resource-controls.md`: Status updated to DONE (2026-10-23) (administratively complete under approved exceptions; release qualification remains pending); review status Approved under authorized exceptions; all 7 todo items updated with qualification caveats; validation status and report links updated.
- `plans/260901-1000-lsp-server-integration/plan.md`: Status updated to in-progress 25.8% (68/264h planned effort); Phase 03 marked DONE (100% phase scope, 28h planned); action items and recommendations updated; next phase set to Phase 04 (Semantic session supervisor).
- `docs/project-roadmap.md`: Updated Recently Delivered table (25.8%, 68/264h planned effort) and Open Qualification Gates.
- `docs/CHANGELOG.md`: Added 2026-10-23 entry documenting Phase 03 deliverables, verification results, and review approval.

---

## 4. Complete Carried Backlog & Review Disposition

### Phase 03 Cycle 3 Review Items

| Item | Severity | Description | Disposition / Owning Phase |
|---|---|---|---|
| **P3-W1** | Warning-Med | `package.json` pin divergence between repo template (`1aebb20f…`) and pinned const (`24e2c4c0…`). | **Phase 09 / Release Packaging**: Staging assembler automation to align template/tarball hash. |
| **P3-W2** | Warning-Med | No consistency guard test between Rust consts and `provenance.json`. | **Phase 04 / Phase 09**: Automated consistency unit test to prevent drift. |
| **P3-W3** | Warning-Low | Digest coverage is entrypoint-only (4 key files); transitive modules covered by release manifest. | **Phase 09**: Qualify installer-level full inventory verification; whole-tree coverage remains open gate. |
| **P3-S1** | Suggestion | `PinnedDigests` and `from_release_root_with_digests` are `pub`. | **Phase 04 / Phase 09**: Restrict to `pub(crate)` with `test-support` feature gate. |
| **P3-S2** | Suggestion | `ToolProfileError::IntegrityFailed` Debug formatting leaks absolute paths in error formatting. | **Phase 04**: Redact to code enum before logging/API exposure. |
| **P3-S3** | Suggestion | `discover()` picks exe-relative root by `node_path.exists()`. | **Phase 09**: Consider fixed root only in production. |
| **P3-S4** | Suggestion | Unconditional `os::unix` in integration test breaks Windows test builds. | **Phase 09**: Gate with `#[cfg(unix)]`. |
| **P3-S5** | Suggestion | SBOM licenses default to MIT; Node binary vs tarball SHA-256 label ambiguity. | **Phase 09 / Packaging**: Refine SBOM generation labels. |

### Phase 02 Carried Items & Status

| Item | Severity | Description | Current Status / Disposition |
|---|---|---|---|
| **P2-W1** | Warning-High | Panic/runtime-drop cleanup transfer absent in bare `tokio::spawn` owner. | **Carried to Phase 04**: Supervisor-level drop guard and reaper handoff. |
| **P2-W2** | Warning-Med | `kill(-pgid)` after group empty / PGID recycle race. | **Carried to Phase 09**: Gate on `!is_pgid_empty(pgid)` / pidfd. |
| **P2-W3** | Warning-Med | Zombie members may yield false leak report if leader not reaped before timeout. | **Carried to Phase 04 / Phase 09**: Lifecycle tuning. |
| **P2-W4** | Warning-Med | Terminal ordering: `Terminated` event may precede stdout tail / stderr summary. | **Carried to Phase 04**: Supervisor consumers must not assume reader join ordering. |
| **P2-W5** | Warning-Med | Test gaps: setsid/reparent-escape, stdin write timeout, saturated event queue + idle rx. | **Carried to Phase 09**: Hostile escape qualification fixtures. |
| **P2-W6** | Warning-Med | Crate visibility seal: `pub mod semantic` and `#[doc(hidden)]` public fields. | **Carried to Phase 04 / Phase 09**: Visibility tightening. |
| **P2-W7** | Warning-Med | Test runner `resolve_node_bin` falls back to `which node` (system Node). | **Partially Addressed in Phase 03; Carried to Phase 04**: Phase 03 introduced `PINNED_NODE_SHA256` and layout; fixture migration to explicit `lib/semantic-engine/node` completes in Phase 04. |
| **P2-W8** | Warning-Low/Med | Budget arithmetic: worst-case stage timeouts sum to 4.2s vs 5.0s `TOTAL_TEARDOWN_BUDGET`. | **Carried to Phase 04**: Reconcile stage sub-timeouts in supervisor reaper config. |
| **P2-W9** | Warning-Low/Med | Owner blind to stop/rx-drop during <=2s stdin write. | **Carried to Phase 04**: Select loop cancellation priority around stdin write. |
| **P2-W10** | Warning-Low | `PATH=/usr/bin:/bin` injected; non-unix stubs return true without compile gate. | **Resolved in Phase 03**: `#[cfg(unix)]` applied in `tool_profile.rs`; minimal sanitized environment enforced. |
| **P2-W11** | Warning-Low | Blocked stdout/stderr tasks on `send().await` with alive-idle receiver. | **Carried to Phase 04**: Bound channel send timeouts in supervisor consumers. |

---

## 5. Next Steps & Urgency to Main Agent

**Next Phase**: Phase 04 — Semantic session supervisor (`plans/260901-1000-lsp-server-integration/phase-04-semantic-session-supervisor.md`, 28h planned effort).

**Directives for Main Agent**:
Main agent MUST immediately proceed to execute Phase 04.
Completing the remaining phases of the implementation plan is critically important:
1. Phase 04 (Semantic session supervisor) bridges the low-level process owner (`child.rs`) and immutable tool profile (`tool_profile.rs`), providing session admission, document overlay tracking, and supervisor-level panic/drop cleanup transfer.
2. Verified admission and lifecycle enforcement across Phases 04–06 are strictly required before exposing any semantic endpoints. Phase sequencing alone does not guarantee safety; concrete admission checks (Phase 04), authenticated transport cutoff (Phase 05), and administrative hot toggle controls (Phase 06) must be implemented and tested to prevent unauthenticated or untracked child process execution.
3. Without completing Phase 04, downstream integration in Phase 05 (WebSocket Gateway) and Phase 06 (Admin Hot Toggle) cannot proceed.

---

## 6. Unresolved Questions

1. Which exact file yields the `24e2c4c0…` package.json hash in `provenance.json` versus the repository template hash (`1aebb20f…`)?
2. Does the installer/service perform a full inventory SHA-256 validation before enabling the semantic engine, covering transitive `node_modules`?
3. Who produces the staged `--semantic-engine-dir` in CI/release pipelines, and does that tooling automate provenance hash recalculation?
