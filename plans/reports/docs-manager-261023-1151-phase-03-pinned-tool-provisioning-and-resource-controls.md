# Documentation Update Report: Phase 03 Pinned Tool Provisioning and Resource Controls

- **Agent:** DocsManagerPhase03
- **Date:** 2026-10-23
- **Phase Target:** Phase 03 — Pinned Tool Provisioning and Resource Controls (`plans/260901-1000-lsp-server-integration/phase-03-pinned-tool-provisioning-and-resource-controls.md`)
- **Owned Docs Updated:**
  - `docs/system-architecture.md`
  - `docs/codebase-summary.md`
  - `docs/project-overview-pdr.md`
  - `docs/code-standards.md`
  - `docs/linux-release-manifest.md`
  - `docs/deployment-guide.md`
  - `docs/CHANGELOG.md`
- **Compaction Output:** `./repomix-output.xml`

---

## 1. Summary of Updates

Documentation updated to reflect completed Phase 03 implementation of the TypeScript/JavaScript LSP Semantic Navigation subsystem (`server/src/semantic/`, `deploy/release/`, `server/src/linux_release/`), covering pinned tool provisioning, passive zero-child integrity verification, centralized resource policy constants, Linux child-only cgroups v2 attachment with honest portable degradation, and SPDX 2.3 SBOM integration.

### `docs/system-architecture.md`
- Added section `### Implemented Primitives: Phase 03 Pinned Tool Provisioning and Resource Controls` under `## TypeScript and JavaScript LSP Semantic Navigation`.
- Documented five core subsystem primitives:
  1. **Immutable Bundled Toolchain Layout (`lib/semantic-engine`):** Packaged under `<release-root>/lib/semantic-engine/` (default `/opt/dam-hopper/lib/semantic-engine`). Contains pinned Node.js runtime (`node`, v24.16.0, SHA-256 `b2959781cc5a74c357ffa02367efa8a0330cbb1c9cb347732fdfaaaca381cbcd`), `tsls/package.json` (`1aebb20f4c8d8b699745853542ecce7f1e7e42c85f97843bfd8064f9efdc3f7c`), `tsls/node_modules/typescript-language-server/lib/cli.mjs` (v6.0.2, SHA-256 `192638f1fa62c907fd54c0b55b12dd3dff01325a1a0ed5973907efca1c57b5eb`), and `tsls/node_modules/typescript/lib/tsserver.js` (v5.9.3, SHA-256 `e3ccfeec65ec5c470b8ffc5611878a31182650c7e8a062c38a719f83b523edcb`). Archive staging dereferences symlinks via `cp -rL`. Release manifest and validator enforce role `server` and non-writable modes (`mode & 0o022 == 0`). Zero `PATH`, npm, or workspace resolution.
  2. **Passive Zero-Child Integrity Verification (`server/src/semantic/tool_profile.rs`):** `SemanticToolProfile` bound to release root (`from_release_root`, `discover`). `verify_integrity` executes zero subprocesses (`node`, `npm`, shell never invoked). Uses `symlink_metadata` to verify regular files and reject symlinks, checks permission bits (Node executable `mode 0755`, no group/world-writable files), and validates 64 KiB streaming SHA-256 digests against hardcoded `PinnedDigests`. Strict boundary separates non-executing configuration-time integrity from lazy session-time protocol qualification. Unsupported languages (Rust/Java) fail immediately.
  3. **Centralized Resource Policy Constants (`server/src/semantic/resources.rs`):** Established `ResourcePolicy` (version `1.0.0`). Protocol and queue constants wired directly into `framing.rs` and `types.rs` (`MAX_STDIO_HEADER_BYTES = 8 KiB`, `MAX_FRAME_BODY_BYTES = 4 MiB`, `MAX_QUEUED_MESSAGES = 32`, `MAX_QUEUED_BYTES = 4 MiB`, `MAX_RETAINED_STDERR_BYTES = 64 KiB`, `GRACEFUL_SHUTDOWN_TIMEOUT = 2,000 ms`, `FORCE_KILL_REAP_BUDGET = 3,000 ms`, `TOTAL_TEARDOWN_BUDGET = 5,000 ms`). Higher-level candidate constants defined with validation helpers (`validate_document_size`, `validate_frame_size`, `validate_header_size`, `is_incremental_sync_recommended`) for downstream supervisor/gateway wiring (64 KiB adaptive sync, 1 MiB doc, 16 open docs, 4 MiB session / 8 MiB global overlay, 2 global trees, 8 processes/tree, 40 msg/s rate, 30s startup / 10s nav / 60s idle timeouts, 256 MiB V8 heap hint).
  4. **Linux Child-Only Cgroups Attachment & Honest Portable Degradation (`server/src/semantic/resources/linux.rs` & `launch.rs`):** Child-only scoping under `/sys/fs/cgroup/.../dam-hopper-semantic-<session_id>`. Never alters API daemon ancestor cgroup. Pre-exec attachment in `BundledLaunchSpec` (`cmd.pre_exec`) writes `libc::getpid()` to `cgroup.procs` between `fork` and `execve` for zero-race containment before TSLS execution. Configures `memory.max = 768 MiB`, `cpu.max = "50000 100000"`, `pids.max = 64`. If cgroup v2, delegation, or any controller is missing, cleanly removes partial directory and returns `ResourceMode::PortableOnly` with explicit facts without false RSS claims. RAII cleanup via `ChildCgroupScope`.
  5. **SPDX 2.3 SBOM Integration (`deploy/release/generate-release-manifest.mjs` & `provenance.json`):** Linux release packaging emits `dam-hopper-<tag>.spdx.json`. Contains package definitions for `dam-hopper` (MIT), `typescript` (Apache-2.0), `typescript-language-server` (Apache-2.0), and `nodejs` (MIT with SHA-256 and source URL). Records package `CONTAINS` relationships and per-file licenses (`Apache-2.0` under `typescript*`, `MIT` for base files).
- Updated downstream planned section to `### Planned Production Architecture & Invariants (Phases 04–06)`.

### `docs/codebase-summary.md`
- **Backend Subsystems Table:** Updated `semantic/` inventory to 9 files, 2,152 LOC (reflecting Phase 02 + Phase 03 additions to the 2026-10-05 inventory baseline).
- **Backend Note:** Recorded Phase 03 completion (immutable tool provisioning, zero-child integrity verification, centralized ResourcePolicy definitions, Linux child-only cgroups attachment with honest portable degradation, and SPDX 2.3 SBOM generation); noted downstream Phases 04–06.
- **Architecture Invariants:** Updated TypeScript/JavaScript LSP Semantic Navigation subsystem invariant bullet with Phase 03 primitives.
- **Codebase Compaction Snapshot:** Refreshed Section 6 repomix metrics to 3,181 files, 7,870,747 tokens packed, 33,070,432 characters, and 7 exclusions.

### `docs/project-overview-pdr.md`
- **PR-029:** Updated status to reflect completion of Phase 01 (Spike), Phase 02 (Framing & Child Owner), and Phase 03 (Pinned Tool Provisioning & Resource Controls); noted session supervision (Phase 04) and gateway (Phase 05) follow.
- **Acceptance Criteria (`### Semantic code navigation`):** Added explicit acceptance criteria for passive zero-child integrity verification, centralized `ResourcePolicy` constants, Linux child-only cgroups attachment with honest `PortableOnly` degradation, and SPDX 2.3 SBOM generation.

### `docs/code-standards.md`
- **Repository Structure:** Added `semantic` to backend domain directories (`server/src/{auth,config,...,semantic}/`).
- **Domain Invariants:** Added dedicated section `### TypeScript/JavaScript LSP Semantic Navigation Subsystem` documenting immutability, zero-PATH lookup, passive zero-child integrity verification, centralized policy constants, pre-exec child cgroups attachment, daemon cgroup immutability, and server-role release projection.

### `docs/linux-release-manifest.md`
- **Publisher Boundary:** Explicitly named the tag-specific SPDX 2.3 JSON SBOM (`dam-hopper-<tag>.spdx.json`).
- **Inventory Rules:** Documented `lib/semantic-engine` role `server` requirement, non-writable modes (`mode & 0o022 == 0`), executable `node` requirement (`mode & 0o111 != 0`), symlink rejection, and SPDX 2.3 package/CONTAINS relationships.

### `docs/deployment-guide.md`
- Added note under Linux Release prerequisites clarifying that `server`/`both` installations bundle the immutable toolchain (`lib/semantic-engine`) requiring no host Node.js runtime or additional package downloads once staged/installed, and noting optional child-only cgroups v2 integration.

### `docs/CHANGELOG.md`
- Corrected constants in Phase 03 entry to match code (`MAX_FRAME_BODY_BYTES = 4 MiB`, `MAX_OPEN_DOCUMENTS_PER_SESSION = 16`, `MAX_IN_FLIGHT_REQUESTS = 8`, `LINUX_CGROUP_MEMORY_MAX_BYTES = 768 MiB`, `V8_MAX_OLD_SPACE_MB = 256`).
- Standardized reference to `SemanticToolProfile::verify_integrity`.

---

## 2. Validation & Verification

1. **Size Limits (`docs.maxLoc` = 800 LOC):**
   - `docs/system-architecture.md`: 575 LOC
   - `docs/codebase-summary.md`: 99 LOC
   - `docs/project-overview-pdr.md`: 132 LOC
   - `docs/code-standards.md`: 147 LOC
   - `docs/linux-release-manifest.md`: 357 LOC
   - `docs/deployment-guide.md`: 275 LOC
   - `docs/CHANGELOG.md`: 673 LOC
   - All files remain strictly below 800 LOC.
2. **Repomix Execution:**
   - Generated compaction artifact `./repomix-output.xml` (3,181 files, 7,870,747 tokens packed, 33,070,432 characters, 7 security-flagged exclusions).
3. **Documentation Validator (`validate-docs.cjs`):**
   - 33 markdown files checked.
   - 293 valid internal links, 0 broken links.
   - 729 code-reference warnings and 292 config-key warnings recorded (project-wide historical baseline across changelog and documentation).
4. **Peer Coordination:**
   - Coordinated via IRC with `ProjectManagerPhase03`. Zero edits made to `docs/project-roadmap.md` or `plans/` by DocsManager.

---

## 3. Qualification & Implementation Boundaries

- **Administrative Completion vs Release Qualification:** Phase 03 implementation, unit/integration tests (55/55 passed across five targets), and Cycle 3 review (8.5/10) are complete under approved plan exceptions. Full release-pipeline fetching, package.json hash alignment, and live-host cgroup delegation qualification are deferred to Phase 09.
- **Policy Definition vs Active Enforcement:** Framing and queue constants are enforced at the stdio boundary in `framing.rs` and `types.rs`. High-level concurrency, overlay budgets, token-bucket message rate limits, and request deadlines are defined in `ResourcePolicy` and will be wired into the session supervisor (`Phase 04`) and WebSocket gateway (`Phase 05`).
- **G8 Browser Qualification:** Model-scoped Monaco provider coexistence remains in `STOP (Pending Web Browser Qualification)` status, deferred to Phase 07 implementation and Phase 10 qualification.

---

## 4. Unresolved Questions

None. All Phase 03 documentation requirements satisfied.
